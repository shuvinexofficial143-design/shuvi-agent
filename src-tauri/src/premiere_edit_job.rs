use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{fs,io::{Read,Write},path::Path};

use crate::premiere_assembly::Assembly;
use crate::premiere_delivery::{FrameBatch, InterchangeRequest};
use crate::premiere_finishing::Request as FinishingRequest;
use crate::premiere_layering::{LayerBatch, TrackOrganization};
use crate::premiere_media_prep::{Batch as MediaPrepBatch, WorkArea};
use crate::premiere_scene_detection::Request as SceneDetectionRequest;
use crate::premiere_talking_head::Request as TranscriptRequest;
use crate::premiere_transcript_rebuild::Request as TranscriptRebuildRequest;
use crate::premiere_target::{ExpectedClip,PremiereExpectation};

const MAX_STATE_BYTES: usize = 128 * 1024;
const MAX_REVIEW_FRAMES: usize = 8;

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewSpec {
    pub seconds:Vec<f64>,
    pub prompt:String,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExportSpec {
    pub output:String,
    #[serde(default)] pub preset:Option<String>,
    #[serde(default)] pub queue_to_ame:bool,
    #[serde(default)] pub overwrite:bool,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version:u8,
    pub job_type:String,
    #[serde(default)] pub talking_head_strategy:Option<String>,
    #[serde(default)] pub media_prep:Option<MediaPrepBatch>,
    #[serde(default)] pub scene_detection:Option<SceneDetectionRequest>,
    #[serde(default)] pub transcript_cuts:Option<TranscriptRequest>,
    #[serde(default)] pub transcript_rebuild:Option<TranscriptRebuildRequest>,
    #[serde(default)] pub assembly:Option<Assembly>,
    #[serde(default)] pub track_organization:Option<TrackOrganization>,
    #[serde(default)] pub layering:Option<LayerBatch>,
    #[serde(default)] pub finishing:Option<FinishingRequest>,
    #[serde(default)] pub work_area:Option<WorkArea>,
    #[serde(default)] pub review:Option<ReviewSpec>,
    #[serde(default)] pub frame_delivery:Option<FrameBatch>,
    #[serde(default)] pub interchange_export:Option<InterchangeRequest>,
    #[serde(default)] pub export:Option<ExportSpec>,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Phase {
    pub id:String,
    pub tool:String,
    pub state:String,
    #[serde(default)] pub action_id:Option<String>,
    #[serde(default)] pub error:Option<String>,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    pub schema_version:u8,
    pub job_id:String,
    pub job_type:String,
    pub created_at_ms:u64,
    pub updated_at_ms:u64,
    pub project_guid:String,
    pub project_path:Option<String>,
    pub sequence_guid:String,
    pub status:String,
    pub request:Request,
    pub phases:Vec<Phase>,
    #[serde(default)] pub transcript_snapshot:Option<String>,
    #[serde(default)] pub transcript_expected:Option<PremiereExpectation>,
}

fn bounded_time(value:f64)->bool {
    value.is_finite() && (0.0..=86400.0).contains(&value)
}
fn bounded<T:Serialize>(value:&T)->Result<Vec<u8>,String>{
    let bytes=serde_json::to_vec(value).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_STATE_BYTES{return Err("Premiere edit job exceeds the 128 KiB state limit.".into());}
    Ok(bytes)
}

impl ReviewSpec {
    fn validate(&self)->Result<(),String>{
        if self.seconds.is_empty()||self.seconds.len()>MAX_REVIEW_FRAMES
            ||self.seconds.iter().any(|seconds|!bounded_time(*seconds))
            ||self.prompt.trim().is_empty()||self.prompt.chars().count()>4000
        {
            return Err("Edit-job review requires 1–8 bounded timestamps and a non-empty prompt.".into());
        }
        Ok(())
    }
}
impl ExportSpec {
    fn validate(&self)->Result<(),String>{
        if self.output.trim().is_empty()||self.output.len()>32768
            ||self.preset.as_ref().is_some_and(|value|value.trim().is_empty()||value.len()>32768)
        {
            return Err("Edit-job export paths are missing or oversized.".into());
        }
        Ok(())
    }
}
impl Request {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1
            ||!matches!(self.job_type.as_str(),"talking_head"|"social_reel"|"product_ad"|"wedding_highlight"|"corporate"|"custom")
        {
            return Err("Edit job requires schema v1 and a supported explicit job_type.".into());
        }
        if self.media_prep.is_none()&&self.scene_detection.is_none()&&self.transcript_cuts.is_none()
            &&self.transcript_rebuild.is_none()&&self.assembly.is_none()&&self.track_organization.is_none()
            &&self.layering.is_none()&&self.finishing.is_none()&&self.work_area.is_none()
            &&self.review.is_none()&&self.frame_delivery.is_none()&&self.interchange_export.is_none()&&self.export.is_none(){
            return Err("Edit job contains no executable phase.".into());
        }
        if self.transcript_cuts.is_some() && self.transcript_rebuild.is_some(){
            return Err("Edit job must choose direct transcript cuts OR source rebuild, not both.".into());
        }
        if let Some(strategy)=&self.talking_head_strategy{
            if !matches!(strategy.as_str(),"direct_cut"|"source_rebuild"){
                return Err("talking_head_strategy must be direct_cut or source_rebuild.".into());
            }
            if strategy=="direct_cut" && (self.transcript_cuts.is_none()||self.transcript_rebuild.is_some()){
                return Err("direct_cut strategy requires transcript_cuts and no transcript_rebuild.".into());
            }
            if strategy=="source_rebuild" && (self.transcript_rebuild.is_none()||self.transcript_cuts.is_some()){
                return Err("source_rebuild strategy requires transcript_rebuild and no transcript_cuts.".into());
            }
        } else if self.transcript_rebuild.is_some() {
            return Err("Transcript rebuild requires explicit talking_head_strategy=source_rebuild.".into());
        }
        let delivery_count=(self.export.is_some() as usize)+(self.frame_delivery.is_some() as usize)+(self.interchange_export.is_some() as usize);
        if delivery_count>1{
            return Err("Edit job allows one primary delivery: media export, review frames, or interchange export.".into());
        }
        if let Some(value)=&self.media_prep{value.validate()?;}
        if let Some(value)=&self.scene_detection{value.validate()?;}
        if let Some(value)=&self.transcript_cuts{value.validate()?;}
        if let Some(value)=&self.transcript_rebuild{value.validate()?;}
        if let Some(value)=&self.assembly{value.validate()?;}
        if let Some(value)=&self.track_organization{value.validate()?;}
        if let Some(value)=&self.layering{value.validate()?;}
        if let Some(value)=&self.finishing{value.validate()?;}
        if let Some(value)=&self.work_area{value.validate()?;}
        if let Some(value)=&self.review{value.validate()?;}
        if let Some(value)=&self.frame_delivery{value.validate()?;}
        if let Some(value)=&self.interchange_export{value.validate()?;}
        if let Some(value)=&self.export{value.validate()?;}
        bounded(self)?;
        Ok(())
    }
}

