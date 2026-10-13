//! Read-only observation of the real Rust action lease and recovery journal.
//! A status sample is NOT a worker heartbeat, activity proof, permission,
//! timeout-triggered cancellation, or evidence that an Adobe app made progress.
use std::collections::HashMap;
use serde::Serialize;

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct NativeWorkerStatus {
    pub schema_version:u32,
    pub observed_at_ms:u64,
    pub state:String,
    pub lease_owned_by_this_process:bool,
    pub cross_process_lease_state:String,
    pub action_id:Option<String>,
    pub tool:Option<String>,
    pub started_at_ms:Option<u64>,
    pub observed_action_age_ms:Option<u64>,
    pub recovery_phase:Option<String>,
    pub recovery_task_id:Option<String>,
    pub requires_owner_review:bool,
    pub progress_heartbeat_verified:bool,
    pub safe_to_auto_retry:bool,
    // Durable Rust supervisor pulse, not a tool/app progress heartbeat.
    pub durable_job_phase:Option<String>,
    pub durable_job_action_id:Option<String>,
    pub supervisor_heartbeat_at_ms:Option<u64>,
    pub supervisor_heartbeat_age_ms:Option<u64>,
    pub supervisor_heartbeat_seq:Option<u64>,
    pub supervisor_health:String,
}

/// Called only *after* acquiring Rust's exclusive native desktop lease.
/// A stale identity after a panic or a partially completed action is not
/// license to start another Windows mutation. No automatic TTL reset exists.
pub(crate) fn require_clear_for_new_dispatch(
    running:&HashMap<String,String>,
    started:&HashMap<String,u64>
)->Result<(),String>{
    if !running.is_empty()||!started.is_empty(){
        Err("Prior native worker action identity remains unresolved; inspect audit and recover before another desktop dispatch.".into())
    }else{Ok(())}
}

fn token_valid(value:&str)->bool{
    uuid::Uuid::parse_str(value).is_ok()
}
pub(crate) fn snapshot(
    lease:bool,
    running:&HashMap<String,String>,
    started:&HashMap<String,u64>,
    recovery:Option<&crate::native_recovery::NativeRecoveryRecord>,
    now:u64
)->NativeWorkerStatus{
    let phase=recovery.map(|r|r.phase.clone());
    let needs_review=matches!(phase.as_deref(),Some("executing"|"outcome_unknown"));
    let attribution=if running.len()==1&&started.len()==1 {
        running.iter().next().and_then(|(id,tool)|{
            let began=*started.get(id)?;
            if token_valid(id)&&!tool.is_empty()&&tool.len()<=160
                &&began>0&&began<=now{
                Some((id.clone(),tool.clone(),began))
            } else { None }
        })
    } else {None};
    // An unresolved durable journal must belong to the EXACT currently
    // leased action. A later action with a different UUID cannot conceal an
    // uncertain outcome left by an earlier crashed task.
    let journal_unresolved=match phase.as_deref(){
        Some("outcome_unknown")=>true,
        Some("executing")=>!lease||attribution.as_ref().is_none_or(|active|
            recovery.and_then(|r|r.action_id.as_deref())!=Some(active.0.as_str())),
        _=>false
    };
    let state=if journal_unresolved{
        "recovery_required"
    }else if !lease&&(!running.is_empty()||!started.is_empty()){
        "recovery_required"
    }else if running.len()>1||started.len()>1
        ||(lease&&!running.is_empty()&&attribution.is_none()){
        "recovery_required"
    }else if lease{
        if attribution.is_some(){"native_action_in_flight"}
        else{"lease_held_unattributed"}
    }else if needs_review{
        // A durable 'executing' record after process restart is not a
        // successful action just because the previous OS handle is gone.
        "recovery_required"
    }else{"idle"};
    let requires_owner_review=state=="recovery_required"
        ||needs_review&&!lease;
    NativeWorkerStatus{
        schema_version:1,
        observed_at_ms:now,
        state:state.into(),
        lease_owned_by_this_process:lease,
        cross_process_lease_state:"unknown_not_probed".into(),
        action_id:attribution.as_ref().map(|x|x.0.clone()),
        tool:attribution.as_ref().map(|x|x.1.clone()),
        started_at_ms:attribution.as_ref().map(|x|x.2),
        observed_action_age_ms:attribution.as_ref().map(|x|now.saturating_sub(x.2)),
        recovery_phase:phase,
        recovery_task_id:recovery.and_then(|r|r.task_id.clone()),
        requires_owner_review,
        progress_heartbeat_verified:false,
        safe_to_auto_retry:false,
        durable_job_phase:None,durable_job_action_id:None,
        supervisor_heartbeat_at_ms:None,supervisor_heartbeat_age_ms:None,
        supervisor_heartbeat_seq:None,supervisor_health:"not_observed".into(),
    }
}

