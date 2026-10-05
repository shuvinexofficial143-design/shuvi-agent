use crate::motion_graphics::Plan;
use crate::motion_graphics_correction;
use crate::motion_graphics_review::{self,MultiFrameReview,Verdict,VisualReview};
use serde::{Deserialize,Serialize};
use std::{fs,path::Path};
use uuid::Uuid;

const MAX_CORRECTIONS:u8=3;
const MAX_REVIEW_ISSUES:usize=24;
const MAX_HISTORY:usize=8;
const MAX_SESSION_BYTES:usize=64*1024;

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum ReviewKind {
    SingleFrame,
    MultiFrame,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum SessionStatus {
    AwaitingReview,
    AwaitingCorrection,
    AwaitingRendererApproval,
    AwaitingRerender,
    Completed,
    Stagnated,
    Cancelled,
    Failed,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRecordRequest {
    pub session_id:String,
    pub plan:Plan,
    pub kind:ReviewKind,
    pub review:serde_json::Value,
    #[serde(default)]
    pub frame_times_seconds:Vec<f64>,
}

#[derive(Debug,Clone)]
pub struct ReviewRecordSummary {
    pub plan_snapshot:String,
    pub kind:ReviewKind,
    pub verdict:Verdict,
    pub issue_count:usize,
}

impl ReviewRecordRequest {
    pub fn validate(&self)->Result<ReviewRecordSummary,String>{
        Uuid::parse_str(&self.session_id).map_err(|_|"Invalid motion correction session ID.".to_string())?;
        self.plan.validate()?;
        let plan_snapshot=self.plan.fingerprint()?;
        let (verdict,issue_count)=match self.kind {
            ReviewKind::SingleFrame=>{
                if !self.frame_times_seconds.is_empty(){
                    return Err("Single-frame session review must not include frame_times_seconds.".into());
                }
                let review:VisualReview=serde_json::from_value(self.review.clone())
                    .map_err(|e|format!("Invalid single-frame motion review: {e}"))?;
                motion_graphics_review::validate_review(&self.plan,&review)?;
                (review.verdict,review.issues.len())
            }
            ReviewKind::MultiFrame=>{
                let review:MultiFrameReview=serde_json::from_value(self.review.clone())
                    .map_err(|e|format!("Invalid multi-frame motion review: {e}"))?;
                motion_graphics_review::validate_multi_frame_review(&self.plan,&self.frame_times_seconds,&review)?;
                (review.verdict,review.issues.len())
            }
        };
        Ok(ReviewRecordSummary{plan_snapshot,kind:self.kind,verdict,issue_count})
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionRecordRequest {
    pub session_id:String,
    pub prior_plan:Plan,
    pub revised_plan:Plan,
}

#[derive(Debug,Clone)]
pub struct CorrectionRecordSummary {
    pub prior_plan_snapshot:String,
    pub revised_plan_snapshot:String,
}

impl CorrectionRecordRequest {
    pub fn validate(&self)->Result<CorrectionRecordSummary,String>{
        Uuid::parse_str(&self.session_id).map_err(|_|"Invalid motion correction session ID.".to_string())?;
        motion_graphics_correction::validate_revision_constraints(&self.prior_plan,&self.revised_plan)?;
        Ok(CorrectionRecordSummary{
            prior_plan_snapshot:self.prior_plan.fingerprint()?,
            revised_plan_snapshot:self.revised_plan.fingerprint()?,
        })
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewCheckpoint {
    pub review_round:u8,
    pub plan_snapshot:String,
    pub kind:ReviewKind,
    pub verdict:Verdict,
    pub issue_count:usize,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionCheckpoint {
    pub correction_iteration:u8,
    pub prior_plan_snapshot:String,
    pub revised_plan_snapshot:String,
    #[serde(default)]
    pub approved_action_id:Option<String>,
    #[serde(default)]
    pub rerender_manifest_sha256:Option<String>,
    #[serde(default)]
    pub rerender_output_sha256:Option<String>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub schema_version:u8,
    pub session_id:String,
    pub initial_plan_snapshot:String,
    pub current_plan_snapshot:String,
    pub review_round:u8,
    pub correction_count:u8,
    pub max_corrections:u8,
    pub status:SessionStatus,
    pub reviews:Vec<ReviewCheckpoint>,
    pub corrections:Vec<CorrectionCheckpoint>,
}

fn valid_snapshot(value:&str)->bool{
    let Some(hex)=value.strip_prefix("fnv1a64:") else{return false;};
    hex.len()==16&&hex.bytes().all(|b|b.is_ascii_hexdigit())
}

fn valid_sha256(value:&str)->bool{
    value.len()==64&&value.bytes().all(|b|b.is_ascii_hexdigit())
}

impl Session {
    pub fn new(session_id:String,initial_plan_snapshot:String,max_corrections:u8)->Result<Self,String>{
        Uuid::parse_str(&session_id).map_err(|_|"Motion correction session_id must be a UUID.".to_string())?;
        if !valid_snapshot(&initial_plan_snapshot){
            return Err("Motion correction session requires an exact fnv1a64 plan snapshot.".into());
        }
        if max_corrections==0||max_corrections>MAX_CORRECTIONS{
            return Err(format!("Motion correction session max_corrections must be 1..={MAX_CORRECTIONS}."));
        }
        Ok(Self{
            schema_version:1,
            session_id,
            initial_plan_snapshot:initial_plan_snapshot.clone(),
            current_plan_snapshot:initial_plan_snapshot,
            review_round:1,
            correction_count:0,
            max_corrections,
            status:SessionStatus::AwaitingReview,
            reviews:Vec::new(),
            corrections:Vec::new(),
        })
    }

    pub fn validate(&self)->Result<(),String>{
        Uuid::parse_str(&self.session_id).map_err(|_|"Invalid motion correction session_id.".to_string())?;
        if self.schema_version!=1||!valid_snapshot(&self.initial_plan_snapshot)||!valid_snapshot(&self.current_plan_snapshot)
            ||self.review_round==0||self.correction_count>self.max_corrections||self.max_corrections==0
            ||self.max_corrections>MAX_CORRECTIONS||self.reviews.len()>MAX_HISTORY||self.corrections.len()>MAX_CORRECTIONS as usize{
            return Err("Invalid bounded motion correction session state.".into());
        }
        if self.corrections.len()!=self.correction_count as usize{
            return Err("Motion correction session correction history/count mismatch.".into());
        }
        Ok(())
    }

    pub fn next_correction_iteration(&self)->Result<u8,String>{
        self.validate()?;
        if self.status!=SessionStatus::AwaitingCorrection{
            return Err("Motion correction session is not awaiting a correction proposal.".into());
        }
        self.correction_count.checked_add(1)
            .filter(|value|*value<=self.max_corrections)
            .ok_or_else(||"Motion correction session reached its correction limit.".to_string())
    }

    pub fn record_review(&mut self,kind:ReviewKind,plan_snapshot:String,verdict:Verdict,issue_count:usize)->Result<(),String>{
        self.validate()?;
        if self.status!=SessionStatus::AwaitingReview{
            return Err("Motion correction session is not awaiting review evidence.".into());
        }
        if plan_snapshot!=self.current_plan_snapshot{
            return Err("Motion correction review snapshot is stale or belongs to another plan.".into());
        }
        if issue_count>MAX_REVIEW_ISSUES{
            return Err(format!("Motion correction review exceeds {MAX_REVIEW_ISSUES} issues."));
        }
        match verdict{
            Verdict::Pass if issue_count!=0=>return Err("Passing motion correction review must have zero issues.".into()),
            Verdict::Revise if issue_count==0=>return Err("Revise motion correction review must contain at least one issue.".into()),
            _=>{}
        }
        if self.reviews.len()>=MAX_HISTORY{
            self.status=SessionStatus::Stagnated;
            return Err("Motion correction review history limit reached.".into());
        }
        self.reviews.push(ReviewCheckpoint{
            review_round:self.review_round,
            plan_snapshot,
            kind,
            verdict,
            issue_count,
        });
        self.status=match verdict{
            Verdict::Pass=>SessionStatus::Completed,
            Verdict::Revise if self.correction_count>=self.max_corrections=>SessionStatus::Stagnated,
            Verdict::Revise=>SessionStatus::AwaitingCorrection,
        };
        Ok(())
    }

    pub fn record_correction(&mut self,prior_plan_snapshot:String,revised_plan_snapshot:String)->Result<u8,String>{
        self.validate()?;
        let iteration=self.next_correction_iteration()?;
        if prior_plan_snapshot!=self.current_plan_snapshot{
            return Err("Motion correction proposal is based on a stale prior plan snapshot.".into());
        }
        if !valid_snapshot(&revised_plan_snapshot){
            return Err("Motion correction proposal must produce a valid fnv1a64 revised snapshot.".into());
        }
        if self.corrections.iter().any(|row|row.revised_plan_snapshot==revised_plan_snapshot){
            self.status=SessionStatus::Stagnated;
            return Err("The same motion correction snapshot was already attempted; blind retry is blocked.".into());
        }
        if revised_plan_snapshot==prior_plan_snapshot{
            return Err("Motion correction proposal must differ from the current plan snapshot.".into());
        }
        self.corrections.push(CorrectionCheckpoint{
            correction_iteration:iteration,
            prior_plan_snapshot,
            revised_plan_snapshot:revised_plan_snapshot.clone(),
            approved_action_id:None,
            rerender_manifest_sha256:None,
            rerender_output_sha256:None,
        });
        self.correction_count=iteration;
        self.current_plan_snapshot=revised_plan_snapshot;
        self.status=SessionStatus::AwaitingRendererApproval;
        Ok(iteration)
    }

    pub fn record_renderer_approval(&mut self,action_id:String)->Result<(),String>{
        self.validate()?;
        if self.status!=SessionStatus::AwaitingRendererApproval{
            return Err("Motion correction session is not awaiting a renderer approval receipt.".into());
        }
        Uuid::parse_str(&action_id).map_err(|_|"Renderer approval action_id must be a UUID.".to_string())?;
        let row=self.corrections.last_mut().ok_or("Motion correction session has no pending correction.")?;
        if row.approved_action_id.is_some(){
            return Err("Renderer approval was already recorded for this correction.".into());
        }
        row.approved_action_id=Some(action_id);
        self.status=SessionStatus::AwaitingRerender;
        Ok(())
    }

    pub fn record_rerender(&mut self,action_id:String,manifest_sha256:String,output_sha256:String)->Result<(),String>{
        self.validate()?;
        if self.status!=SessionStatus::AwaitingRerender{
            return Err("Motion correction session is not awaiting re-render evidence.".into());
        }
        if !valid_sha256(&manifest_sha256)||!valid_sha256(&output_sha256){
            return Err("Re-render evidence requires exact SHA-256 manifest and output hashes.".into());
        }
        let row=self.corrections.last_mut().ok_or("Motion correction session has no approved correction.")?;
        if row.approved_action_id.as_deref()!=Some(action_id.as_str()){
            return Err("Re-render evidence action_id does not match the approved renderer action.".into());
        }
        if row.rerender_manifest_sha256.is_some()||row.rerender_output_sha256.is_some(){
            return Err("Re-render evidence was already recorded for this correction.".into());
        }
        row.rerender_manifest_sha256=Some(manifest_sha256);
        row.rerender_output_sha256=Some(output_sha256);
        self.review_round=self.review_round.saturating_add(1);
        self.status=SessionStatus::AwaitingReview;
        Ok(())
    }

    pub fn cancel(&mut self)->Result<(),String>{
        self.validate()?;
        if matches!(self.status,SessionStatus::Completed|SessionStatus::Cancelled){
            return Err("Motion correction session is already terminal.".into());
        }
        self.status=SessionStatus::Cancelled;
        Ok(())
    }
}

pub fn save(path:&Path,session:&Session)->Result<(),String>{
    session.validate()?;
    let bytes=serde_json::to_vec(session).map_err(|e|format!("Could not encode motion correction session: {e}"))?;
    if bytes.len()>MAX_SESSION_BYTES{
        return Err("Motion correction session exceeds the 64 KiB persistence limit.".into());
    }
    crate::premiere_store::replace(path,&bytes,MAX_SESSION_BYTES,|candidate|{
        let decoded:Session=serde_json::from_slice(candidate)
            .map_err(|e|format!("Invalid persisted motion correction session: {e}"))?;
        decoded.validate()
    }).map_err(|e|format!("Motion correction session persistence failed: {e}"))
}

pub fn load(path:&Path)->Result<Session,String>{
    let decode=|candidate:&Path|->Result<Session,String>{
        let bytes=crate::read_file_bytes_bounded(candidate,MAX_SESSION_BYTES,"motion correction session")?;
        let session:Session=serde_json::from_slice(&bytes)
            .map_err(|e|format!("Corrupt motion correction session: {e}"))?;
        session.validate()?;
        Ok(session)
    };
    match decode(path){
        Ok(session)=>Ok(session),
        Err(primary_error)=>{
            let backup=path.with_extension("json.bak");
            if backup.exists(){
                let mut recovered=decode(&backup)?;
                recovered.status=SessionStatus::Failed;
                Ok(recovered)
            }else{
                Err(primary_error)
            }
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;

    fn snapshot(hex:&str)->String{format!("fnv1a64:{hex}")}
    fn session()->Session{
        Session::new(Uuid::new_v4().to_string(),snapshot("1111111111111111"),3).unwrap()
    }

    #[test]
    fn persistence_round_trip_is_bounded_and_validated(){
        let dir=std::env::temp_dir().join(format!("shuvi-motion-session-{}",Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path=dir.join("session.json");
        let s=session();
        save(&path,&s).unwrap();
        let loaded=load(&path).unwrap();
        assert_eq!(loaded.session_id,s.session_id);
        assert_eq!(loaded.status,SessionStatus::AwaitingReview);
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn passing_review_completes_without_correction(){
        let mut s=session();
        s.record_review(ReviewKind::MultiFrame,s.current_plan_snapshot.clone(),Verdict::Pass,0).unwrap();
        assert_eq!(s.status,SessionStatus::Completed);
        assert_eq!(s.correction_count,0);
    }

    #[test]
    fn revise_correction_approval_rerender_returns_to_review(){
        let mut s=session();
        s.record_review(ReviewKind::MultiFrame,s.current_plan_snapshot.clone(),Verdict::Revise,2).unwrap();
        assert_eq!(s.next_correction_iteration().unwrap(),1);
        let prior=s.current_plan_snapshot.clone();
        s.record_correction(prior,snapshot("2222222222222222")).unwrap();
        assert_eq!(s.status,SessionStatus::AwaitingRendererApproval);
        s.record_renderer_approval(Uuid::new_v4().to_string()).unwrap();
        assert_eq!(s.status,SessionStatus::AwaitingRerender);
        s.record_rerender(s.corrections.last().unwrap().approved_action_id.clone().unwrap(),"a".repeat(64),"d".repeat(64)).unwrap();
        assert_eq!(s.status,SessionStatus::AwaitingReview);
        assert_eq!(s.review_round,2);
        assert_eq!(s.correction_count,1);
    }

    #[test]
    fn stale_snapshot_and_blind_retry_are_blocked(){
        let mut s=session();
        assert!(s.record_review(ReviewKind::SingleFrame,snapshot("9999999999999999"),Verdict::Revise,1).is_err());
        s.record_review(ReviewKind::SingleFrame,s.current_plan_snapshot.clone(),Verdict::Revise,1).unwrap();
        let prior=s.current_plan_snapshot.clone();
        s.record_correction(prior,snapshot("2222222222222222")).unwrap();
        s.record_renderer_approval(Uuid::new_v4().to_string()).unwrap();
        s.record_rerender(s.corrections.last().unwrap().approved_action_id.clone().unwrap(),"b".repeat(64),"e".repeat(64)).unwrap();
        s.record_review(ReviewKind::MultiFrame,s.current_plan_snapshot.clone(),Verdict::Revise,1).unwrap();
        let prior=s.current_plan_snapshot.clone();
        assert!(s.record_correction(prior,snapshot("2222222222222222")).is_err());
        assert_eq!(s.status,SessionStatus::Stagnated);
    }

    #[test]
    fn correction_limit_stagnates_after_final_unsuccessful_review(){
        let mut s=Session::new(Uuid::new_v4().to_string(),snapshot("1111111111111111"),1).unwrap();
        s.record_review(ReviewKind::MultiFrame,s.current_plan_snapshot.clone(),Verdict::Revise,1).unwrap();
        let prior=s.current_plan_snapshot.clone();
        s.record_correction(prior,snapshot("2222222222222222")).unwrap();
        s.record_renderer_approval(Uuid::new_v4().to_string()).unwrap();
        s.record_rerender(s.corrections.last().unwrap().approved_action_id.clone().unwrap(),"c".repeat(64),"f".repeat(64)).unwrap();
        s.record_review(ReviewKind::MultiFrame,s.current_plan_snapshot.clone(),Verdict::Revise,1).unwrap();
        assert_eq!(s.status,SessionStatus::Stagnated);
    }
}