impl Job {
    pub fn new(
        job_id:String,
        request:Request,
        project_guid:&str,
        project_path:Option<&str>,
        sequence_guid:&str,
        now_ms:u64,
    )->Result<Self,String>{
        request.validate()?;
        if project_guid.is_empty()||project_guid.len()>240||sequence_guid.is_empty()||sequence_guid.len()>240 {
            return Err("Edit job requires live project and sequence identity.".into());
        }
        let mut phases=Vec::new();
        let mut push=|id:&str,tool:&str|phases.push(Phase{
            id:id.into(),tool:tool.into(),state:"pending".into(),action_id:None,error:None
        });
        if request.media_prep.is_some(){push("media_prep","premiere_prepare_media_batch");}
        if request.scene_detection.is_some(){
            let tool=if request.scene_detection.as_ref().is_some_and(|value|value.mode=="cuts"){
                "premiere_detect_scene_cuts"
            }else{"premiere_detect_scene_markers"};
            push("scene_detection",tool);
        }
        if request.transcript_cuts.is_some(){push("transcript_cuts","premiere_apply_transcript_cuts");}
        if request.transcript_rebuild.is_some(){push("transcript_rebuild","premiere_apply_transcript_rebuild");}
        if request.assembly.is_some(){push("assembly","premiere_apply_assembly");}
        if request.track_organization.is_some(){push("track_organization","premiere_organize_tracks");}
        if request.layering.is_some(){push("layering","premiere_layer_clips");}
        if request.finishing.is_some(){push("finishing","premiere_finish_media_batch");}
        if request.work_area.is_some(){push("work_area","premiere_set_work_area");}
        if request.review.is_some(){push("review","premiere_review_frames");}
        if request.frame_delivery.is_some(){push("frame_delivery","premiere_export_review_frames");}
        if request.interchange_export.is_some(){
            let tool=match request.interchange_export.as_ref().map(|value|value.format.as_str()){
                Some("aaf")=>"premiere_export_aaf",
                Some("otio")=>"premiere_export_otio",
                _=>"premiere_export_fcpxml",
            };
            push("interchange_export",tool);
        }
        if request.export.is_some(){
            push("export_preflight","premiere_plan_export");
            push("export_dispatch","premiere_export_sequence");
        }
        let job=Self{
            schema_version:1,job_id,job_type:request.job_type.clone(),created_at_ms:now_ms,updated_at_ms:now_ms,
            project_guid:project_guid.into(),project_path:project_path.map(str::to_string),sequence_guid:sequence_guid.into(),
            status:"running".into(),request,phases,transcript_snapshot:None,transcript_expected:None,
        };
        bounded(&job)?;
        Ok(job)
    }

