use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs,path::Path,time::{SystemTime,UNIX_EPOCH}};

const MAX_BYTES:usize=96*1024;
const MAX_JOBS:usize=64;
const MAX_OBSERVATIONS:usize=8;

fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct FileObservation {pub at_ms:u64,pub exists:bool,pub size_bytes:Option<u64>,pub modified_ms:Option<u64>}

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
struct MediaValidationReceipt {
    pub schema_version:u8,pub job_id:String,pub output:String,pub observed_size_bytes:u64,
    pub observed_modified_ms:Option<u64>,pub validator:String,pub playable:bool,
    pub container:Option<String>,pub video_streams:Option<u32>,pub audio_streams:Option<u32>
}
impl MediaValidationReceipt {
    fn validate(&self)->Result<(),String>{
        if self.schema_version!=1||self.job_id.is_empty()||self.job_id.len()>80
            || self.output.is_empty()||self.output.len()>4096||!Path::new(&self.output).is_absolute()
            || self.observed_size_bytes==0||self.validator.is_empty()||self.validator.len()>120
            || self.container.as_ref().is_some_and(|v|v.is_empty()||v.len()>80)
            || self.video_streams.is_some_and(|v|v>128)||self.audio_streams.is_some_and(|v|v>128){
            return Err("Invalid bounded media-validation receipt.".into());
        }Ok(())
    }
}

pub fn observe(path:&str)->FileObservation{
    let metadata=fs::metadata(path).ok().filter(|m|m.is_file());
    FileObservation{at_ms:now(),exists:metadata.is_some(),size_bytes:metadata.as_ref().map(|m|m.len()),
        modified_ms:metadata.and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(UNIX_EPOCH).ok())
            .map(|d|d.as_millis() as u64)}
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {pub schema_version:u8,pub job_id:String,pub project_guid:String,pub sequence_guid:String,
    pub output:String,pub preset:Option<String>,pub queue_to_ame:bool,pub request_at_ms:u64,
    pub output_existed_before:bool,pub before:FileObservation,pub bridge_state:String,
    pub encoder_completion_verified:bool,
    // Original bridge command identity is persisted when its exact accepted
    // response arrives; it is not a native Adobe jobID or a producer proof.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub bridge_request_id:Option<String>,
    #[serde(default)]
    media_validation:Option<MediaValidationReceipt>,
    pub observations:Vec<FileObservation>}

