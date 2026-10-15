//! Rust-owned persistent Blender child with an authenticated fixed Python broker.
//! Called ONLY by ordinary audited, owner-approved native ToolAction variants.
//! No model-supplied Python, shell, arbitrary op or permission bypass.
use std::{
    io::{Read,Write}, path::Path, process::{Child,ChildStdin,Command,Stdio},
    sync::{Arc,Mutex,atomic::{AtomicBool,Ordering},mpsc::{self,Receiver,RecvTimeoutError}},
    thread, time::{Duration,Instant},
};
use serde_json::{Value,json};
use tauri::{AppHandle,Manager};
use crate::{
    ActionState,register_managed_process,unregister_managed_process,
    managed_process_identity_matches,terminate_managed_process_tree,
    terminate_registered_process_tree,current_runtime_status,
    blender_plan_worker,
};


#[cfg(target_os="windows")]
mod windows_job {
    use std::{mem,os::windows::io::AsRawHandle,process::Child,ptr};
    use windows_sys::Win32::Foundation::{CloseHandle,HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject,CreateJobObjectW,SetInformationJobObject,
        JobObjectExtendedLimitInformation,JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // CloseHandle on this *owned* job terminates all associated child processes.
    // A broker may never launch Blender until Rust has attached its PID here.
    pub(super) struct OwnedJob(HANDLE);
    unsafe impl Send for OwnedJob {}
    impl OwnedJob {
        pub(super) fn attach(child:&Child)->Result<Self,String> {
            let handle=unsafe{CreateJobObjectW(ptr::null(),ptr::null())};
            if handle.is_null(){
                return Err("Cannot create mandatory Windows Blender process Job Object.".into());
            }
            let job=Self(handle);
            let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=unsafe{mem::zeroed()};
            limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured=unsafe{SetInformationJobObject(
                job.0,JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )};
            if configured==0{
                return Err("Cannot configure kill-on-close Windows Blender Job Object.".into());
            }
            let bound=unsafe{AssignProcessToJobObject(job.0,child.as_raw_handle() as HANDLE)};
            if bound==0{
                return Err("Could not assign exact Blender broker child to Windows Job Object.".into());
            }
            Ok(job)
        }
    }
    impl Drop for OwnedJob {
        fn drop(&mut self){unsafe{CloseHandle(self.0);}}
    }
}

const MAX_FRAME:usize=131072;
const SESSION_MAX_AGE:Duration=Duration::from_secs(15*60);
const STARTUP_DEADLINE:Duration=Duration::from_secs(35);
const PROBE_DEADLINE:Duration=Duration::from_secs(15);
const PLAN_DEADLINE:Duration=Duration::from_secs(120);

#[derive(Default)]
pub(crate) struct SessionRegistry {
    current:Mutex<Option<OwnedSession>>,
}

struct OwnedSession {
    child:Child,
    input:ChildStdin,
    replies:Receiver<Vec<u8>>,
    session_id:String,
    output_dir:String,
    allow_render:bool,
    created:Instant,
    watchdog_stop:Arc<AtomicBool>,
    invalidated:Arc<AtomicBool>,
    #[cfg(target_os="windows")]
    _windows_job:windows_job::OwnedJob,
}

impl Drop for OwnedSession {
    fn drop(&mut self) {
        self.watchdog_stop.store(true,Ordering::Release);
        // Child handle ownership is stronger than a PID guess. Only an owned,
        // still-running launcher may be terminated, including its child Blender
        // on Windows. Never stop a process because of a stale numeric PID alone.
        if !matches!(self.child.try_wait(),Ok(Some(_))) {
            let _=terminate_managed_process_tree(self.child.id());
            let _=self.child.kill();
        }
        // Never block Shuvi's native action indefinitely in a destructor.
        // On Windows the owned Job Object closes immediately after Drop,
        // providing kernel-backed child-tree termination even if a wait fails.
        let deadline=Instant::now()+Duration::from_secs(3);
        while Instant::now()<deadline {
            match self.child.try_wait() {
                Ok(Some(_))=>break,
                Ok(None)=>thread::sleep(Duration::from_millis(40)),
                Err(_)=>break,
            }
        }
    }
}

fn reader(mut stdout:impl Read+Send+'static)->Receiver<Vec<u8>> {
    // Capacity one prevents memory growth when an unexpected child floods stdout.
    let (tx,rx)=mpsc::sync_channel(1);
    thread::spawn(move || {
        loop {
            let mut data=Vec::new();
            let mut next=[0u8;1];
            loop {
                match stdout.read(&mut next) {
                    Ok(0)=>return,
                    Ok(_)=>{
                        if data.len()>=MAX_FRAME{return;}
                        if next[0]==b'\n'{break;}
                        data.push(next[0]);
                    },
                    Err(_)=>return,
                }
            }
            if tx.send(data).is_err(){return;}
        }
    });
    rx
}

fn receive(session:&mut OwnedSession,state:&ActionState,deadline:Duration)->Result<Value,String> {
    let start=Instant::now();
    loop {
        // A graceful close may exit immediately after writing its final
        // acknowledgement. Read already-buffered replies before probing exit.
        match session.replies.try_recv() {
            Ok(raw)=>{
                let value:Value=serde_json::from_slice(&raw)
                    .map_err(|_|"Malformed Blender broker response.".to_string())?;
                if value.get("version").and_then(Value::as_u64)!=Some(1){
                    return Err("Blender broker protocol version mismatch.".into());
                }
                return Ok(value);
            },
            Err(mpsc::TryRecvError::Empty)=>{},
            Err(mpsc::TryRecvError::Disconnected)=>
                return Err("Blender broker channel disconnected; outcome unknown.".into()),
        }
        if !managed_process_identity_matches(state,session.child.id())?
            || session.child.try_wait().map_err(|_|"Owned Blender process state unavailable.")?.is_some() {
            return Err("Blender session process disappeared; never automatically reconnect.".into());
        }
        match current_runtime_status(state) {
            Ok(value) if value.over_hard_limit=>
                return Err("Blender session exceeded the native 4 GB hard memory budget.".into()),
            Err(_)=>return Err("Blender session memory evidence is unavailable.".into()),
            _=>{}
        }
        if start.elapsed()>=deadline{
            return Err("Blender session response deadline exceeded; outcome unknown, inspect before retry.".into());
        }
        let remaining=deadline.saturating_sub(start.elapsed());
        match session.replies.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(raw)=>{
                let message:Value=serde_json::from_slice(&raw)
                    .map_err(|_|"Malformed Blender broker response.".to_string())?;
                if message.get("version").and_then(Value::as_u64)!=Some(1) {
                    return Err("Blender broker protocol version mismatch.".into());
                }
                return Ok(message);
            },
            Err(RecvTimeoutError::Timeout)=>{},
            Err(RecvTimeoutError::Disconnected)=>
                return Err("Blender broker pipe disconnected; outcome unknown.".into()),
        }
    }
}