    pub fn identity(&self,context:&Value)->Result<(),String>{
        let project=context.get("projectGuid").and_then(Value::as_str).unwrap_or("");
        let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).unwrap_or("");
        let path=context.get("projectPath").and_then(Value::as_str);
        if project!=self.project_guid||sequence!=self.sequence_guid
            ||self.project_path.as_deref().is_some_and(|saved|path!=Some(saved))
        {
            return Err("Edit job belongs to another or changed Premiere project/sequence.".into());
        }
        Ok(())
    }

    pub fn pending(&self)->Option<&Phase>{
        self.phases.iter().find(|phase|phase.state=="pending")
    }
    pub fn pending_mut(&mut self)->Option<&mut Phase>{
        self.phases.iter_mut().find(|phase|phase.state=="pending")
    }
    pub fn phase(&self,id:&str)->Option<&Phase>{self.phases.iter().find(|phase|phase.id==id)}

    pub fn record(&mut self,phase_id:&str,tool:&str,action_id:&str,success:bool,now_ms:u64)->Result<(),String>{
        if self.status!="running"{return Err("Edit job is not running.".into());}
        let expected=self.pending().ok_or("Edit job has no pending phase.")?;
        if expected.id!=phase_id||expected.tool!=tool{return Err("Audit receipt does not match the next edit-job phase.".into());}
        let phase=self.pending_mut().ok_or("Edit job phase disappeared.")?;
        phase.action_id=Some(action_id.into());
        phase.state=if success{"completed".into()}else{"failed".into()};
        if !success {
            phase.error=Some("Typed phase action failed; edit job stopped.".into());
            self.status="failed".into();
        } else if self.pending().is_none() {
            self.status=if self.request.export.is_some(){"export_dispatched".into()}
                else if self.request.interchange_export.is_some(){"interchange_delivered".into()}
                else if self.request.frame_delivery.is_some(){"frames_delivered".into()}
                else{"complete".into()};
        }
        self.updated_at_ms=now_ms;
        bounded(self)?;
        Ok(())
    }

    pub fn cancel(&mut self,now_ms:u64){
        if matches!(self.status.as_str(),"running"|"paused"){
            self.status="cancelled".into();
            for phase in &mut self.phases {
                if phase.state=="pending"{phase.state="cancelled".into();}
            }
            self.updated_at_ms=now_ms;
        }
    }

    pub fn set_transcript_preflight(&mut self,snapshot:String,expected:PremiereExpectation,now_ms:u64)->Result<(),String>{
        if !snapshot.starts_with("fnv1a64:")||snapshot.len()!=24{return Err("Invalid transcript snapshot.".into());}
        expected.validate()?;
        if expected.project_guid!=self.project_guid||expected.sequence_guid.as_deref()!=Some(self.sequence_guid.as_str()){
            return Err("Transcript preflight identity does not match edit job.".into());
        }
        self.transcript_snapshot=Some(snapshot);
        self.transcript_expected=Some(expected);
        self.updated_at_ms=now_ms;
        bounded(self)?;
        Ok(())
    }

    pub fn project_expectation(&self)->PremiereExpectation{
        PremiereExpectation{
            project_guid:self.project_guid.clone(),
            project_path:self.project_path.clone(),
            sequence_guid:Some(self.sequence_guid.clone()),
            clips:Vec::new(),
        }
    }
}