impl Job {
    pub fn new(id:String,project:&str,sequence:&str,output:&str,preset:Option<&str>,queue:bool)->Result<Self,String>{
        if id.is_empty()||id.len()>80||project.is_empty()||project.len()>240||sequence.is_empty()||sequence.len()>240
            || output.is_empty()||output.len()>4096||!Path::new(output).is_absolute()
            || preset.is_some_and(|s|s.len()>4096){return Err("Invalid export job identity or path.".into());}
        let before=observe(output);
        Ok(Self{schema_version:1,job_id:id,project_guid:project.into(),sequence_guid:sequence.into(),
            output:output.into(),preset:preset.map(str::to_owned),queue_to_ame:queue,request_at_ms:now(),
            output_existed_before:before.exists,before,bridge_state:"pending".into(),
            encoder_completion_verified:false,bridge_request_id:None,
            media_validation:None,observations:vec![]})
    }
    pub fn native_event_observation(&self,host:Option<&Value>)->Value{
        // The host UXP only holds a bounded ephemeral event ring. Even a
        // uniquely observed queued/complete candidate does not prove this
        // Shuvi job caused the export or that an MP4 is fully rendered.
        let blank=|reason:&str| json!({
            "bridge_request_id":self.bridge_request_id,
            "observational_native_event_bound":false,
            "native_queue_candidate_observed":false,
            "native_complete_event_candidate_observed":false,
            "native_error_or_cancel_observed":false,
            "native_job_id_candidate":null,
            "encoder_completion_verified":false,
            "export_job_output_attribution_verified":false,
            "final_delivery_ready":false,
            "retry_safe":false,
            "reason":reason
        });
        if !matches!(self.bridge_state.as_str(),"accepted"|"queued"){
            return blank("Export job has no confirmed native dispatch acceptance.");
        }
        let id=match self.bridge_request_id.as_deref(){
            Some(id)=>id,None=>return blank("No persisted exact bridge request identity.")
        };
        let rows=match host.and_then(|value|value.get("shuviExportObservations"))
            .and_then(Value::as_array) {
                Some(rows) if rows.len()<=16=>rows,
                _=>return blank("No bounded live Premiere UXP export-event observations.")
            };
        let matches:Vec<&Value>=rows.iter().filter(|row|
            row.get("bridgeRequestId").and_then(Value::as_str)==Some(id)
            &&row.get("output").and_then(Value::as_str)==Some(self.output.as_str())
        ).collect();
        if matches.len()!=1{return blank("Exact bridge ID and output event evidence missing or ambiguous.");}
        let row=matches[0];
        let valid=row.get("windowComplete").and_then(Value::as_bool)==Some(true)
            &&row.get("queueCandidateCount").and_then(Value::as_u64)==Some(1)
            &&row.get("queueCandidateObserved").and_then(Value::as_bool)==Some(true)
            &&row.get("nativeCorrelation").and_then(Value::as_str)
                ==Some("exact_output_single_queue_candidate_external_writer_race_unexcluded")
            &&row.get("encoderCompletionVerified").and_then(Value::as_bool)==Some(false)
            &&row.get("fileGeneratedByThisShuviRequestVerified").and_then(Value::as_bool)==Some(false)
            &&row.get("finalDeliveryReady").and_then(Value::as_bool)==Some(false);
        let native_id=row.get("nativeJobIdCandidate").and_then(Value::as_str)
            .filter(|s|!s.is_empty()&&s.len()<=160);
        if !valid||native_id.is_none(){
            return blank("Unverified, ambiguous or truncated native event candidate.");
        }
        let ended=row.get("latestNativeTerminalEvent").and_then(Value::as_str);
        let complete=ended==Some("complete")
            &&row.get("nativeCompleteEventCandidateObserved").and_then(Value::as_bool)==Some(true)
            &&row.get("nativeErrorOrCancelObserved").and_then(Value::as_bool)==Some(false);
        let failed=matches!(ended,Some("error"|"cancelled"))
            &&row.get("nativeErrorOrCancelObserved").and_then(Value::as_bool)==Some(true);
        json!({
            "bridge_request_id":id,
            "observational_native_event_bound":true,
            "native_job_id_candidate":native_id,
            "native_queue_candidate_observed":true,
            "native_complete_event_candidate_observed":complete,
            "native_error_or_cancel_observed":failed,
            "encoder_completion_verified":false,
            "export_job_output_attribution_verified":false,
            "final_delivery_ready":false,
            "retry_safe":false,
            "reason":"Matched one transient Adobe native queue event to one Shuvi bridge request ID/output. External writer race, actual encoded bytes and completion are not independently proven."
        })
    }
    pub fn observe_once(&mut self)->Result<Value,String>{
        self.validate()?;
        let item=observe(&self.output);
        let prior=self.observations.last();
        let stable=prior.is_some_and(|p|p.exists && item.exists && p.size_bytes.is_some_and(|v|v>0)
            && p.size_bytes==item.size_bytes && p.modified_ms.is_some()
            && p.modified_ms==item.modified_ms && item.at_ms.saturating_sub(p.at_ms)>=1500);
        if self.observations.len()>=MAX_OBSERVATIONS{self.observations.remove(0);}
        self.observations.push(item.clone());self.validate()?;
        let media_parse_verified=self.media_validation.as_ref().is_some_and(|receipt|
            receipt.playable&&receipt.job_id==self.job_id&&receipt.output==self.output
            && item.exists&&item.size_bytes==Some(receipt.observed_size_bytes)
            && item.modified_ms==receipt.observed_modified_ms);
        Ok(json!({"job_id":self.job_id,"bridge_state":self.bridge_state,"mode":if self.queue_to_ame{"ame_queue"}else{"immediate"},
            "file_observed":item.exists,"file_stable":stable,"encoder_completion_verified":self.encoder_completion_verified,
            "preexisting_output":self.output_existed_before,"before":self.before,"latest":item,
            "media_parse_verified":media_parse_verified,"completion_verified":false,
            "validator_receipt_present":self.media_validation.is_some(),"retry_automatically":false,
            "note":"Playable-media validation and encoder completion are separate; neither file stability nor a parser receipt proves AME completion."}))
    }
    pub fn media_validation_challenge(&self)->Result<Value,String>{
        self.validate()?;
        let item=self.observations.last().ok_or("Observe the export output before media validation.")?;
        if !item.exists||item.size_bytes.map_or(true,|v|v==0){
            return Err("Media validation requires a non-empty observed output file.".into());
        }
        Ok(json!({"schema_version":1,"job_id":self.job_id,"output":self.output,
            "observed_size_bytes":item.size_bytes,"observed_modified_ms":item.modified_ms,
            "purpose":"Bind an external bounded media parser/decoder receipt to this exact observed file state."}))
    }
    fn record_media_validation(&mut self,receipt:MediaValidationReceipt)->Result<(),String>{
        receipt.validate()?;
        if receipt.job_id!=self.job_id||receipt.output!=self.output{
            return Err("Media-validation receipt does not match the exact export job/output.".into());
        }
        let item=self.observations.last().ok_or("Observe the export output before recording media validation.")?;
        if !item.exists||item.size_bytes!=Some(receipt.observed_size_bytes)||item.modified_ms!=receipt.observed_modified_ms{
            return Err("Media-validation receipt is stale for the current observed output metadata.".into());
        }
        self.media_validation=Some(receipt);self.validate()
    }
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1||self.job_id.is_empty()||self.job_id.len()>80
            || self.project_guid.is_empty()||self.project_guid.len()>240||self.sequence_guid.is_empty()||self.sequence_guid.len()>240
            || self.output.is_empty()||self.output.len()>4096||!Path::new(&self.output).is_absolute()
            || self.preset.as_ref().is_some_and(|s|s.len()>4096)
            || !matches!(self.bridge_state.as_str(),"pending"|"accepted"|"queued"|"execution_status_unknown"|"rejected")
            || self.encoder_completion_verified || self.observations.len()>MAX_OBSERVATIONS
            || self.bridge_request_id.as_ref().is_some_and(|id|
                id.is_empty()||id.len()>160
                ||!id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')) {
            return Err("Invalid or falsely completed Premiere export job.".into());
        }
        if let Some(receipt)=&self.media_validation {receipt.validate()?;
            if receipt.job_id!=self.job_id||receipt.output!=self.output{
                return Err("Media-validation receipt identity does not match export job.".into());
            }
        }Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Jobs {pub schema_version:u8,pub jobs:Vec<Job>}
impl Default for Jobs {fn default()->Self{Self{schema_version:1,jobs:vec![]}}}
impl Jobs {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1||self.jobs.len()>MAX_JOBS{return Err("Invalid export job store bounds.".into());}
        let mut seen=std::collections::HashSet::new();
        for job in &self.jobs {job.validate()?;if !seen.insert(&job.job_id){return Err("Duplicate export job ID.".into());}}
        if serde_json::to_vec(self).map_err(|e|e.to_string())?.len()>MAX_BYTES{return Err("Export jobs exceed 96 KiB.".into());}Ok(())
    }
    pub fn insert(&mut self,job:Job)->Result<(),String>{
        if self.jobs.iter().any(|j|j.job_id==job.job_id){return Err("Export job already recorded.".into());}
        if self.jobs.len()==MAX_JOBS {self.jobs.remove(0);}
        self.jobs.push(job);self.validate()
    }
}