fn request(session:&mut OwnedSession,state:&ActionState,op:&str,plan:Option<&Value>,allow_render:bool,deadline:Duration)->Result<Value,String>{
    if session.invalidated.load(Ordering::Acquire){
        return Err("Blender session was invalidated by the native watchdog.".into());
    }
    if session.created.elapsed()>SESSION_MAX_AGE{
        return Err("Blender session expired; inspect and start a fresh explicitly approved session.".into());
    }
    let mut command=json!({"version":1,"session_id":session.session_id,"op":op});
    if let Some(value)=plan{
        command["plan"]=value.clone();
        command["allow_render"]=json!(allow_render);
    }
    let mut encoded=serde_json::to_vec(&command).map_err(|_|"Cannot encode bounded Blender command.")?;
    if encoded.len()>65536{return Err("Blender session plan exceeds 64 KiB.".into());}
    encoded.push(b'\n');
    session.input.write_all(&encoded)
        .and_then(|_|session.input.flush())
        .map_err(|_|"Blender session command delivery uncertain; no replay allowed.".to_string())?;
    let answer=receive(session,state,deadline)?;
    if session.invalidated.load(Ordering::Acquire){
        return Err("Blender session invalidated while command was running; never replay.".into());
    }
    if answer.get("session_id").and_then(Value::as_str)!=Some(session.session_id.as_str()){
        return Err("Blender broker returned a different session identity.".into());
    }
    Ok(answer)
}

