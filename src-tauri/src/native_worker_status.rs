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
    let state=if !lease&&(!running.is_empty()||!started.is_empty()){
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
    }
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
    fn idle_has_no_claimed_cross_process_clearance(){
        let empty=HashMap::new();
        let state=snapshot(false,&empty,&empty,None,5_000);
        assert_eq!(state.state,"idle");
        assert!(!state.requires_owner_review);
        assert!(state.action_id.is_none());
        assert!(!state.safe_to_auto_retry);
    }
}