/// A journal's heartbeat proves the Rust supervisor was scheduled, NOT
/// that Adobe/Blender or an individual tool progressed. A stale heartbeat
/// must never cancel, unlock or replay a native action.
pub(crate) fn attach_durable_job(
    mut status:NativeWorkerStatus,
    job:Option<&crate::native_worker_job::NativeJob>,
    now:u64,
)->NativeWorkerStatus{
    let Some(job)=job else{return status};
    status.durable_job_phase=Some(job.phase.clone());
    status.durable_job_action_id=Some(job.action_id.clone());
    status.supervisor_heartbeat_at_ms=(job.heartbeat_seq>0).then_some(job.updated_at_ms);
    status.supervisor_heartbeat_age_ms=(job.heartbeat_seq>0)
        .then_some(now.saturating_sub(job.updated_at_ms));
    status.supervisor_heartbeat_seq=Some(job.heartbeat_seq);
    if job.phase=="running" {
        if !status.lease_owned_by_this_process
           ||status.action_id.as_deref()!=Some(job.action_id.as_str())
           ||status.state!="native_action_in_flight" {
            status.state="recovery_required".into();
            status.requires_owner_review=true;
            status.supervisor_health="unattributed_or_interrupted".into();
        } else if now.saturating_sub(job.updated_at_ms)>16_000 {
            status.supervisor_health="supervisor_tick_stale".into();
            // Still executing in this process; do not claim the host crashed
            // or release the execution slot based only on clock time.
        } else if job.heartbeat_seq==0 {
            status.supervisor_health="supervisor_start_record_only".into();
        } else {
            status.supervisor_health="rust_supervisor_observed".into();
        }
    } else {
        status.supervisor_health="last_action_audited".into();
    }
    status
}