fn retire(state:&ActionState,slot:&mut Option<OwnedSession>)->bool {
    if let Some(session)=slot.take(){
        let pid=session.child.id();
        drop(session);
        let root_exited=!managed_process_identity_matches(state,pid).unwrap_or(false);
        unregister_managed_process(state,pid);
        root_exited
    }else{false}
}


// The watchdog is deliberately independent from the session Mutex: an active
// plan holds that lock while waiting for Blender and must remain killable when
// it exceeds the RAM ceiling or 15-minute lifetime. OS-start-time matching
// prevents PID reuse from turning into unrelated-process termination.
fn spawn_watchdog(
    app:&AppHandle,id:&str,pid:u32,created:Instant,stop:Arc<AtomicBool>,
    invalidated:Arc<AtomicBool>,
)->Result<(),String>{
    let app=app.clone();
    let id=id.to_owned();
    thread::Builder::new().name("shuvi-blender-watchdog".into()).spawn(move||{
        let mut kill_attempted=false;
        loop {
            if stop.load(Ordering::Acquire){return;}
            thread::sleep(Duration::from_millis(650));
            if stop.load(Ordering::Acquire){return;}
            let state=app.state::<ActionState>();
            let alive=managed_process_identity_matches(&state,pid);
            let memory=current_runtime_status(&state);
            let expired=created.elapsed()>=SESSION_MAX_AGE;
            let memory_unsafe=match memory {
                Ok(ref m)=>m.over_hard_limit,
                Err(_)=>true,
            };
            let must_retire=expired || !matches!(alive,Ok(true)) || memory_unsafe;
            if !must_retire {continue;}
            invalidated.store(true,Ordering::Release);
            if !kill_attempted && matches!(alive,Ok(true)){
                // Only kill the exact still-owned process tree. On Windows
                // taskkill /T /F includes Blender descended from the broker.
                let _=terminate_registered_process_tree(&state,pid);
                kill_attempted=true;
            }
            match state.blender_session.current.try_lock(){
                Ok(mut slot)=>{
                    if slot.as_ref().is_some_and(|s|s.session_id==id && s.child.id()==pid){
                        retire(&state,&mut slot);
                    }
                    return;
                },
                Err(std::sync::TryLockError::WouldBlock)=>{
                    // Keep checking until the active native action releases
                    // the Mutex. The process is already killed/invalidated.
                },
                Err(std::sync::TryLockError::Poisoned(_))=>return,
            }
        }
    }).map(|_|()).map_err(|_|"Cannot start mandatory Blender lifetime/RAM watchdog.".to_string())
}

