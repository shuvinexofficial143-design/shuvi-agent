//! Durable dependency-aware Rust scheduler for the existing permissioned action path.
//! No executable payload, model response or user approval is stored here.
//! Every admitted step still needs a fresh native prepared-action UUID and
//! the existing owner Allow once / task-scoped read permission.
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{collections::{HashMap,HashSet},fs,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
const MAX_JOBS:usize=48;
const MAX_BYTES:usize=32768;
static LOCK:Mutex<()>=Mutex::new(());

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Job {
    pub step_id:String,
    pub tool:String,
    pub depends_on:Vec<String>,
    pub phase:String, // queued, running, audited, failed, outcome_unknown
    pub action_id:Option<String>,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Schedule {
    pub version:u32,
    pub objective:String,
    pub revision:u32,
    pub jobs:Vec<Job>,
}
fn valid_label(s:&str,max:usize)->bool{
    !s.is_empty()&&s.len()<=max&&s.bytes().all(|x|
        x.is_ascii_alphanumeric()||x==b'_'||x==b'-')
}
fn valid_tool(s:&str)->bool{
    !s.is_empty()&&s.len()<=160&&s.bytes().all(|x|
        x.is_ascii_lowercase()||x.is_ascii_digit()||x==b'_')
}
fn valid_uuid(s:&str)->bool{
    uuid::Uuid::parse_str(s).map(|u|u.to_string()==s).unwrap_or(false)
}
fn validate(s:&Schedule)->Result<(),String>{
    if s.version!=1||s.objective.is_empty()||s.objective.len()>500
        ||s.revision==0||s.revision>MAX_JOBS as u32
        ||s.jobs.is_empty()||s.jobs.len()>MAX_JOBS{
        return Err("Native scheduler exceeds owner task-graph bounds.".into());
    }
    let mut ids=HashSet::new();
    let mut actions=HashSet::new();
    let mut running=0;
    let by_id:HashMap<_,_>=s.jobs.iter().map(|j|(j.step_id.as_str(),j)).collect();
    for j in &s.jobs{
        if !valid_label(&j.step_id,48)||!ids.insert(j.step_id.as_str())
            ||!valid_tool(&j.tool)||j.depends_on.len()>7
            ||!j.depends_on.windows(2).all(|w|w[0]<w[1]){
            return Err("Malformed native schedule identity or dependencies.".into());
        }
        if j.phase=="running"{running+=1;}
        match (j.phase.as_str(),j.action_id.as_deref()){
            ("queued",None)=>{},
            ("running"|"audited"|"failed"|"outcome_unknown",Some(id))
                if valid_uuid(id)&&actions.insert(id)=>{},
            _=>return Err("Native schedule has invalid action binding or phase.".into()),
        }
        if j.depends_on.iter().any(|d|d==&j.step_id||!by_id.contains_key(d.as_str())){
            return Err("Native schedule contains self or missing dependencies.".into());
        }
    }
    if running>1{return Err("More than one native action has claimed the shared desktop.".into());}
    fn visit<'a>(id:&'a str,by:&HashMap<&'a str,&'a Job>,
        visiting:&mut HashSet<&'a str>,done:&mut HashSet<&'a str>)->bool{
        if done.contains(id){return true;}
        if !visiting.insert(id){return false;}
        if let Some(j)=by.get(id){
            for d in &j.depends_on{
                if !visit(d,by,visiting,done){return false;}
            }
        }else{return false;}
        visiting.remove(id);
        done.insert(id);
        true
    }
    let mut visiting=HashSet::new();
    let mut done=HashSet::new();
    if !s.jobs.iter().all(|j|visit(&j.step_id,&by_id,&mut visiting,&mut done)){
        return Err("Native schedule contains a dependency cycle.".into());
    }
    // A running or audited job cannot depend on unverified or failed work.
    for j in &s.jobs{
        if j.phase!="queued" && j.depends_on.iter().any(|d|
            by_id.get(d.as_str()).is_none_or(|parent|parent.phase!="audited")){
            return Err("Native schedule has a running/finished job with unverified prerequisites.".into());
        }
    }
    Ok(())
}
fn from_graph(graph:&Value)->Result<Schedule,String>{
    let objective=graph.get("objective").and_then(Value::as_str)
        .ok_or("Task graph objective missing.")?;
    // Frontend graph parser defaults an omitted first revision to 1.
    // A present-but-invalid revision must still be rejected, not defaulted.
    let revision=match graph.get("revision"){
        Some(value)=>value.as_u64().ok_or("Task graph revision invalid.")?,
        None=>1
    };
    let steps=graph.get("steps").and_then(Value::as_array)
        .ok_or("Native scheduler requires typed task graph steps.")?;
    if revision>MAX_JOBS as u64{return Err("Task graph revision too large.".into());}
    let mut jobs=Vec::new();
    for step in steps{
        let id=step.get("step_id").and_then(Value::as_str)
            .ok_or("Native job step ID missing.")?;
        let tool=step.get("expected_tool").and_then(Value::as_str)
            .ok_or("Native job expected typed tool missing.")?;
        let dependencies=step.get("depends_on").and_then(Value::as_array)
            .ok_or("Native job dependency array missing.")?;
        let mut deps=Vec::new();
        for dep in dependencies{
            deps.push(dep.as_str().ok_or("Invalid native job dependency.")?.to_string());
        }
        deps.sort();
        if deps.windows(2).any(|pair|pair[0]==pair[1]){
            return Err("Native step has duplicate prerequisites.".into());
        }
        jobs.push(Job{step_id:id.into(),tool:tool.into(),depends_on:deps,
            phase:"queued".into(),action_id:None});
    }
    let s=Schedule{version:1,objective:objective.into(),
        revision:revision as u32,jobs};
    validate(&s)?;
    Ok(s)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir()
        .map_err(|_|"Native scheduler data directory unavailable.".to_string())?;
    fs::create_dir_all(&root)
        .map_err(|_|"Native scheduler data directory inaccessible.".to_string())?;
    Ok(root.join("native-scheduler.json"))
}
fn checked(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Native scheduler exceeds durable byte limit.".into());}
    let s:Schedule=serde_json::from_slice(raw)
        .map_err(|_|"Native scheduler state is corrupt.".to_string())?;
    validate(&s)
}
fn read_at(file:&Path)->Result<Option<Schedule>,String>{
    if !file.exists(){
        if file.with_extension("json.bak").exists(){
            return Err("Orphaned native schedule backup requires owner review.".into());
        }
        return Ok(None);
    }
    let bytes=crate::read_file_bytes_bounded(file,MAX_BYTES,"native scheduler")?;
    checked(&bytes)?;
    serde_json::from_slice(&bytes).map(Some)
        .map_err(|_|"Native schedule unreadable.".to_string())
}
fn persist(file:&Path,s:&Schedule)->Result<(),String>{
    validate(s)?;
    let bytes=serde_json::to_vec(s)
        .map_err(|_|"Native scheduler could not encode state.".to_string())?;
    crate::premiere_store::replace(file,&bytes,MAX_BYTES,checked)
}
/// No model-authored status is copied into Rust. Revisions preserve all
/// previously audited work; changes to completed jobs cannot be smuggled in.
fn merged(prior:Option<Schedule>,proposed:Option<&Value>)->Result<Schedule,String>{
    let next=proposed.map(from_graph).transpose()?;
    match (prior,next){
        (None,Some(s))=>Ok(s),
        (None,None)=>Err("No persisted schedule or typed task graph exists.".into()),
        (Some(s),None)=>Ok(s),
        (Some(old),Some(mut next))=>{
            if next.objective!=old.objective{
                if old.jobs.iter().all(|j|matches!(j.phase.as_str(),"audited"|"failed"|"outcome_unknown")){
                    return Ok(next);
                }
                return Err("A different task cannot replace an unfinished native schedule.".into());
            }
            if next.revision!=old.revision && next.revision!=old.revision+1{
                return Err("Native task graph revision is stale or skipped.".into());
            }
            if old.jobs.iter().any(|j|j.phase=="running")&&next.revision!=old.revision{
                return Err("Native schedule cannot be replanned during execution.".into());
            }
            for prior_job in &old.jobs{
                if let Some(index)=next.jobs.iter().position(|j|j.step_id==prior_job.step_id){
                    let j=&mut next.jobs[index];
                    if prior_job.phase=="audited" || (next.revision==old.revision&&prior_job.phase!="queued"){
                        if j.tool!=prior_job.tool||j.depends_on!=prior_job.depends_on{
                            return Err("A started or audited native step cannot be redefined.".into());
                        }
                        *j=prior_job.clone();
                    }
                }else if prior_job.phase!="queued"{
                    return Err("A started native step cannot be removed from its schedule.".into());
                }
            }
            if next.revision==old.revision && next.jobs.iter().any(|j|
                !old.jobs.iter().any(|x|x.step_id==j.step_id&&x.tool==j.tool&&x.depends_on==j.depends_on)){
                return Err("Native step definitions require an explicit graph revision.".into());
            }
            validate(&next)?;
            Ok(next)
        }
    }
}
/// A crash can occur after the durable Rust action audit but before the
/// scheduler terminal write. Only the exact terminal Rust job can repair it.
fn recover_terminal_at(file:&Path,native:Option<&crate::native_worker_job::NativeJob>)
    ->Result<(),String>{
    let Some(mut schedule)=read_at(file)? else{return Ok(());};
    let Some(running)=schedule.jobs.iter_mut().find(|j|j.phase=="running") else{return Ok(());};
    let job=native.ok_or("Scheduled action has no native journal; owner review required.")?;
    if running.action_id.as_deref()!=Some(job.action_id.as_str())
        ||running.tool!=job.tool{
        return Err("Native scheduler running UUID conflicts with Rust action journal.".into());
    }
    match job.phase.as_str(){
        "running"=>Err("Native action is still running or interrupted; owner review required.".into()),
        "audit_verified"=>{
            running.phase=if job.audit_success==Some(true){"audited"}else{"failed"}.into();
            persist(file,&schedule)
        },
        "owner_reviewed_unknown"=>{
            running.phase="outcome_unknown".into();
            persist(file,&schedule)
        },
        _=>Err("Native journal has unsupported terminal state.".into())
    }
}
fn allowed(s:&Schedule,step_id:&str,tool:&str,id:&str)->Result<(),String>{
    if !valid_uuid(id){return Err("Scheduled action requires a canonical prepared UUID.".into());}
    if s.jobs.iter().any(|j|j.action_id.as_deref()==Some(id)){
        return Err("Native scheduler rejected duplicate action UUID.".into());
    }
    if s.jobs.iter().any(|j|j.phase=="running"){
        return Err("Another native job already holds the scheduler execution lane.".into());
    }
    if s.jobs.iter().any(|j|j.phase=="failed"||j.phase=="outcome_unknown"){
        return Err("Unresolved native job failure requires owner-reviewed recovery and replan.".into());
    }
    let job=s.jobs.iter().find(|j|j.step_id==step_id)
        .ok_or("Unknown scheduled step ID.")?;
    if job.phase!="queued"||job.tool!=tool{
        return Err("Scheduled action tool or step state does not match prepared Rust action.".into());
    }
    if !job.depends_on.iter().all(|dep|s.jobs.iter()
        .any(|j|&j.step_id==dep&&j.phase=="audited")){
        return Err("Scheduled step is blocked by a non-audited dependency.".into());
    }
    Ok(())
}
/// Before any Rust native mutation; writes the task definition only. No
/// provider or app command is executed by this preflight.
fn preflight_at(file:&Path,graph:Option<&Value>,step:&str,tool:&str,action_id:&str)
    ->Result<(),String>{
    let _guard=LOCK.lock().map_err(|_|"Native scheduler lock poisoned.")?;
    let next=merged(read_at(file)?,graph)?;
    allowed(&next,step,tool,action_id)
}
pub(crate) fn preflight(app:&AppHandle,graph:Option<&Value>,step:&str,tool:&str,action_id:&str)
    ->Result<(),String>{
    let file=path(app)?;
    // Repair only from the matching disk-audited native action, never from a
    // lease heartbeat or a model's reported success.
    {
        let _guard=LOCK.lock().map_err(|_|"Native scheduler lock poisoned.")?;
        recover_terminal_at(&file,crate::native_worker_job::read(app)?.as_ref())?;
    }
    preflight_at(&file,graph,step,tool,action_id)
}
fn begin_at(file:&Path,graph:Option<&Value>,step:&str,tool:&str,id:&str)->Result<(),String>{
    let _guard=LOCK.lock().map_err(|_|"Native scheduler lock poisoned.")?;
    let mut schedule=merged(read_at(file)?,graph)?;
    allowed(&schedule,step,tool,id)?;
    let job=schedule.jobs.iter_mut().find(|j|j.step_id==step)
        .ok_or("Scheduled native action disappeared.")?;
    job.phase="running".into();
    job.action_id=Some(id.into());
    persist(file,&schedule)
}
pub(crate) fn begin(app:&AppHandle,graph:Option<&Value>,step:&str,tool:&str,id:&str)
    ->Result<(),String>{
    begin_at(&path(app)?,graph,step,tool,id)
}
fn finish_at(file:&Path,id:&str,tool:&str,success:Option<bool>)->Result<(),String>{
    let _guard=LOCK.lock().map_err(|_|"Native scheduler lock poisoned.")?;
    let mut schedule=read_at(file)?.ok_or("Native schedule disappeared before audit.")?;
    let job=schedule.jobs.iter_mut()
        .find(|j|j.action_id.as_deref()==Some(id)&&j.tool==tool)
        .ok_or("Audit UUID does not match the running scheduled worker.")?;
    if job.phase!="running"{
        return Err("Native scheduler cannot audit an action twice.".into());
    }
    job.phase=match success {Some(true)=>"audited",Some(false)=>"failed",None=>"outcome_unknown"}.into();
    persist(file,&schedule)
}
pub(crate) fn finish(app:&AppHandle,id:&str,tool:&str,success:Option<bool>)->Result<(),String>{
    finish_at(&path(app)?,id,tool,success)
}
pub(crate) fn read(app:&AppHandle)->Result<Option<Schedule>,String>{
    let _guard=LOCK.lock().map_err(|_|"Native scheduler lock poisoned.")?;
    read_at(&path(app)?)
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn file()->PathBuf{std::env::temp_dir().join(format!("shuvi-scheduler-{}.json",uuid::Uuid::new_v4()))}
    fn graph(revision:u32)->Value{
        serde_json::json!({"objective":"Create edit","revision":revision,
          "steps":[{"step_id":"model","expected_tool":"blender_run_plan","depends_on":[]},
          {"step_id":"import","expected_tool":"premiere_insert_media","depends_on":["model"]}]})
    }
    fn cleanup(p:&Path){let _=fs::remove_file(p);let _=fs::remove_file(p.with_extension("json.bak"));}
    #[test]
    fn omitted_initial_revision_defaults_to_one_but_invalid_revision_fails(){
        let mut value=graph(1);
        value.as_object_mut().unwrap().remove("revision");
        assert_eq!(from_graph(&value).unwrap().revision,1);
        value["revision"]=serde_json::json!("bad");
        assert!(from_graph(&value).is_err());
    }
    #[test]
    fn real_approved_steps_advance_when_exact_dependencies_are_audited(){
        let p=file();let g=graph(1);
        preflight_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        assert!(preflight_at(&p,Some(&g),"import","premiere_insert_media",B).is_err());
        begin_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        assert!(begin_at(&p,None,"import","premiere_insert_media",B).is_err());
        finish_at(&p,A,"blender_run_plan",Some(true)).unwrap();
        assert!(preflight_at(&p,None,"import","premiere_insert_media",B).is_ok());
        begin_at(&p,None,"import","premiere_insert_media",B).unwrap();
        finish_at(&p,B,"premiere_insert_media",Some(true)).unwrap();
        let restored=read_at(&p).unwrap().unwrap();
        assert_eq!(restored.jobs.len(),2);
        assert!(restored.jobs.iter().all(|j|j.phase=="audited"));
        assert!(begin_at(&p,None,"model","blender_run_plan",A).is_err());
        cleanup(&p);
    }
    #[test]
    fn restart_keeps_running_unknown_and_blocks_duplicate_dispatch(){
        let p=file();let g=graph(1);
        begin_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        assert!(preflight_at(&p,None,"model","blender_run_plan",A).is_err());
        assert!(preflight_at(&p,None,"import","premiere_insert_media",B).is_err());
        assert_eq!(read_at(&p).unwrap().unwrap().jobs[0].phase,"running");
        finish_at(&p,A,"blender_run_plan",None).unwrap();
        assert!(preflight_at(&p,None,"import","premiere_insert_media",B).is_err());
        cleanup(&p);
    }
    #[test]
    fn audited_journal_repairs_crash_gap_without_rerunning_action(){
        let p=file();let g=graph(1);
        begin_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        let native=crate::native_worker_job::NativeJob{
            version:1,action_id:A.into(),tool:"blender_run_plan".into(),
            phase:"audit_verified".into(),started_at_ms:1000,
            updated_at_ms:2000,heartbeat_seq:0,audit_success:Some(true),
            prior_action_ids:Vec::new()
        };
        recover_terminal_at(&p,Some(&native)).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().jobs[0].phase,"audited");
        assert!(preflight_at(&p,None,"import","premiere_insert_media",B).is_ok());
        cleanup(&p);
    }
    #[test]
    fn foreign_native_journal_does_not_unlock_stale_job(){
        let p=file();let g=graph(1);
        begin_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        let native=crate::native_worker_job::NativeJob{
            version:1,action_id:B.into(),tool:"blender_run_plan".into(),
            phase:"audit_verified".into(),started_at_ms:1000,
            updated_at_ms:2000,heartbeat_seq:0,audit_success:Some(true),
            prior_action_ids:Vec::new()
        };
        assert!(recover_terminal_at(&p,Some(&native)).is_err());
        assert!(recover_terminal_at(&p,None).is_err());
        cleanup(&p);
    }
    #[test]
    fn failure_and_tool_mismatch_are_never_autoretried(){
        let p=file();let g=graph(1);
        assert!(begin_at(&p,Some(&g),"model","premiere_insert_media",A).is_err());
        begin_at(&p,Some(&g),"model","blender_run_plan",A).unwrap();
        finish_at(&p,A,"blender_run_plan",Some(false)).unwrap();
        assert!(begin_at(&p,None,"import","premiere_insert_media",B).is_err());
        cleanup(&p);
    }
    #[test]
    fn cycles_forged_states_and_same_revision_mutations_fail_closed(){
        let p=file();let mut g=graph(1);
        g["steps"][0]["depends_on"]=serde_json::json!(["import"]);
        assert!(preflight_at(&p,Some(&g),"model","blender_run_plan",A).is_err());
        let valid=graph(1);
        begin_at(&p,Some(&valid),"model","blender_run_plan",A).unwrap();
        finish_at(&p,A,"blender_run_plan",Some(true)).unwrap();
        let mut changed=graph(1);
        changed["steps"][1]["expected_tool"]=serde_json::json!("read_file");
        assert!(preflight_at(&p,Some(&changed),"import","read_file",B).is_err());
        cleanup(&p);
    }
}