#[cfg(test)]
mod tests{
    use super::*;
    fn uuid()->String{"123e4567-e89b-42d3-a456-426614174000".into()}
    fn running()->(HashMap<String,String>,HashMap<String,u64>){
        (HashMap::from([(uuid(),"premiere_insert_media".into())]),
         HashMap::from([(uuid(),1_000)]))
    }
    fn recovery(phase:&str)->crate::native_recovery::NativeRecoveryRecord{
        crate::native_recovery::NativeRecoveryRecord{
            version:2,task_id:Some(uuid()),revision:Some(2),
            max_actions:8,staged_actions:1,model_requests:1,
            expires_at:7_200_001,updated_at:2_000,phase:phase.into(),
            action_id:Some(uuid()),
        }
    }
    #[test]
    fn actual_host_lease_and_single_tool_identify_a_live_action_without_fake_heartbeat(){
        let (tools,starts)=running();
        let status=snapshot(true,&tools,&starts,Some(&recovery("executing")),6_000);
        assert_eq!(status.state,"native_action_in_flight");
        assert_eq!(status.action_id.as_deref(),Some(uuid().as_str()));
        assert_eq!(status.tool.as_deref(),Some("premiere_insert_media"));
        assert_eq!(status.observed_action_age_ms,Some(5_000));
        assert!(!status.progress_heartbeat_verified);
        assert!(!status.safe_to_auto_retry);
        assert_eq!(status.cross_process_lease_state,"unknown_not_probed");
    }
    #[test]
    fn expired_recovery_journal_with_no_live_action_needs_review_not_replay(){
        let status=snapshot(false,&HashMap::new(),&HashMap::new(),
            Some(&recovery("outcome_unknown")),8_000);
        assert_eq!(status.state,"recovery_required");
        assert!(status.requires_owner_review);
        assert!(status.action_id.is_none());
    }
    #[test]
    fn a_different_live_action_never_clears_a_crashed_task_journal(){
        let (tools,starts)=running();
        let mut old=recovery("executing");
        old.action_id=Some("123e4567-e89b-42d3-a456-426614174009".into());
        let unmatched=snapshot(true,&tools,&starts,Some(&old),6_000);
        assert_eq!(unmatched.state,"recovery_required");
        assert!(unmatched.requires_owner_review);
        let unknown=snapshot(true,&tools,&starts,Some(&recovery("outcome_unknown")),6_000);
        assert_eq!(unknown.state,"recovery_required");
        assert!(!unknown.safe_to_auto_retry);
    }
    #[test]
    fn unowned_action_map_and_duplicate_actions_are_quarantined(){
        let (mut tools,starts)=running();
        let invalid=snapshot(false,&tools,&starts,None,8_000);
        assert_eq!(invalid.state,"recovery_required");
        assert!(invalid.requires_owner_review);
        tools.insert("123e4567-e89b-42d3-a456-426614174001".into(),"read_file".into());
        assert_eq!(snapshot(true,&tools,&starts,None,8_000).state,"recovery_required");
        assert_eq!(snapshot(true,&HashMap::new(),&HashMap::new(),None,8_000).state,
            "lease_held_unattributed");
    }
    #[test]
    fn stale_clock_or_mismatched_identity_is_not_trusted(){
        let (tools,mut starts)=running();
        starts.insert(uuid(),20_000);
        assert_eq!(snapshot(true,&tools,&starts,None,8_000).state,"recovery_required");
        starts.clear();
        assert_eq!(snapshot(true,&tools,&starts,None,8_000).state,"recovery_required");
    }
    #[test]
    fn a_stale_worker_record_forbids_all_new_native_dispatches(){
        let (tools,starts)=running();
        assert!(require_clear_for_new_dispatch(&tools,&starts).is_err());
        assert!(require_clear_for_new_dispatch(&HashMap::new(),&starts).is_err());
        assert!(require_clear_for_new_dispatch(&tools,&HashMap::new()).is_err());
        assert!(require_clear_for_new_dispatch(&HashMap::new(),&HashMap::new()).is_ok());
    }
    #[test]
    fn durable_start_record_is_not_fabricated_as_a_heartbeat_tick(){
        let id=uuid();
        let record=crate::native_worker_job::NativeJob{
            version:1,action_id:id,tool:"read_file".into(),phase:"running".into(),
            started_at_ms:1_000,updated_at_ms:1_000,heartbeat_seq:0,audit_success:None,
            prior_action_ids:Vec::new()
        };
        let (tools,starts)=running();
        let live=attach_durable_job(snapshot(true,&tools,&starts,None,1_500),
            Some(&record),1_500);
        assert_eq!(live.state,"native_action_in_flight");
        assert_eq!(live.supervisor_health,"supervisor_start_record_only");
        assert_eq!(live.supervisor_heartbeat_at_ms,None);
        assert_eq!(live.supervisor_heartbeat_age_ms,None);
    }
    #[test]
    fn persisted_running_job_without_the_same_live_rust_action_needs_owner_review(){
        let job=crate::native_worker_job::NativeJob{
            version:1,action_id:uuid(),tool:"premiere_insert_media".into(),
            phase:"running".into(),started_at_ms:1_000,
            updated_at_ms:2_000,heartbeat_seq:2,audit_success:None,
            prior_action_ids:Vec::new()
        };
        let idle=snapshot(false,&HashMap::new(),&HashMap::new(),None,7_000);
        let recovered=attach_durable_job(idle,Some(&job),7_000);
        assert_eq!(recovered.state,"recovery_required");
        assert!(recovered.requires_owner_review);
        assert!(!recovered.progress_heartbeat_verified);
        assert!(!recovered.safe_to_auto_retry);
        let (tools,starts)=running();
        let live=snapshot(true,&tools,&starts,Some(&recovery("executing")),7_000);
        let observed=attach_durable_job(live,Some(&job),7_000);
        assert_eq!(observed.supervisor_health,"rust_supervisor_observed");
        assert_eq!(observed.supervisor_heartbeat_seq,Some(2));
        assert!(!observed.progress_heartbeat_verified);
        let delayed=attach_durable_job(
            snapshot(true,&tools,&starts,Some(&recovery("executing")),30_000),
            Some(&job),30_000
        );
        assert_eq!(delayed.supervisor_health,"supervisor_tick_stale");
        assert_eq!(delayed.state,"native_action_in_flight");
    }
    #[test]
    fn idle_has_no_claimed_cross_process_clearance(){
        let empty_tools:HashMap<String,String>=HashMap::new();
        let empty_starts:HashMap<String,u64>=HashMap::new();
        let state=snapshot(false,&empty_tools,&empty_starts,None,5_000);
        assert_eq!(state.state,"idle");
        assert!(!state.requires_owner_review);
        assert!(state.action_id.is_none());
        assert!(!state.safe_to_auto_retry);
    }
}