pub(crate) fn start(
    registry:&SessionRegistry,state:&ActionState,app:&AppHandle,
    python_exe:&str,blender_exe:&str,
    blend_file:Option<&str>,output_dir:&str,allow_render:bool,script:&Path
)->Result<Value,String>{
    if !script.is_file(){return Err("Bundled persistent Blender session broker is missing.".into());}
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    if slot.is_some(){
        return Err("Blender session already exists; explicit close/recovery required before a new start.".into());
    }
    let mut command=Command::new(python_exe);
    command.arg("-B").arg(script).arg("--blender-exe").arg(blender_exe)
        .arg("--output-dir").arg(output_dir)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(source)=blend_file{command.arg("--blend-file").arg(source);}
    if allow_render{command.arg("--allow-render");}
    #[cfg(target_os="windows")]
    {
        use std::os::windows::process::CommandExt;
        // Prevent a console window from flashing for the owned Python worker.
        command.creation_flags(0x08000000);
    }
    let mut child=command.spawn().map_err(|_|"Could not launch the fixed Blender session broker.".to_string())?;
    let pid=child.id();
    #[cfg(target_os="windows")]
    let job=match windows_job::OwnedJob::attach(&child){
        Ok(job)=>job,
        Err(error)=>{
            let _=child.kill();let _=child.wait();
            return Err(error);
        },
    };
    if let Err(error)=register_managed_process(state,pid) {
        let _=child.kill(); let _=child.wait();
        return Err(format!("Blender broker could not be bound to process identity: {error}"));
    }
    let mut input=match child.stdin.take(){Some(v)=>v,None=>{
        let _=terminate_managed_process_tree(pid);let _=child.kill();let _=child.wait();
        unregister_managed_process(state,pid);
        return Err("Blender broker lacks a private command channel.".into());
    }};
    let output=match child.stdout.take(){Some(v)=>v,None=>{
        let _=terminate_managed_process_tree(pid);let _=child.kill();let _=child.wait();
        unregister_managed_process(state,pid);
        return Err("Blender broker lacks a bounded response channel.".into());
    }};
    // This exact frame unblocks the Python broker only AFTER the owned PID
    // is registered and (on Windows) bound to the kill-on-close job.
    // No Blender grandchild can be started before this point.
    if input.write_all(b"{\"version\":1,\"op\":\"arm\"}\n")
        .and_then(|_|input.flush()).is_err(){
        let _=terminate_registered_process_tree(state,pid);
        let _=child.kill();let _=child.wait();
        unregister_managed_process(state,pid);
        return Err("Cannot safely arm the owned Blender broker; no session launched.".into());
    }
    let watchdog_stop=Arc::new(AtomicBool::new(false));
    let invalidated=Arc::new(AtomicBool::new(false));
    let mut session=OwnedSession{child,input,replies:reader(output),session_id:String::new(),
        output_dir:output_dir.into(),allow_render,created:Instant::now(),watchdog_stop,
        invalidated,
        #[cfg(target_os="windows")]
        _windows_job:job,
    };
    let result=receive(&mut session,state,STARTUP_DEADLINE);
    match result {
        Ok(value)=>{
            let id=value.get("session_id").and_then(Value::as_str).unwrap_or_default();
            if value.get("status").and_then(Value::as_str)!=Some("ready")
                ||value.get("authenticated").and_then(Value::as_bool)!=Some(true)
                ||value.get("mutations_by_approval_only").and_then(Value::as_bool)!=Some(true)
                ||value.get("render_approved").and_then(Value::as_bool)!=Some(allow_render)
                ||uuid::Uuid::parse_str(id).is_err() {
                drop(session);unregister_managed_process(state,pid);
                return Err("Blender session startup lacked authenticated readiness proof.".into());
            }
            session.session_id=id.into();
            let start_time=session.created;
            let watchdog=session.watchdog_stop.clone();
            let invalidated=session.invalidated.clone();
            *slot=Some(session);
            if let Err(error)=spawn_watchdog(app,id,pid,start_time,watchdog,invalidated) {
                retire(state,&mut slot);
                return Err(error);
            }
            Ok(json!({"status":"ready","session_id":id,"authenticated":true,
                "process_managed":true,"session_reconnect_allowed":false,
                "render_ceiling":allow_render,"live_application_effect_unverified":true}))
        },
        Err(error)=>{drop(session);unregister_managed_process(state,pid);Err(error)}
    }
}