fn timeline_clip(timeline:&Value,kind:&str,track:u32,clip_index:u32)->Result<ExpectedClip,String>{
    if timeline.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Edit job requires a complete timeline inspection for exact clip expectations.".into());
    }
    let key=if kind=="video"{"videoTracks"}else{"audioTracks"};
    let tracks=timeline.get(key).and_then(Value::as_array).ok_or("Timeline tracks missing.")?;
    let row=tracks.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(track as u64))
        .ok_or("Requested edit-job track is missing.")?;
    let item=row.get("items").and_then(Value::as_array)
        .and_then(|items|items.get(clip_index as usize)).ok_or("Requested edit-job clip is missing.")?;
    let signature=item.get("targetSignature").and_then(Value::as_str).filter(|value|!value.is_empty())
        .ok_or("Edit-job target signature is unavailable.")?;
    Ok(ExpectedClip{kind:kind.into(),track,clip_index,signature:signature.into()})
}

pub fn expectation_for_transcript(job:&Job,timeline:&Value,request:&TranscriptRequest)->Result<PremiereExpectation,String>{
    let mut clips=vec![timeline_clip(timeline,"video",request.video.track,request.video.clip_index)?];
    if let Some(audio)=&request.audio{clips.push(timeline_clip(timeline,"audio",audio.track,audio.clip_index)?);}
    let expected=PremiereExpectation{
        project_guid:job.project_guid.clone(),project_path:job.project_path.clone(),
        sequence_guid:Some(job.sequence_guid.clone()),clips
    };
    expected.validate()?;Ok(expected)
}

pub fn expectation_for_finishing(job:&Job,timeline:&Value,request:&FinishingRequest)->Result<PremiereExpectation,String>{
    let mut clips=Vec::new();
    for video in &request.videos{clips.push(timeline_clip(timeline,"video",video.track,video.clip_index)?);}
    for audio in &request.audios{clips.push(timeline_clip(timeline,"audio",audio.target.track,audio.target.clip_index)?);}
    let expected=PremiereExpectation{
        project_guid:job.project_guid.clone(),project_path:job.project_path.clone(),
        sequence_guid:Some(job.sequence_guid.clone()),clips
    };
    expected.validate()?;Ok(expected)
}

pub fn expectation_for_layering(job:&Job,timeline:&Value,batch:&LayerBatch)->Result<PremiereExpectation,String>{
    let mut clips=Vec::new();
    for source in batch.unique_sources(){
        let clip=timeline_clip(timeline,&source.kind,source.track,source.clip_index)?;
        if clip.signature!=source.signature{
            return Err("Layering source changed after an earlier edit-job phase; provide a fresh job request instead of guessing a new clip index.".into());
        }
        clips.push(clip);
    }
    let expected=PremiereExpectation{
        project_guid:job.project_guid.clone(),project_path:job.project_path.clone(),
        sequence_guid:Some(job.sequence_guid.clone()),clips
    };
    expected.validate()?;Ok(expected)
}

pub fn expectation_for_scene(job:&Job,timeline:&Value,request:&SceneDetectionRequest)->Result<PremiereExpectation,String>{
    let mut clips=Vec::new();
    for target in &request.targets{
        let clip=timeline_clip(timeline,"video",target.track,target.clip_index)?;
        if clip.signature!=target.signature{
            return Err("Scene-detection target changed after an earlier edit-job phase; provide a fresh job request instead of guessing target identity.".into());
        }
        clips.push(clip);
    }
    let expected=PremiereExpectation{
        project_guid:job.project_guid.clone(),project_path:job.project_path.clone(),
        sequence_guid:Some(job.sequence_guid.clone()),clips
    };
    expected.validate()?;Ok(expected)
}

pub fn save(path:&Path,job:&Job)->Result<(),String>{
    let bytes=bounded(job)?;
    if let Some(parent)=path.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let temp=path.with_extension("json.tmp");
    let backup=path.with_extension("json.bak");
    if temp.exists()||backup.exists(){return Err("Edit-job store has an interrupted update; inspect recovery files first.".into());}
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;
    file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
    drop(file);
    if path.exists(){fs::rename(path,&backup).map_err(|e|e.to_string())?;}
    if let Err(error)=fs::rename(&temp,path){
        if backup.exists(){let _=fs::rename(&backup,path);}
        return Err(error.to_string());
    }
    if backup.exists(){fs::remove_file(backup).map_err(|e|e.to_string())?;}
    Ok(())
}