pub fn load(path:&Path)->Result<Jobs,String>{
    let read=|p:&Path|->Result<Jobs,String>{let bytes=crate::read_file_bytes_bounded(p, MAX_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_BYTES{return Err("Oversized export job file.".into());}
        let data:Jobs=serde_json::from_slice(&bytes).map_err(|_|"Corrupt export job file.")?;data.validate()?;Ok(data)};
    if !path.exists()&&!path.with_extension("json.bak").exists(){return Ok(Jobs::default());}
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){read(&path.with_extension("json.bak"))}else{Err(e)})
}
pub fn save(path:&Path,jobs:&Jobs)->Result<(),String>{
    jobs.validate()?;let bytes=serde_json::to_vec(jobs).map_err(|e|e.to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,|data|{
        let jobs:Jobs=serde_json::from_slice(data).map_err(|e|e.to_string())?;jobs.validate()
    })
}

#[cfg(test)]mod tests{
    use super::*;
    #[test] fn transient_native_complete_event_is_not_verified_export(){
        let mut job=Job::new("job-bridge".into(),"P","S","C:/exports/a.mp4",None,true).unwrap();
        job.bridge_state="queued".into();
        job.bridge_request_id=Some("bridge-123".into());
        let observation=json!({"shuviExportObservations":[{
            "bridgeRequestId":"bridge-123","output":"C:/exports/a.mp4",
            "windowComplete":true,"queueCandidateCount":1,
            "queueCandidateObserved":true,"nativeJobIdCandidate":"adobe-456",
            "nativeCorrelation":"exact_output_single_queue_candidate_external_writer_race_unexcluded",
            "latestNativeTerminalEvent":"complete","nativeCompleteEventCandidateObserved":true,
            "nativeErrorOrCancelObserved":false,"encoderCompletionVerified":false,
            "fileGeneratedByThisShuviRequestVerified":false,"finalDeliveryReady":false
        }]});
        job.validate().unwrap();
        let result=job.native_event_observation(Some(&observation));
        assert_eq!(result["observational_native_event_bound"],true);
        assert_eq!(result["native_complete_event_candidate_observed"],true);
        assert_eq!(result["encoder_completion_verified"],false);
        assert_eq!(result["export_job_output_attribution_verified"],false);
        assert_eq!(result["final_delivery_ready"],false);
        assert_eq!(result["retry_safe"],false);
        let mut mismatched=observation.clone();
        mismatched["shuviExportObservations"][0]["output"]=json!("C:/exports/other.mp4");
        assert_eq!(job.native_event_observation(Some(&mismatched))["observational_native_event_bound"],false);
        let mut bad=observation.clone();
        bad["shuviExportObservations"][0]["windowComplete"]=json!(false);
        assert_eq!(job.native_event_observation(Some(&bad))["observational_native_event_bound"],false);
        let mut pretended=observation.clone();
        pretended["shuviExportObservations"][0]["encoderCompletionVerified"]=json!(true);
        assert_eq!(job.native_event_observation(Some(&pretended))["observational_native_event_bound"],false);
        job.bridge_state="execution_status_unknown".into();
        assert_eq!(job.native_event_observation(Some(&observation))["observational_native_event_bound"],false);
    }
    #[test] fn legacy_export_jobs_deserialize_and_bridge_identity_is_bounded(){
        let mut job=Job::new("old".into(),"p","s","C:/out.mp4",None,false).unwrap();
        let mut payload=serde_json::to_value(&job).unwrap();
        payload.as_object_mut().unwrap().remove("bridge_request_id");
        let old:Job=serde_json::from_value(payload).unwrap();
        assert!(old.bridge_request_id.is_none());
        job.bridge_request_id=Some("bridge ok".into());
        assert!(job.validate().is_err());
        job.bridge_request_id=Some("a".repeat(161));
        assert!(job.validate().is_err());
    }

    #[test] fn oversized_persisted_jobs_are_rejected_before_decoding() {
        let file=std::env::temp_dir().join(format!("shuvi-oversized-jobs-{}.json",uuid::Uuid::new_v4()));
        let handle=fs::File::create(&file).unwrap();
        handle.set_len((MAX_BYTES+1) as u64).unwrap();drop(handle);
        assert!(load(&file).unwrap_err().contains("bounded read limit"));
        fs::remove_file(file).unwrap();
    }
    #[test] fn stable_file_is_not_encoder_completion(){
        let dir=std::env::temp_dir().join(format!("shuvi-export-jobs-{}",std::process::id()));fs::create_dir_all(&dir).unwrap();
        let file=dir.join("test.mp4");fs::write(&file,b"not media").unwrap();
        let mut job=Job::new("id".into(),"p","s",file.to_str().unwrap(),None,true).unwrap();
        let first=job.observe_once().unwrap();assert_eq!(first["file_stable"],false);
        job.observations[0].at_ms=job.observations[0].at_ms.saturating_sub(2000);
        let second=job.observe_once().unwrap();assert_eq!(second["file_stable"],true);
        assert_eq!(second["encoder_completion_verified"],false);assert_eq!(second["preexisting_output"],true);
        assert_eq!(second["media_parse_verified"],false);assert_eq!(second["completion_verified"],false);
        let challenge=job.media_validation_challenge().unwrap();
        let receipt=MediaValidationReceipt{schema_version:1,job_id:"id".into(),output:file.to_str().unwrap().into(),
            observed_size_bytes:challenge["observed_size_bytes"].as_u64().unwrap(),
            observed_modified_ms:challenge["observed_modified_ms"].as_u64(),
            validator:"test-parser/1".into(),playable:true,container:Some("test".into()),video_streams:Some(1),audio_streams:Some(1)};
        job.record_media_validation(receipt).unwrap();
        let parsed=job.observe_once().unwrap();assert_eq!(parsed["media_parse_verified"],true);
        assert_eq!(parsed["encoder_completion_verified"],false);assert_eq!(parsed["completion_verified"],false);
        let mut stale=job.media_validation.clone().unwrap();stale.observed_size_bytes+=1;
        assert!(job.record_media_validation(stale).unwrap_err().contains("stale"));
        job.encoder_completion_verified=true;assert!(job.validate().is_err());
        fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
