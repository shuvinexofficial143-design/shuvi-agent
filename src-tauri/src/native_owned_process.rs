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
use super::{Schedule,validate};
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
struct ProcessSlot {active:Option<String>,recent:Vec<String>}
static PROCESS_OWNER:Mutex<ProcessSlot>=Mutex::new(ProcessSlot{
    active:None,recent:Vec::new()
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
pub(crate) struct OwnedProcess {
    action_id:String,
    tool:String,
    child:OwnedChild,
    start:Instant,
    budget:Duration,
    final_phase:Option<&'static str>,
    final_code:Option<i32>,
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
fn spawn_checked(schedule:&Schedule,native:&crate::native_worker_job::NativeJob,
    action_id:&str,tool:&str,program:&Path,args:&[OsString],
    cwd:&Path,budget:Duration)->Result<OwnedProcess,String>{
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
    slot.recent.push(action_id.to_owned());
    if slot.recent.len()>MAX_RECENT_LAUNCHES{slot.recent.remove(0);}
    Ok(OwnedProcess{action_id:action_id.to_owned(),tool:tool.to_owned(),
        child,start:Instant::now(),budget,final_phase:None,final_code:None})
}
/// No new Tauri command is exported. Only an existing authorized backend
/// adapter with an acquired native OS lease can call this entrypoint.
/// It must NOT pass executable paths/arguments originating from model output.
pub(crate) fn spawn_for_active_action(
    app:&AppHandle,_lease:&NativeExecutionLease<'_>,
    action_id:&str,tool:&str,program:&Path,args:&[OsString],
    cwd:&Path,budget:Duration
)->Result<OwnedProcess,String>{
    let schedule=super::read(app)?.ok_or("Native schedule missing at worker spawn.")?;
    let native=crate::native_worker_job::read(app)?
        .ok_or("Durable native action journal missing at worker spawn.")?;
    spawn_checked(&schedule,&native,action_id,tool,program,args,cwd,budget)
}
impl OwnedProcess {
    pub(crate) fn pid(&self)->u32{self.child.id()}
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
        match self.child.try_wait()?{
            Some(code)=>{
                self.final_code=Some(code);
                if self.child.active_processes()?==0{
                    self.final_phase=Some("exited");
                    Ok(self.observation("exited"))
                }else if self.start.elapsed()>=self.budget{
                    self.stop_owned_tree("timed_out")
                }else{Ok(self.observation("descendants_running"))}
            },
            None if self.start.elapsed()>=self.budget=>self.stop_owned_tree("timed_out"),
            None=>Ok(self.observation("running"))
        }
    }
    /// Cancellation requires exact action UUID and kills ONLY the directly
    /// owned Child handle. Descendant termination must be separately designed.
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
        self.final_phase=Some(phase);
        self.final_code=result;
        Ok(self.observation(phase))
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
impl Drop for OwnedProcess{
    fn drop(&mut self){
        // Fail closed if an OS stop/reap operation failed: the current
        // process must not hand its slot to a competing owned child.
        let stopped=self.final_phase.is_some()
            ||self.stop_direct_child("cancelled").is_ok();
        if stopped {
            if let Ok(mut owner)=PROCESS_OWNER.lock(){
                if owner.active.as_deref()==Some(self.action_id.as_str()){
                    owner.active=None;
                }
            }
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
    fn cmd()->PathBuf{
        PathBuf::from(std::env::var_os("ComSpec")
            .expect("Windows CI must supply COMSPEC"))
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
    fn cmd_exe_for_test()->PathBuf {cmd()}
    #[cfg(windows)]
    fn slow_exe()->PathBuf {
        PathBuf::from(std::env::var_os("SystemRoot").expect("Windows root"))
            .join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe")
    }
    #[cfg(windows)]
    fn slow_args()->Vec<OsString>{
        vec!["-NoProfile".into(),"-NonInteractive".into(),
             "-Command".into(),"Start-Sleep -Seconds 8".into()]
    }
    #[cfg(windows)]
    #[test]
    fn observed_pid_and_real_child_exit_do_not_fabricate_app_progress(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=cmd();
        let args=vec!["/D".into(),"/C".into(),"exit /B 0".into()];
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
    fn cancelled_owned_process_cannot_kill_a_foreign_action(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=slow_exe();
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
            &slow_exe(),&slow_args(),&std::env::temp_dir(),
            Duration::from_millis(100)).unwrap();
        let obs=child.wait_bounded().unwrap();
        assert_eq!(obs.phase,"timed_out");
        assert!(!obs.app_progress_verified);
        assert!(obs.descendants_contained);
    }
    #[cfg(windows)]
    #[test]
    fn active_worker_blocks_second_owned_child_until_reaped(){
        let _serial=TEST_PROCESS_MUTEX.lock().unwrap();
        let (schedule,journal)=fresh_snapshots();
        let action=journal.action_id.clone();
        let cmd=slow_exe();
        let args=slow_args();
        let mut child=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        let second=spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd,&args,&std::env::temp_dir(),Duration::from_secs(5));
        assert!(second.is_err());
        child.cancel_exact(&action).unwrap();
        drop(child);
        let fast=vec!["/D".into(),"/C".into(),"exit /B 0".into()];
        assert!(spawn_checked(&schedule,&journal,&action,"blender_run_plan",
            &cmd_exe_for_test(),&fast,&std::env::temp_dir(),
            Duration::from_secs(5)).is_err()); // completed UUID cannot replay
        let (next_schedule,next_journal)=fresh_snapshots();
        let next_action=next_journal.action_id.clone();
        let mut after=spawn_checked(&next_schedule,&next_journal,&next_action,"blender_run_plan",
            &cmd_exe_for_test(),&fast,&std::env::temp_dir(),Duration::from_secs(5)).unwrap();
        assert_eq!(after.wait_bounded().unwrap().phase,"exited");
    }
}