pub fn load(path:&Path)->Result<Job,String>{
    if path.with_extension("json.tmp").exists()||path.with_extension("json.bak").exists(){
        return Err("Edit-job store has an interrupted update; inspect recovery files first.".into());
    }
    let mut bytes=Vec::new();
    fs::File::open(path).map_err(|e|e.to_string())?.take((MAX_STATE_BYTES+1) as u64)
        .read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_STATE_BYTES{return Err("Edit-job state exceeds 128 KiB.".into());}
    let job:Job=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    job.request.validate()?;
    bounded(&job)?;
    Ok(job)
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    fn request()->Request{
        serde_json::from_value(json!({
            "schema_version":1,"job_type":"corporate",
            "review":{"seconds":[1,5],"prompt":"Check framing and graphics"},
            "export":{"output":"C:/out.mp4","queue_to_ame":false,"overwrite":false}
        })).unwrap()
    }
    #[test]fn phases_are_real_typed_tools_and_export_is_separate(){
        let job=Job::new("job".into(),request(),"p",Some("C:/test.prproj"),"s",1).unwrap();
        assert_eq!(job.phases.iter().map(|p|p.tool.as_str()).collect::<Vec<_>>(),
            vec!["premiere_review_frames","premiere_plan_export","premiere_export_sequence"]);
    }
    #[test]fn receipt_must_match_next_phase(){
        let mut job=Job::new("job".into(),request(),"p",None,"s",1).unwrap();
        assert!(job.record("export_preflight","premiere_plan_export","a",true,2).is_err());
        job.record("review","premiere_review_frames","a",true,2).unwrap();
        assert_eq!(job.pending().unwrap().id,"export_preflight");
    }
    #[test]fn finishing_expectation_uses_native_signatures(){
        let request:FinishingRequest=serde_json::from_value(json!({
            "schema_version":1,
            "videos":[{"track":0,"clip_index":0,"request":{"preset":"natural_correction","bindings":[{"role":"contrast","component_match_name":"native","param_display_name":"Contrast","unit":1,"min":0,"max":2}]}}],
            "audios":[],"graphics":null,"review":false
        })).unwrap();
        let job=Job::new("job".into(),Request{
            schema_version:1,job_type:"custom".into(),talking_head_strategy:None,
            media_prep:None,scene_detection:None,transcript_cuts:None,transcript_rebuild:None,
            assembly:None,track_organization:None,layering:None,finishing:Some(request.clone()),
            work_area:None,review:None,frame_delivery:None,interchange_export:None,export:None
        },"p",None,"s",1).unwrap();
        let timeline=json!({"truncated":false,"videoTracks":[{"index":0,"items":[{"targetSignature":"sig"}]}],"audioTracks":[]});
        assert_eq!(expectation_for_finishing(&job,&timeline,&request).unwrap().clips[0].signature,"sig");
    }
    #[test]fn rebuild_requires_explicit_strategy(){
        let value=json!({
            "schema_version":1,"job_type":"talking_head",
            "transcript_rebuild":{
                "schema_version":1,"item_id":"media","source":{"track":0,"clip_index":0},
                "transcript_source_offset":0,"removals":[{"start":2,"end":3}],
                "destination":{"mode":"explicit_empty_target_sequence","sequence_guid":"dest","video_track":0,"audio_track":0},
                "take_video":true,"take_audio":false
            }
        });
        let request:Request=serde_json::from_value(value).unwrap();
        assert!(request.validate().is_err());
    }
    #[test]fn one_primary_delivery_only(){
        let value=json!({
            "schema_version":1,"job_type":"corporate",
            "frame_delivery":{"schema_version":1,"frames":[{"seconds":1,"output":"C:/tmp/a.png","width":1920,"height":1080}]},
            "export":{"output":"C:/out.mp4","queue_to_ame":false,"overwrite":false}
        });
        let request:Request=serde_json::from_value(value).unwrap();
        assert!(request.validate().is_err());
    }
    #[test]fn optional_advanced_phases_preserve_typed_order(){
        let value=json!({
            "schema_version":1,"job_type":"corporate",
            "track_organization":{"schema_version":1,"tracks":[{"kind":"video","track":0,"name":"A-Roll"}]},
            "work_area":{"in_seconds":1,"out_seconds":4}
        });
        let request:Request=serde_json::from_value(value).unwrap();
        let job=Job::new("job".into(),request,"p",None,"s",1).unwrap();
        assert_eq!(job.phases.iter().map(|p|p.tool.as_str()).collect::<Vec<_>>(),
            vec!["premiere_organize_tracks","premiere_set_work_area"]);
    }
}