pub(crate) fn status(registry:&SessionRegistry,state:&ActionState,id:&str)->Result<Value,String>{
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    let result=(||{
        let session=slot.as_mut().ok_or("No Blender session is owned by this Shuvi process.")?;
        if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
        let v=request(session,state,"inspect",None,false,PROBE_DEADLINE)?;
        let revision=v.get("scene_revision").and_then(Value::as_str).unwrap_or_default();
        if v.get("status").and_then(Value::as_str)!=Some("alive")
            ||v.get("operation").and_then(Value::as_str)!=Some("inspect")
            ||revision.len()!=64 || !revision.bytes().all(|c|c.is_ascii_hexdigit())
            ||v.get("object_count").and_then(Value::as_u64).is_none(){
            return Err("Authenticated scene health proof missing.".into());
        }
        Ok(json!({"status":"alive","session_id":id,"scene_revision":v["scene_revision"],
            "object_count":v["object_count"],"real_blender_probe":true,
            "reconnect_automatically":false}))
    })();
    // A stale identity or interrupted response quarantines the owned session.
    // Wrong caller-supplied ID is not evidence the current child is unhealthy.
    if result.is_err() && slot.as_ref().is_some_and(|s|s.session_id==id) {
        retire(state,&mut slot);
    }
    result
}

pub(crate) fn plan(
    registry:&SessionRegistry,state:&ActionState,id:&str,plan:&Value,
    allow_render:bool,execution_action_id:Option<&str>
)->Result<Value,String>{
    let action_id=execution_action_id.ok_or("Persistent Blender mutation requires a canonical audited action UUID.")?;
    uuid::Uuid::parse_str(action_id)
        .map_err(|_|"Persistent Blender action lineage UUID is invalid.")?;
    if serde_json::to_vec(plan).map_err(|_|"Invalid typed Blender plan.")?.len()>65536{
        return Err("Blender plan exceeds 64 KiB.".into());
    }
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    let result=(||{
        let session=slot.as_mut().ok_or("No Blender session is owned by this Shuvi process.")?;
        if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
        if allow_render && !session.allow_render{
            return Err("Blender plan requests rendering above the approved session policy ceiling.".into());
        }
        let response=request(session,state,"run_plan",Some(plan),allow_render,PLAN_DEADLINE)?;
        if response.get("status").and_then(Value::as_str)!=Some("verified")
            || response.get("complete").and_then(Value::as_bool)!=Some(true)
            || response.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
            || response.get("render_approved").and_then(Value::as_bool)!=Some(allow_render)
            || response.get("destructive_allowed").and_then(Value::as_bool)!=Some(false) {
            return Err("Persistent Blender plan outcome is unknown; do not retry automatically.".into());
        }
        blender_plan_worker::verify_output(&response,Path::new(&session.output_dir))?;
        Ok(json!({"status":"verified","session_id":id,"full_plan_completed":true,
            "source_action_id":execution_action_id,"artifact":response["artifact"],
            "checkpoint_reopen":response["checkpoint_reopen"],"plan_steps":response["executed_steps"],
            "verified_by_native_sha256":true,"same_blender_session":true}))
    })();
    if result.is_err() && slot.as_ref().is_some_and(|s|s.session_id==id){
        retire(state,&mut slot);
    }
    result
}

pub(crate) fn close(registry:&SessionRegistry,state:&ActionState,id:&str)->Result<Value,String>{
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    let session=slot.as_mut().ok_or("No active owned Blender session.")?;
    if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
    // Even if the graceful close command is lost, the owned process tree is
    // stopped; never reuse the identity after a close attempt.
    let response=request(session,state,"close",None,false,PROBE_DEADLINE);
    let root_exited=retire(state,&mut slot);
    match response {
        Ok(v) if v.get("status").and_then(Value::as_str)==Some("closing") && root_exited=>
            Ok(json!({"status":"closed","session_id":id,"broker_root_exit_confirmed":true,
                "os_owned_job_closed":cfg!(target_os="windows"),
                "descendant_exit_individually_unverified":true,
                "no_automatic_reconnect":true})),
        _=>Err("Blender close outcome uncertain; owned launcher was retired.".into()),
    }
}
