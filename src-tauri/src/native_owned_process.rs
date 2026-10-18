// PID-owned subprocess lifecycle for trusted *Rust* worker adapters.
// Compiled inside native_scheduler. No frontend/model command line is accepted.
// Do not confuse OS liveness/exit with app progress, successful audit or output.
// Windows subprocesses are suspended until assigned to a Job Object.
use std::{
    ffi::OsString, fs,
    path::Path, process::{Child,Command,Stdio},
    sync::Mutex, thread,
    time::{Duration,Instant}
};
use tauri::AppHandle;
use crate::execution_lease::NativeExecutionLease;
use crate::{ActionState,register_managed_process,unregister_managed_process,current_runtime_status};
use super::{Schedule,validate};
#[path = "native_process_receipt.rs"]
pub(crate) mod process_receipt;

/// OS-only subprocess record is NOT an action audit. Invalid, interrupted or
/// incomplete launch evidence blocks a new tool even after a process restart.
pub(crate) fn require_process_receipt_clear(app:&AppHandle)->Result<(),String>{
    if process_receipt::read(app)?.is_some_and(|receipt|
        matches!(receipt.phase.as_str(),"launch_pending"|"running")){
        return Err("Unresolved owned process launch/PID blocks new native execution; owner review required.".into());
    }
    Ok(())
}
/// Called ONLY from the existing authenticated owner reconciliation entrypoint
/// while its exclusive native lease is held. No automatic restart cleanup.
pub(crate) fn review_process_receipt_for_owner(
    app:&AppHandle,id:&str,tool:&str
)->Result<(),String>{
    let Some(r)=process_receipt::read(app)? else {return Ok(());};
    if matches!(r.phase.as_str(),"launch_pending"|"running"){
        if r.action_id!=id||r.tool!=tool{
            return Err("Foreign unresolved process receipt cannot be dismissed by owner review.".into());
        }
        process_receipt::owner_review_at(&process_receipt::path(app)?,id,tool)?;
    }
    Ok(())
}
#[cfg(windows)]
#[path = "native_windows_job.rs"]
mod windows_job;
#[cfg(windows)]
use windows_job::OwnedChild;
#[cfg(not(windows))]
struct OwnedChild(Child);
#[cfg(not(windows))]
impl OwnedChild {
    fn spawn(exe:&Path,args:&[OsString],cwd:&Path)->Result<Self,String>{
        let mut cmd=Command::new(exe);
        cmd.args(args).current_dir(cwd).stdin(Stdio::null())
            .stdout(Stdio::null()).stderr(Stdio::null()).env_clear();
        Ok(Self(cmd.spawn().map_err(|e|format!("Worker launch failed: {e}"))?))
    }
    fn id(&self)->u32{self.0.id()}
    fn tree_contained(&self)->bool{false}
    fn active_processes(&self)->Result<u32,String>{Ok(0)}
    fn try_wait(&mut self)->Result<Option<i32>,String>{
        self.0.try_wait().map(|x|x.map(|v|v.code().unwrap_or(-1)))
            .map_err(|e|format!("Worker wait failed: {e}"))
    }
    fn terminate_tree(&mut self)->Result<Option<i32>,String>{
        self.0.kill().map_err(|e|format!("Cannot terminate owned direct child: {e}"))?;
        self.0.wait().map(|s|Some(s.code().unwrap_or(-1)))
            .map_err(|e|format!("Worker reap failed: {e}"))
    }
}

const MIN_BUDGET_MS:u64=100;
const MAX_BUDGET_MS:u64=600_000;
const MAX_RECENT_LAUNCHES:usize=48;
struct ProcessSlot {active:Option<String>,recent:Vec<String>,cancel_requested:bool}
static PROCESS_OWNER:Mutex<ProcessSlot>=Mutex::new(ProcessSlot{
    active:None,recent:Vec::new(),cancel_requested:false
});

