use serde::{Deserialize,Serialize};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs,io::{Read,Write},path::Path};

use crate::premiere_assembly::Assembly;
use crate::premiere_caption_graphics::Request as CaptionGraphicsRequest;
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
    #[serde(default)] pub iterative:bool,
    #[serde(default)] pub max_iterations:Option<u8>,
    #[serde(default)] pub reference:Option<String>,
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
    #[serde(default)] pub caption_graphics:Option<CaptionGraphicsRequest>,
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
    #[serde(default)] pub review_session_id:Option<String>,
    #[serde(default)] pub error:Option<String>,
    #[serde(default)] pub proposal_issued_at_ms:Option<u64>,
    #[serde(default)] pub proposal_arguments_sha256:Option<String>,
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

/// Digest the exact JSON arguments displayed for separate owner approval.
/// The same serde_json encoding is used when the typed action is staged.
pub fn proposal_arguments_sha256(args:&Value)->Result<String,String>{
    let bytes=serde_json::to_vec(args).map_err(|e|e.to_string())?;
    Ok(format!("{:x}",Sha256::digest(bytes)))
}

impl ReviewSpec {
    fn validate(&self)->Result<(),String>{
        if self.seconds.is_empty()||self.seconds.len()>MAX_REVIEW_FRAMES
            ||self.seconds.iter().any(|seconds|!bounded_time(*seconds))
            ||self.prompt.trim().is_empty()||self.prompt.chars().count()>4000
        {
            return Err("Edit-job review requires 1–8 bounded timestamps and a non-empty prompt.".into());
        }
        if self.iterative {
            if self.seconds.len()>4 || !(1..=8).contains(&self.max_iterations.unwrap_or(4))
                || self.reference.as_ref().is_some_and(|value|value.chars().count()>2000) {
                return Err("Iterative edit-job review requires 1–4 samples, 1–8 iterations, and a bounded reference.".into());
            }
        } else if self.max_iterations.is_some() || self.reference.is_some() {
            return Err("max_iterations/reference are only valid when review.iterative=true.".into());
        }
        Ok(())
    }
    pub fn iteration_limit(&self)->u8{self.max_iterations.unwrap_or(4)}
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
            &&self.layering.is_none()&&self.finishing.is_none()&&self.caption_graphics.is_none()&&self.work_area.is_none()
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
        if let Some(value)=&self.caption_graphics{value.validate()?;}
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
        if request.caption_graphics.is_some() && project_path.is_none_or(str::is_empty) {
            return Err("Caption graphics edit job needs a previously saved exact .prproj path before approved native insertion/save.".into());
        }
        if project_guid.is_empty()||project_guid.len()>240||sequence_guid.is_empty()||sequence_guid.len()>240 {
            return Err("Edit job requires live project and sequence identity.".into());
        }
        let mut phases=Vec::new();
        let mut push=|id:&str,tool:&str|phases.push(Phase{
            id:id.into(),tool:tool.into(),state:"pending".into(),action_id:None,review_session_id:None,error:None,proposal_issued_at_ms:None,proposal_arguments_sha256:None
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
        if request.caption_graphics.is_some(){
            push("caption_graphics_plan","premiere_plan_caption_graphics");
            push("caption_graphics_apply","premiere_apply_caption_graphics");
            push("caption_project_save","premiere_save_project");
        }
        if let Some(review)=&request.review{
            push("review",if review.iterative{"premiere_review_session_start"}else{"premiere_review_frames"});
        }
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

    /// Persist the first proposal time for the current phase. A repeated read-only
    /// proposal must not reset the receipt boundary and invalidate a legitimate
    /// separately approved action that is awaiting recording.
    pub fn issue_proposal(&mut self,phase_id:&str,now_ms:u64)->Result<(),String>{
        if self.status!="running"||now_ms<self.created_at_ms {
            return Err("Edit-job proposal requires a running job and valid timestamp.".into());
        }
        let phase=self.pending_mut().ok_or("Edit job has no pending phase.")?;
        if phase.id!=phase_id {return Err("Cannot issue a proposal for a later phase.".into());}
        if phase.proposal_issued_at_ms.is_none() {
            phase.proposal_issued_at_ms=Some(now_ms);
        }
        self.updated_at_ms=now_ms;
        bounded(self)?;
        Ok(())
    }

    /// Bind the exact phase arguments before issuing a separate approved tool.
    /// Repeated Next calls may recheck the plan but may not replace a staged
    /// first proposal with different arguments or silently reapprove it.
    pub fn bind_proposal_arguments(&mut self,phase_id:&str,args:&Value)->Result<(),String>{
        let hash=proposal_arguments_sha256(args)?;
        let phase=self.pending_mut().ok_or("Edit job has no pending phase.")?;
        if phase.id!=phase_id || phase.proposal_issued_at_ms.is_none(){
            return Err("Edit-job arguments require the current issued phase.".into());
        }
        match phase.proposal_arguments_sha256.as_deref(){
            Some(previous) if previous!=hash=>return Err(
                "Edit-job proposed arguments changed after approval boundary; start a fresh bounded job.".into()),
            Some(_)=>{},
            None=>phase.proposal_arguments_sha256=Some(hash),
        }
        bounded(self)?;
        Ok(())
    }

    /// Compare the exact approved argument digest with the durable executed
    /// audit receipt. A missing/legacy token never grants completion.
    pub fn require_bound_action_arguments(&self,phase_id:&str,audit_detail:&str)->Result<(),String>{
        let phase=self.pending().ok_or("Edit job has no pending phase.")?;
        if phase.id!=phase_id{return Err("Edit-job receipt phase changed.".into());}
        let expected=phase.proposal_arguments_sha256.as_deref()
            .ok_or("Edit-job phase has no bound approval arguments; rerun premiere_edit_job_next.")?;
        let candidate=audit_detail.split(" | ").find_map(|part|
            part.strip_prefix("premiere_args_sha256="));
        if candidate!=Some(expected) || !expected.bytes().all(|b|b.is_ascii_hexdigit()) || expected.len()!=64 {
            return Err("Executed Premiere action arguments do not match the exact issued edit-job phase.".into());
        }
        Ok(())
    }

    /// Audit receipt gate: tool identity and live project/sequence are verified
    /// by the caller; this also forbids pre-proposal receipts and same-job replay.
    /// This does not cryptographically attest full action arguments or cross-job use.
    pub fn require_issued_action_receipt(
        &self,phase_id:&str,action_id:&str,receipt_timestamp_ms:u64
    )->Result<(),String>{
        if self.status!="running" {return Err("Edit job is not running.".into());}
        let phase=self.pending().ok_or("Edit job has no pending phase.")?;
        if phase.id!=phase_id {return Err("Audit receipt belongs to another edit-job phase.".into());}
        let issued=phase.proposal_issued_at_ms
            .ok_or("Run premiere_edit_job_next and inspect the proposal before recording its approved action.")?;
        if receipt_timestamp_ms<issued || receipt_timestamp_ms<self.created_at_ms {
            return Err("Action receipt predates this edit-job phase proposal.".into());
        }
        if action_id.is_empty() || self.phases.iter().any(|p|p.action_id.as_deref()==Some(action_id)) {
            return Err("Action ID is absent or already consumed by another phase of this edit job.".into());
        }
        Ok(())
    }

    pub fn record(&mut self,phase_id:&str,tool:&str,action_id:&str,success:bool,now_ms:u64)->Result<(),String>{
        if self.status!="running"{return Err("Edit job is not running.".into());}
        let expected=self.pending().ok_or("Edit job has no pending phase.")?;
        if expected.id!=phase_id||expected.tool!=tool{return Err("Audit receipt does not match the next edit-job phase.".into());}
        if expected.id=="review" && expected.tool=="premiere_review_session_start" {
            return Err("Iterative review phase completes only from bounded completed review-session evidence.".into());
        }
        if action_id.is_empty() || self.phases.iter().any(|p|p.action_id.as_deref()==Some(action_id)) {
            return Err("An action ID must not be absent or reused in this edit job.".into());
        }
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

    pub fn record_review(&mut self,phase_id:&str,review_session_id:&str,now_ms:u64)->Result<(),String>{
        if self.status!="running"{return Err("Edit job is not running.".into());}
        let expected=self.pending().ok_or("Edit job has no pending phase.")?;
        if expected.id!=phase_id || expected.tool!="premiere_review_session_start" {
            return Err("Completed review evidence does not match the next iterative review phase.".into());
        }
        if review_session_id.is_empty()||review_session_id.len()>80 {
            return Err("Invalid bounded review session ID.".into());
        }
        let phase=self.pending_mut().ok_or("Edit job phase disappeared.")?;
        phase.review_session_id=Some(review_session_id.into());
        phase.state="completed".into();
        if self.pending().is_none() {
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

    /// Cross-check the persisted phase ledger against a plan freshly derived
    /// from the immutable, validated request. This is corruption/recovery
    /// detection, not authentication of who authored the JSON on disk.
    pub fn validate_state(&self)->Result<(),String>{
        if self.created_at_ms>self.updated_at_ms || self.job_id.is_empty()
            ||self.job_id.len()>80 {
            return Err("Edit-job state has invalid identity or timestamps.".into());
        }
        let fresh=Self::new(self.job_id.clone(),self.request.clone(),&self.project_guid,
            self.project_path.as_deref(),&self.sequence_guid,self.created_at_ms)?;
        if self.phases.len()!=fresh.phases.len() {
            return Err("Edit-job persisted phase count differs from the typed request.".into());
        }
        let mut seen_incomplete=false;
        let mut pending_count=0usize;
        let mut failed_count=0usize;
        let mut cancelled_count=0usize;
        let mut action_ids=std::collections::HashSet::new();
        for (phase,canonical) in self.phases.iter().zip(fresh.phases.iter()) {
            if phase.id!=canonical.id || phase.tool!=canonical.tool {
                return Err("Edit-job phase order or tool differs from the typed request.".into());
            }
            let completed=phase.state=="completed";
            if completed && seen_incomplete {
                return Err("Edit-job has an approved phase after an incomplete phase.".into());
            }
            if !completed {seen_incomplete=true;}
            match phase.state.as_str(){
                "completed"=>{},
                "pending"=>pending_count+=1,
                "failed"=>failed_count+=1,
                "cancelled"=>cancelled_count+=1,
                _=>return Err("Edit-job phase has an unknown persisted state.".into()),
            }
            if let Some(hash)=phase.proposal_arguments_sha256.as_deref(){
                if hash.len()!=64 || !hash.bytes().all(|b|b.is_ascii_hexdigit())
                    ||phase.proposal_issued_at_ms.is_none(){
                    return Err("Edit-job stored proposed argument hash is malformed or not issued.".into());
                }
            }
            if let Some(at)=phase.proposal_issued_at_ms {
                if at<self.created_at_ms || at>self.updated_at_ms {
                    return Err("Edit-job proposal timestamp falls outside its recorded lifetime.".into());
                }
                if phase.state=="pending" && pending_count>1 {
                    return Err("A later pending edit-job phase cannot have a proposal.".into());
                }
            }
            if let Some(id)=phase.action_id.as_deref() {
                if id.is_empty() || !action_ids.insert(id) ||
                    !matches!(phase.state.as_str(),"completed"|"failed") {
                    return Err("Edit-job action receipt is duplicated or placed on an unexecuted phase.".into());
                }
            }
            if phase.tool=="premiere_review_session_start" {
                if phase.action_id.is_some()
                    || (completed && phase.review_session_id.as_deref().is_none_or(str::is_empty))
                    || (!completed && phase.review_session_id.is_some()) {
                    return Err("Iterative review requires a completed session instead of a single action receipt.".into());
                }
            } else if phase.review_session_id.is_some() ||
                (matches!(phase.state.as_str(),"completed"|"failed") && phase.action_id.is_none()) {
                return Err("Edit-job completed/failed phase lacks its typed action receipt.".into());
            }
            if (phase.state=="failed") != phase.error.is_some() {
                return Err("Edit-job failure reason does not match the recorded phase state.".into());
            }
        }
        if failed_count>1 || (failed_count>0 && cancelled_count>0) ||
            (cancelled_count>0 && pending_count>0) {
            return Err("Edit-job has inconsistent failed/cancelled/pending phase markers.".into());
        }
        let complete=!seen_incomplete;
        let expected_terminal=if self.request.export.is_some(){"export_dispatched"}
            else if self.request.interchange_export.is_some(){"interchange_delivered"}
            else if self.request.frame_delivery.is_some(){"frames_delivered"}
            else{"complete"};
        let status_matches=if failed_count==1 {self.status=="failed"}
            else if cancelled_count>0 {self.status=="cancelled"}
            else if complete {self.status==expected_terminal}
            else {matches!(self.status.as_str(),"running"|"paused") && pending_count>0};
        if !status_matches {
            return Err("Edit-job status does not match the ordered phase ledger.".into());
        }
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

/// Detect an action receipt already recorded by a different Shuvi 40 edit job.
/// Restrict the scan to this application's edit-job store; a damaged or
/// interrupted sibling record blocks receipt advancement for owner recovery.
/// The caller owns the existing native execution lease during this scan/save.
pub fn require_unclaimed_action_in_store(
    current_path:&Path,job_id:&str,action_id:&str
)->Result<(),String>{
    if action_id.is_empty() {return Err("Missing action receipt ID.".into());}
    let folder=current_path.parent().ok_or("Edit-job state has no parent folder.")?;
    let mut visited=0usize;
    for entry in fs::read_dir(folder).map_err(|e|e.to_string())? {
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name();
        let name=name.to_str().ok_or("Edit-job folder has an unrecognized file name.")?;
        if name.ends_with(".json.tmp") || name.ends_with(".json.bak") {
            return Err("Edit-job store has unresolved sibling update files; inspect recovery before recording receipts.".into());
        }
        if !name.ends_with(".json") {continue;}
        visited+=1;
        if visited>2048 {return Err("Edit-job receipt scan exceeds bounded store size.".into());}
        let id=name.strip_suffix(".json").ok_or("Invalid edit-job store entry.")?;
        uuid::Uuid::parse_str(id).map_err(|_|"Edit-job store has an invalid UUID filename.")?;
        let path=entry.path();
        let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Edit-job store contains an unsafe JSON state file.".into());
        }
        if path==current_path {continue;}
        let other=load(&path)?;
        if other.job_id!=id {
            return Err("Edit-job state ID differs from its durable filename.".into());
        }
        if other.job_id==job_id {
            return Err("Edit-job store has a duplicate canonical job identity.".into());
        }
        if other.phases.iter().any(|phase|phase.action_id.as_deref()==Some(action_id)) {
            return Err("The supplied approved action ID was already recorded by another Premiere edit job.".into());
        }
    }
    Ok(())
}

pub fn save(path:&Path,job:&Job)->Result<(),String>{
    job.validate_state()?;
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
    job.validate_state()?;
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
            caption_graphics:None,work_area:None,review:None,frame_delivery:None,interchange_export:None,export:None
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
    #[test]fn iterative_review_uses_bounded_session_and_not_one_shot_receipt(){
        let value=json!({
            "schema_version":1,"job_type":"social_reel",
            "review":{"seconds":[1,2,3],"prompt":"Check framing and graphics","iterative":true,"max_iterations":4,"reference":"brand brief"}
        });
        let request:Request=serde_json::from_value(value).unwrap();
        let mut job=Job::new("job".into(),request,"p",Some("C:/test.prproj"),"s",1).unwrap();
        assert_eq!(job.phases[0].tool,"premiere_review_session_start");
        assert!(job.record("review","premiere_review_session_start","action",true,2).is_err());
        job.record_review("review","review-session",2).unwrap();
        assert_eq!(job.status,"complete");
        assert_eq!(job.phases[0].review_session_id.as_deref(),Some("review-session"));
    }
    #[test]fn iterative_review_rejects_too_many_samples(){
        let value=json!({
            "schema_version":1,"job_type":"social_reel",
            "review":{"seconds":[1,2,3,4,5],"prompt":"Check edit","iterative":true}
        });
        let request:Request=serde_json::from_value(value).unwrap();
        assert!(request.validate().is_err());
    }
    #[test]fn selective_caption_graphics_join_audited_job_before_review_and_export(){
        let value=json!({
            "schema_version":1,"job_type":"social_reel",
            "caption_graphics":{"schema_version":1,
                "captions":{"schema_version":1,"output":"C:/captions.srt","duration_seconds":30.0,
                    "cues":[{"start_seconds":1.0,"end_seconds":2.0,"text":"नमस्ते","selected":true}]},
                "expected_srt_sha256":"a".repeat(64),"mapping":"Captions","revision":1,
                "video_track":2,"audio_track":0,"static_fields":{}},
            "review":{"seconds":[1.5],"prompt":"Check caption appearance"},
            "export":{"output":"C:/out.mp4","overwrite":false}
        });
        let request:Request=serde_json::from_value(value).unwrap();
        assert!(Job::new("no-project".into(),request.clone(),"P",None,"S",1).is_err());
        let mut job=Job::new("captions".into(),request,"P",Some("C:/edit.prproj"),"S",1).unwrap();
        assert_eq!(job.phases.iter().map(|p|p.tool.as_str()).collect::<Vec<_>>(),vec![
            "premiere_plan_caption_graphics","premiere_apply_caption_graphics",
            "premiere_save_project","premiere_review_frames",
            "premiere_plan_export","premiere_export_sequence"]);
        assert!(job.record("caption_graphics_apply","premiere_apply_caption_graphics","bad",true,2).is_err());
        for (index,id,tool) in [
            (0,"caption_graphics_plan","premiere_plan_caption_graphics"),
            (1,"caption_graphics_apply","premiere_apply_caption_graphics"),
            (2,"caption_project_save","premiere_save_project"),
        ] {
            assert_eq!(job.phases[index].id,id);
            job.record(id,tool,&format!("action{index}"),true,index as u64+2).unwrap();
        }
        assert_eq!(job.pending().unwrap().id,"review");
    }
    #[test]fn caption_request_rejects_missing_source_selection_without_any_job(){
        let request:Request=serde_json::from_value(json!({
            "schema_version":1,"job_type":"social_reel",
            "caption_graphics":{"schema_version":1,
                "captions":{"schema_version":1,"output":"C:/captions.srt","duration_seconds":30.0,
                    "cues":[{"start_seconds":1.0,"end_seconds":2.0,"text":"text","selected":false}]},
                "expected_srt_sha256":"a".repeat(64),"mapping":"Captions","revision":1,
                "video_track":2,"audio_track":0,"static_fields":{}}
        })).unwrap();
        assert!(request.validate().is_err());
    }
    #[test]fn edit_job_phase_proposal_and_receipt_are_temporally_bound(){
        let mut job=Job::new("job".into(),request(),"P",Some("C:/job.prproj"),"S",100).unwrap();
        assert!(job.require_issued_action_receipt("review","first",101).is_err());
        assert!(job.issue_proposal("export_preflight",101).is_err());
        job.issue_proposal("review",110).unwrap();
        assert!(job.require_issued_action_receipt("review","first",109).is_err());
        assert!(job.require_issued_action_receipt("review","first",110).is_ok());
        job.issue_proposal("review",120).unwrap();
        assert_eq!(job.pending().unwrap().proposal_issued_at_ms,Some(110));
        job.record("review","premiere_review_frames","first",true,121).unwrap();
        job.issue_proposal("export_preflight",130).unwrap();
        assert!(job.require_issued_action_receipt("export_preflight","first",131).is_err());
        assert!(job.require_issued_action_receipt("export_preflight","second",129).is_err());
        assert!(job.require_issued_action_receipt("export_preflight","second",131).is_ok());
        assert!(job.record("export_preflight","premiere_plan_export","first",true,132).is_err());
        job.record("export_preflight","premiere_plan_export","second",true,132).unwrap();
        assert_eq!(job.pending().unwrap().id,"export_dispatch");
    }
    #[test]fn legacy_edit_job_phase_is_compatible_but_requires_new_proposal(){
        let job=Job::new("old".into(),request(),"P",None,"S",100).unwrap();
        let mut old=serde_json::to_value(&job).unwrap();
        for phase in old["phases"].as_array_mut().unwrap() {
            phase.as_object_mut().unwrap().remove("proposal_issued_at_ms");
        }
        let mut restored:Job=serde_json::from_value(old).unwrap();
        assert_eq!(restored.pending().unwrap().proposal_issued_at_ms,None);
        assert!(restored.require_issued_action_receipt("review","older",101).is_err());
        restored.issue_proposal("review",105).unwrap();
        assert!(restored.require_issued_action_receipt("review","new",105).is_ok());
    }
    #[test]fn persisted_edit_job_ledger_rejects_skipped_or_reordered_phases(){
        let good=Job::new("ledger".into(),request(),"P",None,"S",100).unwrap();
        assert!(good.validate_state().is_ok());
        let mut missing=good.clone();missing.phases.remove(0);
        assert!(missing.validate_state().is_err());
        let mut swapped=good.clone();swapped.phases.swap(0,1);
        assert!(swapped.validate_state().is_err());
        let mut forged=good.clone();forged.phases[0].tool="premiere_save_project".into();
        assert!(forged.validate_state().is_err());
    }
    #[test]fn persisted_edit_job_ledger_rejects_fabricated_progress(){
        let good=Job::new("ledger".into(),request(),"P",None,"S",100).unwrap();
        let mut fabricated=good.clone();
        fabricated.phases[0].state="completed".into();
        assert!(fabricated.validate_state().is_err());
        let mut premature=good.clone();premature.status="export_dispatched".into();
        assert!(premature.validate_state().is_err());
        let mut shifted=good.clone();
        shifted.phases[1].state="completed".into();
        shifted.phases[1].action_id=Some("invalid".into());
        assert!(shifted.validate_state().is_err());
        let mut invalid_time=good.clone();
        invalid_time.phases[1].proposal_issued_at_ms=Some(9999);
        assert!(invalid_time.validate_state().is_err());
    }
    #[test]fn persisted_edit_job_receipts_do_not_alias_or_replay(){
        let mut good=Job::new("ledger".into(),request(),"P",None,"S",100).unwrap();
        good.issue_proposal("review",101).unwrap();
        good.record("review","premiere_review_frames","same-id",true,102).unwrap();
        good.issue_proposal("export_preflight",103).unwrap();
        good.record("export_preflight","premiere_plan_export","new-id",true,104).unwrap();
        assert!(good.validate_state().is_ok());
        let mut repeat=good.clone();
        repeat.phases[1].action_id=Some("same-id".into());
        assert!(repeat.validate_state().is_err());
        let mut following=Job::new("future-proposal".into(),request(),"P",None,"S",100).unwrap();
        following.phases[2].proposal_issued_at_ms=Some(105);
        following.updated_at_ms=105;
        assert!(following.validate_state().is_err());
        let mut premature_review=Job::new("review-session".into(),request(),"P",None,"S",100).unwrap();
        premature_review.phases[0].review_session_id=Some("not-an-iterative-review".into());
        assert!(premature_review.validate_state().is_err());
        good.issue_proposal("export_dispatch",106).unwrap();
        good.record("export_dispatch","premiere_export_sequence","final-id",true,107).unwrap();
        assert_eq!(good.status,"export_dispatched");
        assert!(good.validate_state().is_ok());
    }
    #[test]fn persisted_edit_job_fail_and_cancel_have_single_consistent_frontier(){
        let mut failed=Job::new("failed".into(),request(),"P",None,"S",100).unwrap();
        failed.record("review","premiere_review_frames","failed-action",false,101).unwrap();
        assert!(failed.validate_state().is_ok());
        let mut cancelled=Job::new("cancelled".into(),request(),"P",None,"S",100).unwrap();
        cancelled.issue_proposal("review",101).unwrap();
        cancelled.cancel(102);
        assert!(cancelled.validate_state().is_ok());
        failed.phases[2].state="completed".into();
        failed.phases[2].action_id=Some("bypass".into());
        assert!(failed.validate_state().is_err());
    }
    #[test]fn edit_job_store_rejects_cross_job_action_receipt_replay(){
        let folder=std::env::temp_dir().join(format!("shuvi40-receipts-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let id_a=uuid::Uuid::new_v4().to_string();
        let id_b=uuid::Uuid::new_v4().to_string();
        let path_a=folder.join(format!("{id_a}.json"));
        let path_b=folder.join(format!("{id_b}.json"));
        let mut a=Job::new(id_a.clone(),request(),"P",None,"S",100).unwrap();
        a.issue_proposal("review",101).unwrap();
        a.record("review","premiere_review_frames","used-approved-action",true,102).unwrap();
        save(&path_a,&a).unwrap();
        let b=Job::new(id_b.clone(),request(),"P",None,"S",100).unwrap();
        save(&path_b,&b).unwrap();
        assert!(require_unclaimed_action_in_store(&path_b,&id_b,"used-approved-action").is_err());
        assert!(require_unclaimed_action_in_store(&path_b,&id_b,"fresh-approved-action").is_ok());
        // A broken sibling must fail closed instead of being silently ignored.
        fs::write(&path_a,b"{broken").unwrap();
        assert!(require_unclaimed_action_in_store(&path_b,&id_b,"fresh-approved-action").is_err());
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]fn edit_job_store_rejects_interrupted_sibling_updates(){
        let folder=std::env::temp_dir().join(format!("shuvi40-inflight-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let id=uuid::Uuid::new_v4().to_string();
        let path=folder.join(format!("{id}.json"));
        save(&path,&Job::new(id.clone(),request(),"P",None,"S",100).unwrap()).unwrap();
        fs::write(folder.join("sibling.json.bak"),b"interrupted").unwrap();
        assert!(require_unclaimed_action_in_store(&path,&id,"fresh-action").is_err());
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]fn exact_phase_arguments_digest_rejects_altered_action_receipt(){
        let mut job=Job::new("phase-hash".into(),request(),"P",None,"S",100).unwrap();
        let args=serde_json::json!({"seconds":[1,5],"prompt":"Inspect"});
        let changed=serde_json::json!({"seconds":[1,5],"prompt":"Inspect changed"});
        job.issue_proposal("review",101).unwrap();
        job.bind_proposal_arguments("review",&args).unwrap();
        let hash=proposal_arguments_sha256(&args).unwrap();
        let altered=proposal_arguments_sha256(&changed).unwrap();
        assert_ne!(hash,altered);
        assert!(job.require_bound_action_arguments("review",&format!("premiere_args_sha256={hash} | vision omitted")).is_ok());
        assert!(job.require_bound_action_arguments("review",&format!("premiere_args_sha256={altered}")).is_err());
        assert!(job.require_bound_action_arguments("review","Vision prompt omitted").is_err());
        assert!(job.bind_proposal_arguments("review",&changed).is_err());
        // Idempotent read-only replan preserves first digest.
        job.issue_proposal("review",102).unwrap();
        job.bind_proposal_arguments("review",&args).unwrap();
        assert_eq!(job.pending().unwrap().proposal_arguments_sha256.as_deref(),Some(hash.as_str()));
        assert!(job.validate_state().is_ok());
    }
    #[test]fn legacy_phase_without_arguments_hash_requires_new_exact_proposal(){
        let mut job=Job::new("old-args".into(),request(),"P",None,"S",100).unwrap();
        job.issue_proposal("review",101).unwrap();
        assert!(job.require_bound_action_arguments("review","premiere_args_sha256=missing").is_err());
        job.bind_proposal_arguments("review",&serde_json::json!({})).unwrap();
        let mut bad=job.clone();
        bad.phases[0].proposal_issued_at_ms=None;
        assert!(bad.validate_state().is_err());
        bad=job.clone();bad.phases[0].proposal_arguments_sha256=Some("not-a-sha".into());
        assert!(bad.validate_state().is_err());
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