#[derive(Debug,Clone,PartialEq,Eq)]
pub(crate) struct ProcessObservation {
    pub action_id:String,
    pub tool:String,
    pub pid:u32,
    pub phase:&'static str, // running, exited, cancelled, timed_out
    pub exit_code:Option<i32>,
    // Observed Child handle only. No stdout is trusted as app completion.
    pub process_observed:bool,
    pub app_progress_verified:bool,
    pub descendants_contained:bool,
}
/// Request cancellation only for the exact in-process, PID-owned UUID.
/// The supervisor must terminate its retained Job Object handle; no caller
/// supplies a PID, OS shell command or foreign process identity.
pub(crate) fn request_cancel_exact(id:&str)->Result<bool,String>{
    if uuid::Uuid::parse_str(id).map(|x|x.to_string()!=id).unwrap_or(true){
        return Err("Invalid action UUID for owned process cancellation.".into());
    }
    let mut slot=PROCESS_OWNER.lock()
        .map_err(|_|"Native process cancellation state poisoned.")?;
    if slot.active.as_deref()!=Some(id){return Ok(false);}
    slot.cancel_requested=true;
    Ok(true)
}
/// Called by EXISTING authorized local owner Stop IPC. Serialize durable
/// stop intent against terminal publication using the same process slot lock.
/// If disk persistence fails, still request OS termination, return an error,
/// and require independent owner review before any further task is run.
pub(crate) fn request_cancel_exact_persisted(app:&AppHandle,id:&str)->Result<bool,String>{
    if uuid::Uuid::parse_str(id).map(|x|x.to_string()!=id).unwrap_or(true){
        return Err("Invalid owner Stop action UUID.".into());
    }
    let mut owner=PROCESS_OWNER.lock()
        .map_err(|_|"Native owner cancellation lock poisoned.")?;
    if owner.active.as_deref()!=Some(id){return Ok(false);}
    let durable=process_receipt::path(app)
        .and_then(|path|process_receipt::mark_cancel_requested_at(&path,id));
    owner.cancel_requested=true;
    durable.map(|_|true)
}
/// Bind the real owned PID to the existing Shuvi RAM/tree accounting
/// while the Rust-owned child is alive. Never permit raw-PID cancellation:
/// that always flows through the separate retained Windows Job Object.
pub(crate) struct RegisteredOwnedPid<'a>{state:&'a ActionState,pid:u32}
impl<'a> RegisteredOwnedPid<'a>{
    pub(crate) fn start(state:&'a ActionState,pid:u32)->Result<Self,String>{
        register_managed_process(state,pid)?;
        Ok(Self{state,pid})
    }
}
impl Drop for RegisteredOwnedPid<'_>{
    fn drop(&mut self){unregister_managed_process(self.state,self.pid);}
}
pub(crate) struct OwnedProcess<'lease> {
    action_id:String,
    tool:String,
    child:OwnedChild,
    start:Instant,
    budget:Duration,
    final_phase:Option<&'static str>,
    final_code:Option<i32>,
    // Retain the actual Windows desktop lease until the owned worker tree
    // has exited or been independently confirmed terminated.
    lease:Option<NativeExecutionLease<'lease>>,
    receipt_path:Option<std::path::PathBuf>,
}
fn identity_matches(
    schedule:&Schedule,native:&crate::native_worker_job::NativeJob,
    action_id:&str,tool:&str
)->Result<(),String>{
    validate(schedule)?;
    if uuid::Uuid::parse_str(action_id).map(|x|x.to_string()!=action_id).unwrap_or(true)
       ||native.action_id!=action_id||native.tool!=tool||native.phase!="running"
       ||native.audit_success.is_some(){
        return Err("Worker process requires the exact active Rust journal UUID and tool.".into());
    }
    if schedule.jobs.iter().filter(|j|j.phase=="running").count()!=1
       ||!schedule.jobs.iter().any(|j|j.phase=="running"
          &&j.action_id.as_deref()==Some(action_id)&&j.tool==tool){
        return Err("Worker process does not own the scheduled running job.".into());
    }
    Ok(())
}
fn checked_program(program:&Path,cwd:&Path,args:&[OsString],budget:Duration)
 ->Result<std::path::PathBuf,String>{
    if !program.is_absolute()||!cwd.is_absolute()
        ||args.len()>32||args.iter().any(|a|a.is_empty()
          ||a.to_string_lossy().len()>2048)
        ||budget.as_millis()<(MIN_BUDGET_MS as u128)
        ||budget.as_millis()>(MAX_BUDGET_MS as u128){
        return Err("Trusted worker process specification is not bounded/absolute.".into());
    }
    let metadata=fs::symlink_metadata(program)
        .map_err(|_|"Trusted worker executable cannot be inspected.")?;
    if !metadata.is_file()||metadata.file_type().is_symlink(){
        return Err("Trusted worker executable must be a regular file.".into());
    }
    let working=fs::symlink_metadata(cwd)
        .map_err(|_|"Trusted worker working directory cannot be inspected.")?;
    if !working.is_dir()||working.file_type().is_symlink(){
        return Err("Trusted worker working directory must be a regular directory.".into());
    }
    fs::canonicalize(program).map_err(|_|"Trusted worker executable cannot be resolved.".into())
}
// Internal seam: receives only authoritative Rust snapshots. Production
// entrypoint below loads them from native disk state while caller holds lease.
fn spawn_checked<'lease>(schedule:&Schedule,native:&crate::native_worker_job::NativeJob,
    action_id:&str,tool:&str,program:&Path,args:&[OsString],
    cwd:&Path,budget:Duration)->Result<OwnedProcess<'lease>,String>{
    identity_matches(schedule,native,action_id,tool)?;
    let executable=checked_program(program,cwd,args,budget)?;
    let mut slot=PROCESS_OWNER.lock().map_err(|_|"Native process owner lock poisoned.")?;
    if slot.active.is_some(){return Err("An owned worker process is already supervised.".into());}
    if slot.recent.iter().any(|seen|seen==action_id){
        return Err("Action UUID cannot launch another owned process.".into());
    }
    // Windows: suspend, contain process tree, then resume.
    let child=OwnedChild::spawn(&executable,args,cwd)?;
    slot.active=Some(action_id.to_owned());
    slot.cancel_requested=false;
    slot.recent.push(action_id.to_owned());
    if slot.recent.len()>MAX_RECENT_LAUNCHES{slot.recent.remove(0);}
    Ok(OwnedProcess{action_id:action_id.to_owned(),tool:tool.to_owned(),
        child,start:Instant::now(),budget,final_phase:None,final_code:None,
        lease:None,receipt_path:None})
}
/// No new Tauri command is exported. Only an existing authorized backend
/// adapter with an acquired native OS lease can call this entrypoint.
/// It must NOT pass executable paths/arguments originating from model output.
pub(crate) fn spawn_for_active_action<'lease>(
    app:&AppHandle,lease:NativeExecutionLease<'lease>,
    action_id:&str,tool:&str,program:&Path,args:&[OsString],
    cwd:&Path,budget:Duration
)->Result<OwnedProcess<'lease>,String>{
    let schedule=super::read(app)?.ok_or("Native schedule missing at worker spawn.")?;
    let native=crate::native_worker_job::read(app)?
        .ok_or("Durable native action journal missing at worker spawn.")?;
    // Durable intent precedes any OS launch. If launch crashes between
    // intent and PID publication, the next request remains quarantined.
    identity_matches(&schedule,&native,action_id,tool)?;
    let receipt=process_receipt::path(app)?;
    process_receipt::begin_at(&receipt,action_id,tool)?;
    let mut owned=spawn_checked(&schedule,&native,action_id,tool,program,args,cwd,budget)?;
    owned.lease=Some(lease);
    owned.receipt_path=Some(receipt.clone());
    process_receipt::started_at(&receipt,action_id,tool,
        owned.pid(),owned.child.tree_contained())?;
    Ok(owned)
}
impl<'lease> OwnedProcess<'lease> {
    pub(crate) fn pid(&self)->u32{self.child.id()}
    /// Return the original OS-wide desktop lease to the authorized caller
    /// ONLY after the entire owned child tree is verified terminated. This
    /// keeps the same lock through higher-level audit and artifact inspection.
    pub(crate) fn reclaim_terminal_lease(&mut self)
        ->Result<NativeExecutionLease<'lease>,String>{
        if self.final_phase.is_none()||self.child.active_processes()?!=0{
            return Err("Cannot return native desktop lease while worker descendants may run.".into());
        }
        self.lease.take().ok_or("Owned worker lease already returned or missing.".into())
    }
    fn record_terminal(&self,phase:&str,code:Option<i32>)->Result<(),String>{
        if let Some(path)=&self.receipt_path{
            process_receipt::finish_at(path,&self.action_id,&self.tool,phase,code)?;
        }
        Ok(())
    }
    /// Commit durable OS outcome and release the process-owner cancellation
    /// slot as ONE transition. The Windows desktop lease is independently
    /// retained until the higher-level action audit completes.
    ///
    /// Cancellation submitted before this boundary cannot be acknowledged
    /// and then silently overwritten by an OS exit 0: it is terminally
    /// classified as cancelled, never an application success.
    fn complete_owned_terminal(&mut self,phase:&'static str,code:Option<i32>)
        ->Result<ProcessObservation,String>{
        if self.final_phase.is_some(){
            return Err("Owned process terminal outcome was already published.".into());
        }
        if self.child.active_processes()?!=0{
            return Err("Owned subprocess cannot finish with active descendants.".into());
        }
        let mut owner=PROCESS_OWNER.lock()
            .map_err(|_|"Owned worker terminal owner lock poisoned.")?;
        if owner.active.as_deref()!=Some(self.action_id.as_str()){
            return Err("Owned subprocess terminal identity no longer matches native owner.".into());
        }
        let actual=if phase=="exited"&&owner.cancel_requested{
            "cancelled"
        }else{phase};
        // Intentionally hold this short serialisation boundary across the
        // durable write: Remote Stop cannot claim success after OS terminal.
        self.record_terminal(actual,code)?;
        self.final_phase=Some(actual);
        self.final_code=code;
        owner.active=None;
        owner.cancel_requested=false;
        Ok(self.observation(actual))
    }
    fn observation(&self,phase:&'static str)->ProcessObservation{
        ProcessObservation{action_id:self.action_id.clone(),tool:self.tool.clone(),
            pid:self.pid(),phase,exit_code:self.final_code,
            process_observed:true,app_progress_verified:false,
            descendants_contained:self.child.tree_contained()}
    }
    /// Samples this exact Child handle, not another PID's snapshot. Never
    /// turns supervisor liveness or exit=0 into Rust audit success.
    pub(crate) fn poll(&mut self)->Result<ProcessObservation,String>{
        if let Some(phase)=self.final_phase{return Ok(self.observation(phase));}
        let cancelled={
            let slot=PROCESS_OWNER.lock()
                .map_err(|_|"Owned worker cancellation state poisoned.")?;
            slot.active.as_deref()==Some(self.action_id.as_str())&&slot.cancel_requested
        };
        if cancelled {return self.stop_owned_tree("cancelled");}
        match self.child.try_wait()?{
            Some(code)=>{
                self.final_code=Some(code);
                if self.child.active_processes()?==0{
                    self.complete_owned_terminal("exited",Some(code))
                }else if self.start.elapsed()>=self.budget{
                    self.stop_owned_tree("timed_out")
                }else{Ok(self.observation("descendants_running"))}
            },
            None if self.start.elapsed()>=self.budget=>self.stop_owned_tree("timed_out"),
            None=>Ok(self.observation("running"))
        }
    }
    /// Cancellation requires exact action UUID. Windows terminates the
    /// contained Job Object; non-Windows support remains direct-child only.
    pub(crate) fn cancel_exact(&mut self,action_id:&str)->Result<ProcessObservation,String>{
        if action_id!=self.action_id{
            return Err("Cannot cancel a process owned by another action UUID.".into());
        }
        if self.final_phase.is_some(){return Err("Owned process is already terminal.".into());}
        self.stop_owned_tree("cancelled")
    }
    fn stop_owned_tree(&mut self,phase:&'static str)->Result<ProcessObservation,String>{
        let result=self.child.terminate_tree()?;
        if self.child.active_processes()?!=0{
            return Err("Owned worker descendants remain active".into());
        }
        self.complete_owned_terminal(phase,result)
    }
    /// Observe the same original native memory guard the legacy Blender
    /// adapter used, plus the OS-wide Job Object committed-memory ceiling.
    /// Samples while the real worker is active. Any unavailable host RAM
    /// observation is also fail-closed and terminates the owned tree.
    pub(crate) fn wait_bounded_with_host_budget(
        &mut self,state:&ActionState
    )->Result<ProcessObservation,String>{
        self.wait_bounded_with_probe(||current_runtime_status(state)
            .map(|status|status.over_hard_limit))
    }
    /// Independent worker-side, authenticated heartbeat; NEVER an OS exit,
    /// app-success, or license to clear the exclusive Windows desktop lease.
    pub(crate) fn wait_bounded_with_host_budget_and_progress<F>(
        &mut self,state:&ActionState,progress:F
    )->Result<ProcessObservation,String>
    where F:FnMut()->Result<(),String>{
        self.wait_bounded_with_probe_and_progress(
            ||current_runtime_status(state).map(|s|s.over_hard_limit),progress)
    }
    // Keep OS termination testable without allocating actual gigabytes on a
    // CI runner. Production passes the real registered-process RAM sampler.
    fn wait_bounded_with_probe<F>(&mut self,over_budget:F)
        ->Result<ProcessObservation,String>
        where F:FnMut()->Result<bool,String>{
        self.wait_bounded_with_probe_and_progress(over_budget,||Ok(()))
    }
    fn wait_bounded_with_probe_and_progress<F,G>(
        &mut self,mut over_budget:F,mut progress:G
    )->Result<ProcessObservation,String>
    where F:FnMut()->Result<bool,String>,G:FnMut()->Result<(),String>{
        loop{
            let observed=self.poll()?;
            if observed.phase!="running"&&observed.phase!="descendants_running"{
                return Ok(observed);
            }
            match over_budget(){
                Ok(true)=>{
                    self.stop_owned_tree("cancelled")?;
                    return Err("Owned Blender worker exceeded Shuvi 4 GB combined host RAM ceiling; process tree stopped. Inspect effects before retry.".into());
                },
                Ok(false)=>{},
                Err(_)=>{
                    self.stop_owned_tree("cancelled")?;
                    return Err("Cannot independently verify owned Blender memory; stopped worker before further mutations.".into());
                }
            }
            if let Err(error)=progress(){
                self.stop_owned_tree("cancelled")?;
                return Err(format!(
                    "Authenticated worker heartbeat invalid or stalled ({error}); owned tree stopped; inspect application effects."
                ));
            }
            thread::sleep(Duration::from_millis(250));
        }
    }
    /// Bounded blocking wait with real process polling; it cannot claim a
    /// verified application heartbeat, durable audit or descendant shutdown.
    pub(crate) fn wait_bounded(&mut self)->Result<ProcessObservation,String>{
        loop {
            let obs=self.poll()?;
            if obs.phase!="running"&&obs.phase!="descendants_running"{return Ok(obs);}
            thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for OwnedProcess<'_>{
    fn drop(&mut self){
        // Fail closed if an OS stop/reap operation failed: the current
        // process must not hand its slot to a competing owned child.
        let stopped=self.final_phase.is_some()
            ||self.stop_owned_tree("cancelled").is_ok();
        if stopped {
            if let Ok(mut owner)=PROCESS_OWNER.lock(){
                if owner.active.as_deref()==Some(self.action_id.as_str()){
                    owner.active=None;
                    owner.cancel_requested=false;
                }
            }
        }else if let Some(lease)=self.lease.take(){
            // The worker outcome or termination is uncertain. Keep the OS
            // desktop lane exclusively claimed for this process lifetime:
            // neither TTL expiry nor a failed kill may unlock mutations.
            std::mem::forget(lease);
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[cfg(windows)]
    use std::path::PathBuf;
    // Real child fixtures share a single OS-supervised process slot. Their
    // independent Rust tests must not race when cargo uses many test threads.
    #[cfg(windows)]
    static TEST_PROCESS_MUTEX:Mutex<()> = Mutex::new(());
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn snapshots()->(Schedule,crate::native_worker_job::NativeJob){
        let graph=serde_json::json!({"objective":"Authorized test",
          "revision":1,"steps":[{"step_id":"render",
          "expected_tool":"blender_run_plan","depends_on":[]}]});
        let mut schedule=super::super::from_graph(&graph).unwrap();
        schedule.jobs[0].phase="running".into();
        schedule.jobs[0].action_id=Some(A.into());
        let native=crate::native_worker_job::NativeJob{
            version:1,action_id:A.into(),tool:"blender_run_plan".into(),
            phase:"running".into(),started_at_ms:1000,updated_at_ms:1000,
            heartbeat_seq:0,audit_success:None,prior_action_ids:Vec::new()};
        (schedule,native)
    }
    #[test]
    fn mismatched_or_unapproved_native_process_never_spawns(){
        let (mut schedule,mut journal)=snapshots();
        assert!(identity_matches(&schedule,&journal,B,"blender_run_plan").is_err());
        assert!(identity_matches(&schedule,&journal,A,"premiere_insert_media").is_err());
        journal.phase="audit_verified".into();journal.audit_success=Some(true);
        assert!(identity_matches(&schedule,&journal,A,"blender_run_plan").is_err());
        schedule.jobs[0].phase="audited".into();
        assert!(identity_matches(&schedule,&journal,A,"blender_run_plan").is_err());
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Worker-only child process fixture"]
    fn worker_fixture_exit_zero() {}
    #[cfg(windows)]
    #[test]
    #[ignore = "Worker-only child process fixture"]
    fn worker_fixture_sleep() {
        std::thread::sleep(Duration::from_secs(12));
    }
    #[cfg(windows)]
    fn fresh_snapshots()->(Schedule,crate::native_worker_job::NativeJob){
        let (mut schedule,mut journal)=snapshots();
        let id=uuid::Uuid::new_v4().to_string();
        schedule.jobs[0].action_id=Some(id.clone());
        journal.action_id=id;
        (schedule,journal)
    }
    #[cfg(windows)]
    fn fixture_exe()->PathBuf{
        std::env::current_exe().expect("Test harness binary must exist")
    }
    #[cfg(windows)]
    fn fixture_args(name:&str)->Vec<OsString>{
        vec!["--ignored".into(),"--exact".into(),
            format!("native_scheduler::owned_process::tests::{name}").into()]
    }
    #[cfg(windows)]
    fn slow_args()->Vec<OsString>{fixture_args("worker_fixture_sleep")}

    #[cfg(windows)]
    #[test]
    fn missing_authenticated_worker_heartbeat_stops_real_owned_child(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),
            Duration::from_secs(10)).unwrap();
        let real_pid=child.pid();
        let denied=child.wait_bounded_with_probe_and_progress(
            ||Ok(false),||Err("unsigned or missing worker heartbeat".into()));
        assert!(denied.is_err());
        assert_eq!(child.pid(),real_pid);
        assert_eq!(child.poll().unwrap().phase,"cancelled");
        assert_eq!(child.child.active_processes().unwrap(),0);
    }
    #[cfg(windows)]
    #[test]
    fn observed_pid_and_real_child_exit_do_not_fabricate_app_progress(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=fixture_exe();
        let args=fixture_args("worker_fixture_exit_zero");
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        let pid=child.pid();
        assert!(pid>0);
        let finished=child.wait_bounded().unwrap();
        assert_eq!(finished.pid,pid);
        assert_eq!(finished.phase,"exited");
        assert_eq!(finished.exit_code,Some(0));
        assert!(finished.process_observed);
        assert!(!finished.app_progress_verified);
        assert!(finished.descendants_contained);
    }
    #[cfg(windows)]
    #[test]
    fn real_owned_child_exit_persists_pid_and_terminal_os_receipt(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let path=std::env::temp_dir().join(format!(
            "shuvi-owned-process-e2e-{}.json",uuid::Uuid::new_v4()));
        process_receipt::begin_at(&path,&action,"blender_run_plan").unwrap();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&fixture_args("worker_fixture_exit_zero"),
            &std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        let real_pid=child.pid();
        child.receipt_path=Some(path.clone());
        process_receipt::started_at(&path,&action,"blender_run_plan",
            real_pid,true).unwrap();
        let running=process_receipt::read_at(&path).unwrap().unwrap();
        assert_eq!(running.phase,"running");
        assert_eq!(running.pid,Some(real_pid));
        assert!(!running.app_progress_verified);
        let finished=child.wait_bounded().unwrap();
        assert_eq!(finished.phase,"exited");
        drop(child);
        let reloaded=process_receipt::read_at(&path).unwrap().unwrap();
        assert_eq!(reloaded.phase,"exited");
        assert_eq!(reloaded.pid,Some(real_pid));
        assert_eq!(reloaded.exit_code,Some(0));
        assert!(reloaded.descendants_contained);
        assert!(!reloaded.app_progress_verified);
        let _=std::fs::remove_file(&path);
        let _=std::fs::remove_file(path.with_extension("json.bak"));
    }
    #[cfg(windows)]
    #[test]
    fn cancelled_owned_process_cannot_kill_a_foreign_action(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=fixture_exe();
        let args=slow_args();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert!(child.cancel_exact(B).is_err());
        let result=child.cancel_exact(&action).unwrap();
        assert!(matches!(result.phase,"cancelled"|"exited"));
        assert!(!result.app_progress_verified);
        assert!(result.descendants_contained);
    }
    #[cfg(windows)]
    #[test]
    fn deadline_stops_only_owned_direct_child_without_inventing_success(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),
            Duration::from_millis(100)).unwrap();
        let obs=child.wait_bounded().unwrap();
        assert_eq!(obs.phase,"timed_out");
        assert!(!obs.app_progress_verified);
        assert!(obs.descendants_contained);
    }
    #[cfg(windows)]
    #[test]
    fn real_windows_job_stops_when_host_memory_probe_reports_over_limit(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),
            Duration::from_secs(5)).unwrap();
        let mut samples=0;
        let failed=child.wait_bounded_with_probe(||{
            samples+=1;
            Ok(true)
        });
        assert!(failed.unwrap_err().contains("4 GB combined host RAM"));
        assert!(samples>=1);
        let state=child.poll().unwrap();
        assert_eq!(state.phase,"cancelled");
        assert!(state.descendants_contained);
        assert!(!state.app_progress_verified);
    }
    #[cfg(windows)]
    #[test]
    fn unavailable_host_memory_probe_also_stops_exact_owned_job(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (mut schedule,mut journal)=fresh_snapshots();
        // This fixture exercises blender_inspect, so both durable Rust
        // authorities must identify that tool before a real PID is created.
        // Keep the exact-identity guard strict; do not bypass it for tests.
        schedule.jobs[0].tool="blender_inspect".into();
        journal.tool="blender_inspect".into();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_inspect",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),
            Duration::from_secs(5)).unwrap();
        let result=child.wait_bounded_with_probe(||Err("memory telemetry unavailable".into()));
        assert!(result.unwrap_err().contains("Cannot independently verify"));
        let terminal=child.poll().unwrap();
        assert_eq!(terminal.phase,"cancelled");
        assert!(!terminal.app_progress_verified);
        assert!(terminal.descendants_contained);
    }
    #[cfg(windows)]
    #[test]
    fn exact_owner_remote_stop_interrupts_real_contained_worker(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert_eq!(request_cancel_exact(B).unwrap(),false);
        assert_eq!(request_cancel_exact(&action).unwrap(),true);
        let observed=child.wait_bounded().unwrap();
        assert_eq!(observed.phase,"cancelled");
        assert!(observed.descendants_contained);
        assert!(!observed.app_progress_verified);
        drop(child);
        assert_eq!(request_cancel_exact(&action).unwrap(),false);
    }
    #[cfg(windows)]
    #[test]
    fn owner_cancel_before_terminal_publication_cannot_be_lost_to_natural_exit(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&fixture_args("worker_fixture_exit_zero"),
            &std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        // Observe actual OS termination WITHOUT publishing the Rust terminal
        // receipt; reproduce the exact window when an owner clicks Stop.
        let deadline=Instant::now()+Duration::from_secs(5);
        loop{
            if child.child.try_wait().unwrap().is_some()
                &&child.child.active_processes().unwrap()==0{break;}
            assert!(Instant::now()<deadline,"Rust child fixture did not exit");
            thread::sleep(Duration::from_millis(10));
        }
        assert!(request_cancel_exact(&action).unwrap());
        let terminal=child.complete_owned_terminal("exited",Some(0)).unwrap();
        assert_eq!(terminal.phase,"cancelled");
        assert_eq!(terminal.exit_code,Some(0)); // OS zero is NOT app success
        assert!(!terminal.app_progress_verified);
        assert!(!request_cancel_exact(&action).unwrap());
        drop(child);
    }
    #[cfg(windows)]
    #[test]
    fn terminal_releases_pid_owner_before_artifact_audit_without_unlocking_desktop_lease(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let id=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&id,"blender_run_plan",
            &fixture_exe(),&fixture_args("worker_fixture_exit_zero"),
            &std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert_eq!(child.wait_bounded().unwrap().phase,"exited");
        // The OwnedProcess object deliberately remains alive while higher
        // level Rust verifies artifacts and saves the authenticated audit.
        assert!(!request_cancel_exact(&id).unwrap());
        assert!(child.cancel_exact(&id).is_err());
        drop(child);
    }
    #[cfg(windows)]
    #[test]
    fn cancelled_process_releases_only_its_exact_running_uuid(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let id=journal.action_id.clone();
        let mut child=spawn_checked(&schedule,&journal,&id,"blender_run_plan",
            &fixture_exe(),&slow_args(),&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert!(request_cancel_exact(&id).unwrap());
        let observation=child.wait_bounded().unwrap();
        assert_eq!(observation.phase,"cancelled");
        assert!(!request_cancel_exact(&id).unwrap());
        assert!(!observation.app_progress_verified);
    }
    #[cfg(windows)]
    #[test]
    fn active_worker_blocks_second_owned_child_until_reaped(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=fixture_exe();
        let args=slow_args();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        let second=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5));
        assert!(second.is_err());
        child.cancel_exact(&action).unwrap();
        drop(child);
        let fast=fixture_args("worker_fixture_exit_zero");
        assert!(spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &fixture_exe(),&fast,&std::env::temp_dir(),
            Duration::from_secs(5)).is_err()); // completed UUID cannot replay
        let (next_schedule,next_journal)=fresh_snapshots();
        let next_action=next_journal.action_id.clone();
        let mut after=spawn_checked(&next_schedule,&next_journal,&next_action,"blender_run_plan",
            &fixture_exe(),&fast,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert_eq!(after.wait_bounded().unwrap().phase,"exited");
    }
}
