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
    blender_input_checkpoint::{self,SourceCheckpoint},
    ActionState,register_managed_process,unregister_managed_process,
    managed_process_identity_matches,terminate_managed_process_tree,
    terminate_registered_process_tree,current_runtime_status,
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

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{process::{Command,Stdio},thread,time::{Duration,Instant}};

        #[test]
        fn kill_on_close_reaps_disposable_windows_broker() {
            // Disposable CI child only: never launches Blender, the desktop,
            // Adobe or a customer process. Proves actual Windows job behavior.
            let mut child=Command::new("cmd.exe")
                .args(["/C","ping -n 30 127.0.0.1 >NUL"])
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .spawn().expect("Windows test child could not launch");
            let job=match OwnedJob::attach(&child){
                Ok(job)=>job,
                Err(error)=>{
                    let _=child.kill();let _=child.wait();
                    panic!("Windows job containment is unavailable: {error}");
                }
            };
            assert!(child.try_wait().expect("Cannot inspect disposable child").is_none());
            drop(job);
            let deadline=Instant::now()+Duration::from_secs(5);
            let mut confirmed=false;
            while Instant::now()<deadline {
                if child.try_wait().expect("Cannot inspect owned child").is_some(){
                    confirmed=true;
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if !confirmed {let _=child.kill();}
            let _=child.wait();
            assert!(confirmed,"Windows kernel did not terminate disposable job child");
        }
    }
}

const MAX_FRAME:usize=131072;
const SESSION_MAX_AGE:Duration=Duration::from_secs(15*60);
const STARTUP_DEADLINE:Duration=Duration::from_secs(35);
const PROBE_DEADLINE:Duration=Duration::from_secs(15);
// At most two 10-second mesh.inspect operations plus page and scene probes.
const OBJECTS_DEADLINE:Duration=Duration::from_secs(50);
const PLAN_DEADLINE:Duration=Duration::from_secs(120);

#[derive(Default)]
pub(crate) struct SessionRegistry {
    current:Mutex<Option<OwnedSession>>,
    // A narrow, session-ID-bound emergency stop lane. An in-flight plan owns
    // current for up to 120 seconds; close must not wait for that lock to
    // invalidate its exact previously registered child.
    cancellable:Mutex<Option<CancellationTarget>>,
}

struct CancellationTarget {
    session_id:String,
    pid:u32,
    invalidated:Arc<AtomicBool>,
}

fn invalidate_exact_session(target:&CancellationTarget,id:&str)->Result<u32,String>{
    if target.session_id!=id{return Err("Blender session ID mismatch.".into());}
    target.invalidated.store(true,Ordering::Release);
    Ok(target.pid)
}

fn verified_response_eligible(target:&CancellationTarget,id:&str,pid:u32)->Result<(),String>{
    if target.session_id!=id || target.pid!=pid{
        return Err("Verified Blender response does not match the exact active native session owner.".into());
    }
    if target.invalidated.load(Ordering::Acquire){
        return Err("Blender session was canceled during native proof verification; outcome unknown, never replay.".into());
    }
    Ok(())
}

struct OwnedSession {
    child:Child,
    input:ChildStdin,
    replies:Receiver<Vec<u8>>,
    session_id:String,
    output_dir:String,
    allow_render:bool,
    source_checkpoint:Option<SourceCheckpoint>,
    // Private native-only sequencing state. Never sourced from model JSON.
    verified_first_stage_sha256:Option<String>,
    verified_first_stage_fingerprint:Option<String>,
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
        // Check before a buffered reply: an owner-canceled mutation must never
        // be promoted to success, even when its broker reply arrives in a race.
        if session.invalidated.load(Ordering::Acquire){
            return Err("Blender session stopped/invalidated during an in-flight command; outcome unknown, never replay.".into());
        }
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

fn request(session:&mut OwnedSession,state:&ActionState,op:&str,plan:Option<&Value>,allow_render:bool,expected_revision:Option<&str>,deadline:Duration)->Result<Value,String>{
    if session.invalidated.load(Ordering::Acquire){
        return Err("Blender session was stopped or invalidated; no automatic replay.".into());
    }
    if session.created.elapsed()>SESSION_MAX_AGE{
        return Err("Blender session expired; inspect and start a fresh explicitly approved session.".into());
    }
    let mut command=json!({"version":1,"session_id":session.session_id,"op":op});
    if let Some(value)=plan{
        if op=="run_plan"{
            command["plan"]=value.clone();
            command["allow_render"]=json!(allow_render);
            command["expected_scene_revision"]=json!(expected_revision.ok_or("Fresh Blender scene revision required before native mutation.")?);
        }else if op=="objects"{
            command["query"]=value.clone();
            command["expected_scene_revision"]=json!(expected_revision.ok_or("Fresh scene revision required for read-only object discovery.")?);
        }else{
            return Err("Blender broker operation does not accept model-supplied payload.".into());
        }
    }
    let mut encoded=serde_json::to_vec(&command).map_err(|_|"Cannot encode bounded Blender command.")?;
    if encoded.len()>65536{return Err("Blender session plan exceeds 64 KiB.".into());}
    encoded.push(b'\n');
    session.input.write_all(&encoded)
        .and_then(|_|session.input.flush())
        .map_err(|_|"Blender session command delivery uncertain; no replay allowed.".to_string())?;
    let answer=receive(session,state,deadline)?;
    if session.invalidated.load(Ordering::Acquire){
        return Err("Blender session stopped/invalidated while command was running; outcome unknown, never replay.".into());
    }
    if answer.get("session_id").and_then(Value::as_str)!=Some(session.session_id.as_str()){
        return Err("Blender broker returned a different session identity.".into());
    }
    Ok(answer)
}

fn retire(registry:&SessionRegistry,state:&ActionState,slot:&mut Option<OwnedSession>)->bool {
    if let Some(session)=slot.take(){
        let pid=session.child.id();
        let id=session.session_id.clone();
        drop(session);
        // Clear only the matching session latch. Never overwrite a newer
        // session's cancellation authority or leak a stale PID capability.
        if let Ok(mut cancel)=registry.cancellable.lock(){
            if cancel.as_ref().is_some_and(|target|target.session_id==id&&target.pid==pid){
                *cancel=None;
            }
        }
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
                        retire(&state.blender_session,&state,&mut slot);
                    }
                    return;
                },
                Err(std::sync::TryLockError::WouldBlock)=>{
                    // Keep checking until the active native action releases
                    // the Mutex. The process is already killed/invalidated.
                },
                Err(std::sync::TryLockError::Poisoned(_))=>return,
            };
        }
    }).map(|_|()).map_err(|_|"Cannot start mandatory Blender lifetime/RAM watchdog.".to_string())
}

pub(crate) fn start(
    registry:&SessionRegistry,state:&ActionState,app:&AppHandle,
    python_exe:&str,blender_exe:&str,
    blend_file:Option<&str>,expected_blend_sha256:Option<&str>,
    output_dir:&str,allow_render:bool,script:&Path
)->Result<Value,String>{
    if !script.is_file(){return Err("Bundled persistent Blender session broker is missing.".into());}
    // Fail closed before launch: a model-supplied filename alone is never
    // sufficient to authorize loading a previous checkpoint.
    let source_checkpoint=blender_input_checkpoint::inspect(blend_file,expected_blend_sha256)?;
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    if slot.is_some(){
        return Err("Blender session already exists; explicit close/recovery required before a new start.".into());
    }
    let mut command=Command::new(python_exe);
    command.arg("-B").arg(script).arg("--blender-exe").arg(blender_exe)
        .arg("--output-dir").arg(output_dir)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(ref source)=source_checkpoint{
        command.arg("--blend-file").arg(&source.canonical_path)
            .arg("--expected-blend-sha256").arg(&source.sha256);
    }
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
        output_dir:output_dir.into(),allow_render,
        source_checkpoint:source_checkpoint.clone(),
        verified_first_stage_sha256:None,
        verified_first_stage_fingerprint:None,
        created:Instant::now(),watchdog_stop,
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
                ||uuid::Uuid::parse_str(id).is_err()
                ||value.get("input_checkpoint")!=Some(&source_checkpoint.as_ref()
                    .map(|checkpoint|checkpoint.json()).unwrap_or(Value::Null)) {
                drop(session);unregister_managed_process(state,pid);
                return Err("Blender session startup lacked authenticated readiness proof.".into());
            }
            if let Some(ref src)=source_checkpoint{
                if let Err(error)=blender_input_checkpoint::still_current(src){
                    drop(session);unregister_managed_process(state,pid);
                    return Err(format!("Blender checkpoint changed during session launch: {error}"));
                }
            }
            session.session_id=id.into();
            let start_time=session.created;
            let watchdog=session.watchdog_stop.clone();
            let invalidated=session.invalidated.clone();
            *slot=Some(session);
            // Publish cancellation authority only for the authenticated ready
            // session and its registered process identity.
            let install=registry.cancellable.lock()
                .map_err(|_|"Blender cancellation ownership lock poisoned.".to_string())
                .and_then(|mut active|{
                    if active.is_some(){return Err("An earlier Blender cancellation target was not retired.".into());}
                    *active=Some(CancellationTarget{session_id:id.into(),pid,invalidated:invalidated.clone()});
                    Ok(())
                });
            if let Err(error)=install{
                retire(registry,state,&mut slot);
                return Err(error);
            }
            if let Err(error)=spawn_watchdog(app,id,pid,start_time,watchdog,invalidated) {
                retire(registry,state,&mut slot);
                return Err(error);
            }
            Ok(json!({"status":"ready","session_id":id,"authenticated":true,
                "process_managed":true,"session_reconnect_allowed":false,
                "render_ceiling":allow_render,
                "input_checkpoint":source_checkpoint.as_ref().map(|s|s.json()),
                "live_application_effect_unverified":true}))
        },
        Err(error)=>{drop(session);unregister_managed_process(state,pid);Err(error)}
    }
}

pub(crate) fn status(registry:&SessionRegistry,state:&ActionState,id:&str)->Result<Value,String>{
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    let result=(||{
        let session=slot.as_mut().ok_or("No Blender session is owned by this Shuvi process.")?;
        if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
        let v=request(session,state,"inspect",None,false,None,PROBE_DEADLINE)?;
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
        retire(registry,state,&mut slot);
    }
    result
}

/// Independent native SHA-256 across binary64 coordinates / unsigned face
/// indices. Unlike cross-language JSON formatting this is byte-identical
/// across Python and Rust; the broker's own JSON geometry digest is separate.
fn native_binary_mesh_sha(vertices:&[Value],faces:&[Value])->Result<String,String>{
    use sha2::{Digest,Sha256};
    let mut hasher=Sha256::new();
    hasher.update(b"SHUVI41-MESH-NATIVE-V1");
    hasher.update([0u8]);
    hasher.update((vertices.len() as u32).to_be_bytes());
    for vertex in vertices {
        let xyz=vertex.as_array().ok_or("Native mesh commitment vertex malformed.")?;
        if xyz.len()!=3{return Err("Native mesh commitment vertex length invalid.".into());}
        for coord in xyz{
            let number=coord.as_f64().ok_or("Native mesh commitment coordinate invalid.")?;
            if !number.is_finite(){return Err("Native mesh commitment coordinate non-finite.".into());}
            hasher.update(number.to_be_bytes());
        }
    }
    hasher.update((faces.len() as u32).to_be_bytes());
    for face in faces{
        let indices=face.as_array().ok_or("Native mesh commitment face malformed.")?;
        hasher.update((indices.len() as u32).to_be_bytes());
        for index in indices{
            let value=index.as_u64().ok_or("Native mesh commitment index malformed.")?;
            let value=u32::try_from(value).map_err(|_|"Native mesh index too large.")?;
            hasher.update(value.to_be_bytes());
        }
    }
    Ok(format!("{:x}",hasher.finalize()))
}

/// Bind count-only large-mesh results to the authenticated object-page
/// metadata. Counts are observed, not a substitute for topology/geometry SHA.
fn verify_mesh_counts(item:&Value,kind:&str)->Result<(),String>{
    let flag=item.get("mesh_counts_available").and_then(Value::as_bool);
    let counts=item.get("mesh_counts").filter(|v|!v.is_null());
    let skipped=item.get("mesh_inspection_skipped").filter(|v|!v.is_null());
    if flag.is_none(){
        if counts.is_some()||skipped.is_some(){return Err("Unflagged mesh metadata claim.".into());}
        return Ok(()); // Existing pre-metadata snapshots.
    }
    if flag==Some(false){
        if counts.is_some(){return Err("Unavailable mesh metadata has claims.".into());}
        if skipped.and_then(Value::as_str)==Some("page_work_budget")
            &&item.get("mesh_topology_inspected").and_then(Value::as_bool)==Some(false)
            &&item.get("geometry_available").and_then(Value::as_bool)==Some(false)
            &&item.get("geometry_truncated").and_then(Value::as_bool)==Some(true)
            &&item.get("mesh_overview_available").and_then(Value::as_bool)==Some(false)
            &&item.get("mesh_geometry_summary").is_some_and(Value::is_null)
            &&item.get("mesh_overview").is_some_and(Value::is_null){
            return Ok(());
        }
        if skipped.is_some(){return Err("Unavailable mesh metadata has unsupported skipped reason.".into());}
        return Ok(());
    }
    if kind!="MESH"{return Err("Non-mesh claims mesh counts.".into());}
    let record=counts.filter(|v|v.is_object())
        .ok_or("Authenticated mesh count record missing.")?;
    let vertices=record.get("vertex_count").and_then(Value::as_u64)
        .ok_or("Mesh vertex count missing.")?;
    let faces=record.get("face_count").and_then(Value::as_u64)
        .ok_or("Mesh face count missing.")?;
    let edges=record.get("edge_count").and_then(Value::as_u64)
        .ok_or("Mesh edge count missing.")?;
    if vertices>100_000_000||faces>100_000_000||edges>100_000_000
        ||record.get("source").and_then(Value::as_str)!=Some("authenticated_objects_list")
        ||record.get("topology_verified_by_counts").and_then(Value::as_bool)!=Some(false){
        return Err("Mesh count-only provenance or bounds invalid.".into());
    }
    if item.get("mesh_inspection_skipped").is_some_and(|v|!v.is_null()&&!v.is_string()){
        return Err("Mesh skip reason is malformed.".into());
    }
    let reason=if vertices>4096||faces>4096{Some("upstream_geometry_limit")}
        else if vertices<3||faces<1{Some("empty_or_degenerate_mesh")}
        else if skipped.and_then(Value::as_str)==Some("page_work_budget"){Some("page_work_budget")}
        else{None};
    if reason!=skipped.and_then(Value::as_str){
        return Err("Mesh inspect skip reason is not justified by observed counts.".into());
    }
    if reason.is_some(){
        if item.get("mesh_topology_inspected").and_then(Value::as_bool)!=Some(false)
            ||item.get("geometry_available").and_then(Value::as_bool)!=Some(false)
            ||item.get("geometry_truncated").and_then(Value::as_bool)!=Some(true)
            ||item.get("mesh_overview_available").and_then(Value::as_bool)!=Some(false)
            ||item.get("mesh_overview").is_some_and(|v|!v.is_null())
            ||item.get("mesh_geometry_summary").is_some_and(|v|!v.is_null()){
            return Err("Skipped large mesh cannot claim verified full topology.".into());
        }
        return Ok(());
    }
    if item.get("geometry_available").and_then(Value::as_bool)==Some(true){
        let full=item.get("mesh_geometry_summary")
            .ok_or("Small mesh geometry absent.")?;
        if full.get("vertex_count").and_then(Value::as_u64)!=Some(vertices)
            ||full.get("face_count").and_then(Value::as_u64)!=Some(faces){
            return Err("Mesh metadata differs from full topology.".into());
        }
    }else if item.get("mesh_overview_available").and_then(Value::as_bool)==Some(true){
        let overview=item.get("mesh_overview")
            .ok_or("Medium mesh overview absent.")?;
        if overview.get("vertex_count").and_then(Value::as_u64)!=Some(vertices)
            ||overview.get("face_count").and_then(Value::as_u64)!=Some(faces){
            return Err("Mesh metadata differs from validated overview.".into());
        }
    }else{
        return Err("In-range mesh metadata must be matched with actual mesh.inspect evidence.".into());
    }
    Ok(())
}

/// Verify a compact 129..1024-element mesh summary without pretending that
/// its coordinates or faces were transmitted or SHA-recomputed by Rust.
fn verify_medium_mesh_overview(item:&Value)->Result<bool,String>{
    let present=item.get("mesh_overview_available").and_then(Value::as_bool)
        .unwrap_or(false);
    let overview=item.get("mesh_overview").filter(|v|!v.is_null());
    if !present{
        if overview.is_some(){return Err("Unclaimed mesh overview carries data.".into());}
        return Ok(false);
    }
    let proof=overview.filter(|v|v.is_object())
        .ok_or("Mesh overview attestation is missing.")?;
    let vertices=proof.get("vertex_count").and_then(Value::as_u64).unwrap_or(0);
    let faces=proof.get("face_count").and_then(Value::as_u64).unwrap_or(0);
    let loops=proof.get("face_index_count").and_then(Value::as_u64).unwrap_or(0);
    if !(3..=4096).contains(&vertices)
        || !(1..=4096).contains(&faces)
        || loops<3*faces ||loops>32768 ||loops>32*faces
        ||(vertices<=128 && faces<=128 && loops<=512) {
        return Err("Medium mesh overview counts exceed allowed range.".into());
    }
    let finite3=|key:&str|proof.get(key).and_then(Value::as_array).is_some_and(|v|{
        v.len()==3 &&v.iter().all(|n|n.as_f64().is_some_and(|x|x.is_finite()&&x.abs()<=1_000_000.0))
    });
    if !finite3("bounds_min")||!finite3("bounds_max"){
        return Err("Medium mesh bounding box is malformed.".into());
    }
    let mins=proof["bounds_min"].as_array().ok_or("No mesh minimum bounds.")?;
    let maxs=proof["bounds_max"].as_array().ok_or("No mesh maximum bounds.")?;
    if (0..3).any(|i|mins[i].as_f64().unwrap_or(f64::INFINITY)>
                           maxs[i].as_f64().unwrap_or(f64::NEG_INFINITY)){
        return Err("Medium mesh bounding box has reversed limits.".into());
    }
    let hash=proof.get("geometry_sha256").and_then(Value::as_str).unwrap_or("");
    if hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())
        ||proof.get("digest_checked_in_authenticated_broker").and_then(Value::as_bool)!=Some(true)
        ||proof.get("native_digest_recomputed").and_then(Value::as_bool)!=Some(false)
        ||proof.get("complete_source_validated_in_broker").and_then(Value::as_bool)!=Some(true)
        ||proof.get("full_vertex_face_arrays_transferred").and_then(Value::as_bool)!=Some(false)
        ||proof.get("vertices").is_some()||proof.get("faces").is_some(){
        return Err("Medium mesh overview digest/transmission claims invalid.".into());
    }
    Ok(true)
}

/// Validate complete small-mesh topology independently of the owned broker.
/// The broker verifies the source SHA over actual vertices/faces. Rust checks
/// geometry structure but deliberately does not claim to re-hash float JSON.
fn verify_read_only_topology(item:&Value,kind:&str)->Result<(),String>{
    let touched=item.get("mesh_counts_available").is_some()
        ||item.get("mesh_counts").is_some()
        ||item.get("mesh_inspection_skipped").is_some()
        ||item.get("geometry_available").is_some()
        ||item.get("geometry_truncated").is_some()
        ||item.get("mesh_geometry_summary").is_some()
        ||item.get("mesh_overview_available").is_some()
        ||item.get("mesh_overview").is_some();
    let topology=item.get("mesh_topology_inspected").and_then(Value::as_bool)
        .ok_or("Mesh topology status missing.")?;
    if !touched {
        if topology{return Err("Unbacked Blender topology attestation.".into());}
        return Ok(()); // Legacy minimal object detail page.
    }
    if kind!="MESH"{return Err("Only mesh objects may carry geometry evidence.".into());}
    verify_mesh_counts(item,kind)?;
    let available=item.get("geometry_available").and_then(Value::as_bool)
        .ok_or("Mesh geometry availability missing.")?;
    let truncated=item.get("geometry_truncated").and_then(Value::as_bool)
        .ok_or("Mesh truncation status missing.")?;
    if !available{
        if !truncated||topology||item.get("mesh_geometry_summary").is_some_and(|v|!v.is_null()){
            return Err("Incomplete mesh cannot claim full topology content.".into());
        }
        // Independently inspect the bounded compact summary, if present.
        verify_medium_mesh_overview(item)?;
        return Ok(());
    }
    if truncated||!topology{return Err("Available mesh has incomplete topology proof.".into());}
    if verify_medium_mesh_overview(item)?{
        return Err("Full mesh geometry cannot simultaneously claim compact-only overview.".into());
    }
    let proof=item.get("mesh_geometry_summary").filter(|x|x.is_object())
        .ok_or("Mesh geometry proof missing.")?;
    let vertices=proof.get("vertices").and_then(Value::as_array)
        .filter(|v|(3..=128).contains(&v.len())).ok_or("Mesh vertices out of bounds.")?;
    let faces=proof.get("faces").and_then(Value::as_array)
        .filter(|v|(1..=128).contains(&v.len())).ok_or("Mesh faces out of bounds.")?;
    if proof.get("vertex_count").and_then(Value::as_u64)!=Some(vertices.len() as u64)
        ||proof.get("face_count").and_then(Value::as_u64)!=Some(faces.len() as u64){
        return Err("Mesh geometry counts disagree with elements.".into());
    }
    if vertices.iter().any(|v|v.as_array().is_none_or(|a|{
        a.len()!=3||a.iter().any(|n|n.as_f64().is_none_or(|x|!x.is_finite()||x.abs()>1_000_000.0))
    })){return Err("Mesh has invalid coordinates.".into());}
    let mut loops=0usize;
    for face in faces{
        let ids=face.as_array().filter(|a|(3..=32).contains(&a.len()))
            .ok_or("Mesh polygon has invalid size.")?;
        loops+=ids.len();
        if loops>512{return Err("Mesh polygon budget exceeded.".into());}
        let mut seen=std::collections::HashSet::new();
        for vertex in ids{
            let index=vertex.as_u64().ok_or("Mesh face index malformed.")?;
            if index>=vertices.len() as u64||!seen.insert(index){
                return Err("Mesh face contains invalid/repeated vertex.".into());
            }
        }
    }
    let digest=proof.get("geometry_sha256").and_then(Value::as_str).unwrap_or("");
    if digest.len()!=64||!digest.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())
        ||proof.get("digest_checked_in_authenticated_broker").and_then(Value::as_bool)!=Some(true)
        ||proof.get("native_digest_recomputed").and_then(Value::as_bool)!=Some(false){
        return Err("Mesh digest claims are invalid or overstated.".into());
    }
    let native_expected=proof.get("native_binary_commitment_sha256").and_then(Value::as_str)
        .ok_or("Independent binary mesh commitment is missing.")?;
    if native_expected.len()!=64
        ||!native_expected.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())
        ||proof.get("native_binary_commitment_recomputed").and_then(Value::as_bool)!=Some(false)
        ||native_binary_mesh_sha(vertices,faces)?!=native_expected {
        return Err("Blender mesh binary commitment differs from native recomputation.".into());
    }
    Ok(())
}

/// Check every live read-only detail projection again in native Rust.
/// No mutation, file reopen, shader-node or actual geometry claim is created.
fn verified_object_views(items:&[Value],session_id:&str)->Result<(),String>{
    for item in items {
        let identity=item.get("object_id").and_then(Value::as_str).unwrap_or("");
        let revision=item.get("revision").and_then(Value::as_str).unwrap_or("");
        if !identity.starts_with(&format!("{session_id}:"))
            || revision.len()!=64 ||!revision.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()) {
            return Err("Blender object detail identity/revision invalid.".into());
        }
        let kind=item.get("type").and_then(Value::as_str).unwrap_or("");
        let present=item.get("details_available").and_then(Value::as_bool)
            .ok_or("Blender object detail availability is missing.")?;
        let truncated=item.get("details_truncated").and_then(Value::as_bool)
            .ok_or("Blender object truncation flag missing.")?;
        if !present {
            if item.get("details").is_some_and(|v|!v.is_null())
                ||item.get("shader_nodes_inspected").and_then(Value::as_bool)==Some(true)
                ||item.get("mesh_topology_inspected").and_then(Value::as_bool)==Some(true)
                ||item.get("geometry_available").and_then(Value::as_bool)==Some(true)
                ||item.get("mesh_geometry_summary").is_some_and(|v|!v.is_null())
                ||item.get("mesh_overview_available").and_then(Value::as_bool)==Some(true)
                ||item.get("mesh_overview").is_some_and(|v|!v.is_null())
                ||item.get("mesh_counts_available").and_then(Value::as_bool)==Some(true)
                ||item.get("mesh_counts").is_some_and(|v|!v.is_null())
                ||item.get("mesh_inspection_skipped").is_some_and(|v|!v.is_null()){
                return Err("Unavailable Blender details cannot claim validation.".into());
            }
            continue;
        }
        if truncated ||item.get("shader_nodes_inspected").and_then(Value::as_bool)!=Some(false){
            return Err("Blender detail projection cannot claim shader node inspection.".into());
        }
        verify_read_only_topology(item,kind)?;
        let detail=item.get("details").filter(|v|v.is_object())
            .ok_or("Blender detail projection object missing.")?;
        let finite3=|value:Option<&Value>|value.and_then(Value::as_array).is_some_and(|a|{
            a.len()==3 && a.iter().all(|x|x.as_f64().is_some_and(|n|n.is_finite()&&n.abs()<=1_000_000.0))
        });
        if !["location","rotation_euler","scale","dimensions"].iter()
            .all(|field|finite3(detail.get(*field)))
            ||detail.get("hide_render").and_then(Value::as_bool).is_none()
            ||detail.get("hide_viewport").and_then(Value::as_bool).is_none(){
            return Err("Blender detail transform/visibility invalid.".into());
        }
        let materials=detail.get("materials").and_then(Value::as_array)
            .ok_or("Blender detail material list missing.")?;
        let modifiers=detail.get("modifiers").and_then(Value::as_array)
            .ok_or("Blender detail modifier list missing.")?;
        let valid_name=|s:&str|!s.is_empty()&&s.len()<=128&&!s.chars().any(|c|c.is_control());
        if materials.len()>16 ||modifiers.len()>16
            ||detail.get("material_slot_count").and_then(Value::as_u64)!=Some(materials.len() as u64)
            ||detail.get("modifier_count").and_then(Value::as_u64)!=Some(modifiers.len() as u64)
            ||materials.iter().any(|m|!m.is_null()&&m.as_str().is_none_or(|x|!valid_name(x)))
            ||modifiers.iter().any(|m|{
                m.get("name").and_then(Value::as_str).is_none_or(|v|!valid_name(v))
                ||m.get("type").and_then(Value::as_str).is_none_or(|v|!valid_name(v))
                ||m.get("show_render").and_then(Value::as_bool).is_none()
            }){
            return Err("Blender detail material/modifier list invalid.".into());
        }
        let scalar=|data:&Value,key:&str,low:f64,high:f64|data.get(key)
            .and_then(Value::as_f64).is_some_and(|v|v.is_finite()&&v>=low&&v<=high);
        if kind=="CAMERA" {
            let c=detail.get("camera").filter(|v|v.is_object())
                .ok_or("Blender camera optics missing.")?;
            if !matches!(c.get("type").and_then(Value::as_str),Some("PERSP"|"ORTHO"|"PANO"))
                ||!["lens","clip_start","clip_end"].iter().all(|key|scalar(c,key,0.000001,100_000.0)){
                return Err("Blender camera optics invalid.".into());
            }
        }else if detail.get("camera").is_some(){return Err("Unexpected camera optics.".into());}
        if kind=="LIGHT"{
            let l=detail.get("light").filter(|v|v.is_object())
                .ok_or("Blender light properties missing.")?;
            if !matches!(l.get("type").and_then(Value::as_str),Some("POINT"|"SUN"|"SPOT"|"AREA"))
                ||!scalar(l,"energy",0.0,1_000_000.0)
                ||!finite3(l.get("color")){
                return Err("Blender light properties invalid.".into());
            }
        }else if detail.get("light").is_some(){return Err("Unexpected light settings.".into());}
    }
    Ok(())
}

/// Native validation of the upstream page's exact offset/count/cursor,
/// requested filters and unique session-owned object IDs. This runs after
/// the broker's own validation and before returning data for new AI plans.
fn verified_object_page_contract(
    response:&Value,session_id:&str,offset:u64,limit:u64,
    name_prefix:&str,object_type:Option<&str>
)->Result<(),String>{
    let rows=response.get("objects").and_then(Value::as_array)
        .ok_or("Blender page rows missing.")?;
    let total=response.get("total").and_then(Value::as_u64)
        .ok_or("Blender total count missing.")?;
    let next=response.get("next_offset")
        .ok_or("Blender page continuation is missing.")?;
    let next=if next.is_null(){None}else{
        Some(next.as_u64().ok_or("Blender page continuation invalid.")?)
    };
    let expected_count=limit.min(total.saturating_sub(offset));
    let expected_next=if offset+limit<total{Some(offset+limit)}else{None};
    if rows.len() as u64!=expected_count||next!=expected_next{
        return Err("Blender object page length/cursor contradicts requested window.".into());
    }
    let mut seen=std::collections::HashSet::new();
    for row in rows{
        let id=row.get("object_id").and_then(Value::as_str)
            .ok_or("Object page has no object identity.")?;
        let name=row.get("name").and_then(Value::as_str)
            .ok_or("Object page has no object name.")?;
        let kind=row.get("type").and_then(Value::as_str)
            .ok_or("Object page has no object type.")?;
        let rev=row.get("revision").and_then(Value::as_str)
            .ok_or("Object page has no object revision.")?;
        if !id.starts_with(&format!("{session_id}:"))
            ||!seen.insert(id)
            ||name.is_empty()||name.len()>256
            ||!name.starts_with(name_prefix)
            ||kind.is_empty()||kind.len()>32
            ||object_type.is_some_and(|expected|kind!=expected)
            ||rev.len()!=64
            ||!rev.bytes().all(|v|v.is_ascii_hexdigit()&&!v.is_ascii_uppercase()){
            return Err("Blender object page has stale, duplicate or unfiltered identity.".into());
        }
    }
    Ok(())
}

pub(crate) fn objects(
    registry:&SessionRegistry,state:&ActionState,id:&str,
    scene_revision:&str,offset:u64,limit:u64,name_prefix:&str,object_type:Option<&str>
)->Result<Value,String>{
    if scene_revision.len()!=64
        || !scene_revision.bytes().all(|c|c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        || offset>1000 || !(1..=5).contains(&limit)
        || name_prefix.len()>80 || name_prefix.contains('\0')
        || object_type.is_some_and(|v|v.is_empty()||v.len()>32){
        return Err("Read-only Blender object query exceeds native bounds.".into());
    }
    let query=json!({"offset":offset,"limit":limit,
        "name_prefix":name_prefix,"object_type":object_type});
    let mut slot=registry.current.lock().map_err(|_|"Blender session lock poisoned.".to_string())?;
    let result=(||{
        let session=slot.as_mut().ok_or("No Blender session is owned by Shuvi.")?;
        if session.session_id!=id{return Err("Blender object lookup session ID mismatch.".into());}
        let response=request(session,state,"objects",Some(&query),false,
            Some(scene_revision),OBJECTS_DEADLINE)?;
        if response.get("status").and_then(Value::as_str)!=Some("alive")
            ||response.get("operation").and_then(Value::as_str)!=Some("objects")
            ||response.get("read_only").and_then(Value::as_bool)!=Some(true)
            ||response.get("scene_revision").and_then(Value::as_str)!=Some(scene_revision)
            ||response.get("offset").and_then(Value::as_u64)!=Some(offset)
            ||response.get("objects").and_then(Value::as_array)
                .is_none_or(|items|items.len()>limit as usize)
            ||response.get("total").and_then(Value::as_u64).is_none_or(|n|n>10000){
            return Err("Authenticated Blender object page evidence was incomplete.".into());
        }
        verified_object_page_contract(
            &response,id,offset,limit,name_prefix,object_type)?;
        verified_object_views(response["objects"].as_array()
            .ok_or("Blender object page missing.")?,id)?;
        // This flag is native-owned and assigned only after the independent
        // binary digest check above, never copied from the broker.
        let mut verified_rows=response["objects"].as_array()
            .ok_or("Blender object page missing.")?.clone();
        for row in verified_rows.iter_mut(){
            if row.get("mesh_topology_inspected").and_then(Value::as_bool)==Some(true){
                row["mesh_geometry_summary"]["native_binary_commitment_recomputed"]=Value::Bool(true);
            }
        }
        Ok(json!({"status":"read_only_object_page","session_id":id,
            "scene_revision":scene_revision,"offset":offset,
            "total":response["total"],"next_offset":response["next_offset"],
            "objects":verified_rows,"read_only":true,
            "requires_new_action_approval_for_mutation":true}))
    })();
    if result.is_err() && slot.as_ref().is_some_and(|s|s.session_id==id){
        retire(registry,state,&mut slot);
    }
    result
}

fn stage_two_dependency(stage:Option<&str>,sha256:Option<&str>,fingerprint:Option<&str>)
    ->Result<(),String>{
    if stage==Some("model2")&&(sha256.is_none()||fingerprint.is_none()){
        return Err("Fixed Stage 2 requires a previously native-verified Stage 1 in this exact owned Blender session.".into());
    }
    Ok(())
}

pub(crate) fn plan(
    registry:&SessionRegistry,state:&ActionState,id:&str,plan:&Value,
    allow_render:bool,expected_scene_revision:&str,execution_action_id:Option<&str>
)->Result<Value,String>{
    if expected_scene_revision.len()!=64
        || !expected_scene_revision.bytes().all(|c|c.is_ascii_hexdigit() && !c.is_ascii_uppercase()){
        return Err("Persistent Blender plan requires a 64-character lowercase inspected scene revision.".into());
    }
    let action_id=execution_action_id.ok_or("Persistent Blender mutation requires a canonical audited action UUID.")?;
    uuid::Uuid::parse_str(action_id)
        .map_err(|_|"Persistent Blender action lineage UUID is invalid.")?;
    if serde_json::to_vec(plan).map_err(|_|"Invalid typed Blender plan.")?.len()>65536{
        return Err("Blender plan exceeds 64 KiB.".into());
    }
    let plan_lineage=crate::blender_plan_lineage::derive(plan)?;
    let mut slot=registry.current.lock().map_err(|_|"Blender session ownership lock poisoned.".to_string())?;
    let result=(||{
        let session=slot.as_mut().ok_or("No Blender session is owned by this Shuvi process.")?;
        if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
        if allow_render && !session.allow_render{
            return Err("Blender plan requests rendering above the approved session policy ceiling.".into());
        }
        // Strict reserved-role and source-kind policy BEFORE broker command.
        // The persistent Python broker additionally re-observes live material,
        // active camera and lighting when the optional material PNG is requested.
        crate::blender_plan_lineage::reserved_output_policy(
            plan,&plan_lineage,
            session.source_checkpoint.as_ref().map(|x|x.canonical_path.as_str()),
            allow_render,true
        )?;
        let stage=plan_lineage.get("acceptance_stage").and_then(Value::as_str);
        stage_two_dependency(stage,session.verified_first_stage_sha256.as_deref(),
            session.verified_first_stage_fingerprint.as_deref())?;
        // Any other approved mutating plan between stages consumes the
        // continuation. An unverified/failed run retires this session.
        if stage!=Some("model2"){
            session.verified_first_stage_sha256=None;
            session.verified_first_stage_fingerprint=None;
        }
        if let Some(ref input)=session.source_checkpoint {
            blender_input_checkpoint::still_current(input)?;
        }
        let response=request(session,state,"run_plan",Some(plan),allow_render,Some(expected_scene_revision),PLAN_DEADLINE)?;
        if let Some(ref input)=session.source_checkpoint {
            blender_input_checkpoint::still_current(input)?;
        }
        if response.get("status").and_then(Value::as_str)!=Some("verified")
            || response.get("complete").and_then(Value::as_bool)!=Some(true)
            || response.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
            || response.get("render_approved").and_then(Value::as_bool)!=Some(allow_render)
            || response.get("destructive_allowed").and_then(Value::as_bool)!=Some(false) {
            return Err("Persistent Blender plan outcome is unknown; do not retry automatically.".into());
        }
        // The owned broker may claim material preflight evidence only for
        // its exact typed material PNG. Bind it to the original native
        // session/source/scene identity, not merely the echoed proof filename.
        let stage=plan_lineage.get("acceptance_stage").and_then(Value::as_str);
        let material_claim=response.get("material_render_preflight")
            .filter(|value|!value.is_null());
        if stage==Some("look_render") {
            let proof=material_claim.ok_or("Material render lacks independent broker source preflight.")?;
            let source=session.source_checkpoint.as_ref()
                .ok_or("Material render requires an approved SHA-pinned input checkpoint.")?;
            if proof.get("verified").and_then(Value::as_bool)!=Some(true)
                ||proof.get("session_id").and_then(Value::as_str)!=Some(id)
                ||proof.get("source_scene_revision").and_then(Value::as_str)!=Some(expected_scene_revision)
                ||proof.get("source_blend_path").and_then(Value::as_str)!=Some(source.canonical_path.as_str())
                ||proof.get("source_sha256").and_then(Value::as_str)!=Some(source.sha256.as_str())
                ||proof.get("source_bytes").and_then(Value::as_u64)!=Some(source.bytes)
                ||proof.get("shader_parameters_independently_verified").and_then(Value::as_bool)!=Some(true)
                ||proof.get("shader_node_graph_revision_verified").and_then(Value::as_bool)!=Some(true)
                ||proof.get("shader_graph_revision").and_then(Value::as_str)
                    .is_none_or(|h|h.len()!=64 ||!h.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())){
                return Err("Material render preflight is not bound to this native source, action and session.".into());
            }
        }else if material_claim.is_some(){
            return Err("Unrelated Blender plan cannot return material-render preflight.".into());
        }
        if stage==Some("model2"){
            let provenance=response.get("model_stage_source_preflight")
                .filter(|v|!v.is_null())
                .ok_or("Fixed Stage 2 lacks read-only live Stage-1 geometry preflight.")?;
            if provenance.get("verified").and_then(Value::as_bool)!=Some(true)
                ||provenance.get("source_stage").and_then(Value::as_str)!=Some("model1")
                ||provenance.get("source_sha256").and_then(Value::as_str)
                    !=session.verified_first_stage_sha256.as_deref()
                ||provenance.get("source_scene_fingerprint").and_then(Value::as_str)
                    !=session.verified_first_stage_fingerprint.as_deref()
                ||provenance.get("source_scene_revision").and_then(Value::as_str)
                    !=Some(expected_scene_revision)
                ||provenance.get("fixed_stage_geometry_verified").and_then(Value::as_bool)!=Some(true)
                ||provenance.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera"){
                return Err("Fixed Stage 2 preflight is not bound to the previous in-session verified Stage 1.".into());
            }
        }else if response.get("model_stage_source_preflight").is_some_and(|v|!v.is_null()){
            return Err("Unrelated Blender plan cannot claim an in-session Stage-1 preflight.".into());
        }
        // Do not promote an authenticated response carrying the wrong output
        // filename, even if its bytes were verified inside the approved folder.
        crate::blender_plan_lineage::verify_final_artifact_binding(plan,&response)?;
        let manifest=crate::blender_artifact_manifest::build(
            &response,Path::new(&session.output_dir),action_id,Some(id))?;
        // Arm the second stage ONLY after independent native SHA, typed
        // execution and reopened-geometry evidence have all succeeded.
        if stage==Some("model1"){
            session.verified_first_stage_sha256=Some(response["artifact"]["sha256"].as_str()
                .ok_or("Stage 1 saved artifact digest missing.")?.to_owned());
            session.verified_first_stage_fingerprint=Some(
                response["checkpoint_reopen"]["fingerprint"].as_str()
                    .ok_or("Stage 1 independently reopened fingerprint missing.")?.to_owned());
        }else{
            session.verified_first_stage_sha256=None;
            session.verified_first_stage_fingerprint=None;
        }
        // Native rehash/reopen/manifest verification may outlast the broker
        // reply. Do not promote a previously received success after close.
        if session.invalidated.load(Ordering::Acquire){
            return Err("Blender session canceled before final artifact promotion; outcome unknown, never replay.".into());
        }
        Ok(json!({"status":"verified","session_id":id,"full_plan_completed":true,
            "source_action_id":execution_action_id,"artifact":response["artifact"],
            "checkpoint_reopen":response["checkpoint_reopen"],"plan_steps":response["executed_steps"],
            "verified_by_native_sha256":true,"same_blender_session":true,
            "artifact_manifest":manifest,
            "approved_plan_lineage":plan_lineage,
            "input_checkpoint":session.source_checkpoint.as_ref().map(|s|s.json())}))
    })();
    if result.is_err(){
        if slot.as_ref().is_some_and(|s|s.session_id==id){
            retire(registry,state,&mut slot);
        }
        return result;
    }
    // Final native completion barrier: close() can reach cancellable while
    // native proof rehashing holds current. Lock its lane, recheck the exact
    // UUID/PID and invalidation, then release current BEFORE releasing this
    // lane. A close concurrent with proof checking therefore wins before
    // promotion, or is ordered after completed verification.
    let completion=match registry.cancellable.lock(){
        Ok(guard)=>guard,
        Err(_)=>{
            if slot.as_ref().is_some_and(|s|s.session_id==id){
                retire(registry,state,&mut slot);
            }
            return Err("Blender completion cancellation authority was poisoned; outcome unknown.".into());
        }
    };
    let decision=slot.as_ref()
        .ok_or_else(||"Blender session disappeared before verified response promotion.".to_string())
        .and_then(|session|{
            let target=completion.as_ref()
                .ok_or_else(||"Blender verified response lacks native cancellation authority.".to_string())?;
            if session.session_id!=id {
                return Err("Blender session identity changed before verified response promotion.".into());
            }
            verified_response_eligible(target,id,session.child.id())
        });
    if let Err(error)=decision{
        drop(completion);
        if slot.as_ref().is_some_and(|s|s.session_id==id){
            retire(registry,state,&mut slot);
        }
        return Err(error);
    }
    drop(slot);
    drop(completion);
    result
}

pub(crate) fn close(registry:&SessionRegistry,state:&ActionState,id:&str)->Result<Value,String>{
    // Fast path keeps the existing graceful close. When a plan/probe holds
    // current, use an independent ID-checked stop lane FIRST: waiting for
    // current before signaling would make cancellation ineffective.
    let (mut slot,cancel_requested)=match registry.current.try_lock(){
        Ok(slot)=>(slot,false),
        Err(std::sync::TryLockError::WouldBlock)=>{
            let active=registry.cancellable.lock()
                .map_err(|_|"Blender cancellation ownership lock poisoned.".to_string())?;
            let target=active.as_ref().ok_or("No ready owned Blender session is available to cancel.")?;
            let pid=invalidate_exact_session(target,id)?;
            // This API checks native registered PID and OS process start
            // identity. It cannot terminate an arbitrary caller-supplied PID.
            // Also wake receive() even if termination itself fails: the
            // in-flight command must never be reported as verified.
            let _=terminate_registered_process_tree(state,pid);
            drop(active);
            (registry.current.lock()
                .map_err(|_|"Blender session ownership lock poisoned.".to_string())?,true)
        },
        Err(std::sync::TryLockError::Poisoned(_))=>
            return Err("Blender session ownership lock poisoned.".into()),
    };
    if cancel_requested{
        // The running plan may already have retired on the interruption
        // error. A new session must never be closed by an old stop request.
        let (retired_here,root_exited)=if slot.as_ref().is_some_and(|s|s.session_id==id){
            (true,retire(registry,state,&mut slot))
        }else if slot.is_some(){
            return Err("Blender cancellation ID no longer owns the active session.".into());
        }else{
            (false,false)
        };
        return Ok(json!({"status":"cancellation_requested_session_retired",
            "session_id":id,"owned_session_registry_empty":slot.is_none(),
            "broker_root_exit_confirmed":retired_here&&root_exited,
            "broker_root_exit_confirmation_unavailable":!retired_here,
            "in_flight_operation_outcome":"unknown",
            "descendant_exit_individually_unverified":true,
            "no_automatic_replay":true,"no_automatic_reconnect":true}));
    }
    let session=slot.as_mut().ok_or("No active owned Blender session.")?;
    if session.session_id!=id{return Err("Blender session ID mismatch.".into());}
    // Even if the graceful close command is lost, the owned process tree is
    // stopped; never reuse the identity after a close attempt.
    let response=request(session,state,"close",None,false,None,PROBE_DEADLINE);
    let root_exited=retire(registry,state,&mut slot);
    match response {
        Ok(v) if v.get("status").and_then(Value::as_str)==Some("closing") && root_exited=>
            Ok(json!({"status":"closed","session_id":id,"broker_root_exit_confirmed":true,
                "os_owned_job_closed":cfg!(target_os="windows"),
                "descendant_exit_individually_unverified":true,
                "no_automatic_reconnect":true})),
        _=>Err("Blender close outcome uncertain; owned launcher was retired.".into()),
    }
}


#[cfg(test)]
mod exact_session_cancellation_tests{
    use super::*;
    #[test]
    fn native_success_promotion_rejects_cancelled_or_mismatched_owner(){
        let signal=Arc::new(AtomicBool::new(false));
        let target=CancellationTarget{session_id:"owned-A".into(),pid:84,
            invalidated:signal.clone()};
        verified_response_eligible(&target,"owned-A",84).unwrap();
        assert!(verified_response_eligible(&target,"owned-B",84).is_err());
        assert!(verified_response_eligible(&target,"owned-A",85).is_err());
        invalidate_exact_session(&target,"owned-A").unwrap();
        assert!(verified_response_eligible(&target,"owned-A",84).is_err());
    }
    #[test]
    fn completion_lane_serializes_owner_stop_with_final_native_promotion(){
        let registry=Arc::new(SessionRegistry::default());
        let signal=Arc::new(AtomicBool::new(false));
        *registry.cancellable.lock().unwrap()=Some(CancellationTarget{
            session_id:"owned-A".into(),pid:84,invalidated:signal.clone()});
        let final_gate=registry.cancellable.lock().unwrap();
        verified_response_eligible(final_gate.as_ref().unwrap(),"owned-A",84).unwrap();
        let other=registry.clone();
        let (tx,rx)=mpsc::sync_channel(1);
        let (ready_tx,ready_rx)=mpsc::sync_channel(1);
        let cancel=thread::spawn(move||{
            ready_tx.send(()).unwrap();
            let gate=other.cancellable.lock().unwrap();
            tx.send(invalidate_exact_session(gate.as_ref().unwrap(),"owned-A"))
                .unwrap();
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        // Holding the completion gate blocks an in-flight close's attempt
        // to mutate the exact cancellation bit after proof acceptance.
        assert!(matches!(rx.recv_timeout(Duration::from_millis(150)),Err(RecvTimeoutError::Timeout)));
        assert!(!signal.load(Ordering::Acquire));
        drop(final_gate);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(),84);
        assert!(signal.load(Ordering::Acquire));
        cancel.join().unwrap();
    }
    #[test]
    fn wrong_session_id_cannot_invalidate_another_owner(){
        let signal=Arc::new(AtomicBool::new(false));
        let target=CancellationTarget{session_id:"owned-A".into(),pid:42,
            invalidated:signal.clone()};
        assert!(invalidate_exact_session(&target,"owned-B").is_err());
        assert!(!signal.load(Ordering::Acquire));
        assert_eq!(invalidate_exact_session(&target,"owned-A").unwrap(),42);
        assert!(signal.load(Ordering::Acquire));
    }
    #[test]
    fn cancellation_lane_is_reachable_while_plan_holds_current_mutex(){
        let registry=Arc::new(SessionRegistry::default());
        let plan_guard=registry.current.lock().unwrap();
        let signal=Arc::new(AtomicBool::new(false));
        *registry.cancellable.lock().unwrap()=Some(CancellationTarget{
            session_id:"owned-A".into(),pid:84,invalidated:signal.clone()});
        let other_thread=registry.clone();
        let (tx,rx)=mpsc::sync_channel(1);
        let handle=thread::spawn(move||{
            let guard=other_thread.cancellable.lock().unwrap();
            tx.send(invalidate_exact_session(guard.as_ref().unwrap(),"owned-A"))
                .unwrap();
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(),84);
        assert!(signal.load(Ordering::Acquire));
        drop(plan_guard);
        handle.join().unwrap();
    }
}

#[cfg(test)]
mod fixed_stage_native_sequence_tests{
    use super::*;
    #[test]
    fn model2_requires_native_owned_prior_stage1_success(){
        for stage in [None,Some("model1"),Some("render"),Some("look")]{
            stage_two_dependency(stage,None,None).unwrap();
        }
        assert!(stage_two_dependency(Some("model2"),None,None).is_err());
        assert!(stage_two_dependency(Some("model2"),Some(&"a".repeat(64)),None).is_err());
        assert!(stage_two_dependency(Some("model2"),None,Some(&"b".repeat(64))).is_err());
        stage_two_dependency(Some("model2"),Some(&"a".repeat(64)),Some(&"b".repeat(64))).unwrap();
        // No source plan, external-reported stage, or forged action JSON
        // can set verified_first_stage_sha256 on an OwnedSession.
    }
}

#[cfg(test)]
mod read_only_object_view_tests {
    use super::*;
    fn page_object(kind:&str)->Value{
        let mut detail=json!({
            "location":[1.0,2.0,3.0],
            "rotation_euler":[0.1,0.2,0.3],
            "scale":[1.0,1.0,1.0],
            "dimensions":[2.0,3.0,4.0],
            "hide_render":false,"hide_viewport":false,
            "materials":["Copper",null],"material_slot_count":2,
            "modifiers":[{"name":"Bevel","type":"BEVEL","show_render":true}],
            "modifier_count":1
        });
        if kind=="CAMERA"{
            detail["camera"]=json!({"type":"PERSP","lens":50.0,
                                     "clip_start":0.1,"clip_end":100.0});
        }
        if kind=="LIGHT"{
            detail["light"]=json!({"type":"POINT","energy":950.0,
                                    "color":[1.0,0.94,0.85]});
        }
        json!({"object_id":"session-A:obj","name":"Proof","type":kind,
            "revision":"a".repeat(64),
            "details_available":true,"details_truncated":false,
            "shader_nodes_inspected":false,"mesh_topology_inspected":false,
            "details":detail})
    }
    #[test]
    fn mesh_camera_and_light_details_pass_native_read_only_validation(){
        for kind in ["MESH","CAMERA","LIGHT"]{
            verified_object_views(&[page_object(kind)],"session-A").unwrap();
        }
    }
    #[test]
    fn small_mesh_topology_checks_all_bounded_vertices_and_faces(){
        let mut mesh=page_object("MESH");
        mesh["mesh_topology_inspected"]=json!(true);
        mesh["geometry_available"]=json!(true);
        mesh["geometry_truncated"]=json!(false);
        mesh["mesh_geometry_summary"]=json!({
            "vertices":[[0.,0.,0.],[1.,0.,0.],[1.,1.,0.],[0.,1.,0.]],
            "faces":[[0,1,2],[0,2,3]],
            "vertex_count":4,"face_count":2,
            "geometry_sha256":"a".repeat(64),
            "digest_checked_in_authenticated_broker":true,
            "native_digest_recomputed":false,
            "native_binary_commitment_sha256":"1cc438cac98bd1882f52a5e2acdaaec4996832426e3c3915c7ba927043dab365",
            "native_binary_commitment_recomputed":false
        });
        verified_object_views(&[mesh.clone()],"session-A").unwrap();
        for (ptr,value) in [
            ("/mesh_geometry_summary/face_count",json!(3)),
            ("/mesh_geometry_summary/faces/1/0",json!(99)),
            ("/mesh_geometry_summary/faces/0/2",json!(1)),
            ("/mesh_geometry_summary/vertices/0/1",json!(2000000.0)),
            ("/mesh_geometry_summary/native_digest_recomputed",json!(true)),
            ("/mesh_geometry_summary/geometry_sha256",json!("bad")),
            ("/mesh_geometry_summary/native_binary_commitment_sha256",json!("0".repeat(64))),
            ("/mesh_geometry_summary/native_binary_commitment_recomputed",json!(true)),
            ("/mesh_geometry_summary/vertices/0/0",json!(0.5)),
            ("/geometry_truncated",json!(true)),
            ("/mesh_topology_inspected",json!(false))
        ]{
            let mut corrupt=mesh.clone();
            *corrupt.pointer_mut(ptr).unwrap()=value;
            assert!(verified_object_views(&[corrupt],"session-A").is_err(),"{ptr}");
        }
        let mut wrong=mesh;
        wrong["type"]=json!("CAMERA");
        assert!(verified_object_views(&[wrong],"session-A").is_err());
    }
    #[test]
    fn medium_mesh_summary_is_bounded_and_never_claims_full_transferred_arrays(){
        let mut item=page_object("MESH");
        item["mesh_topology_inspected"]=json!(false);
        item["geometry_available"]=json!(false);
        item["geometry_truncated"]=json!(true);
        item["mesh_geometry_summary"]=Value::Null;
        item["mesh_overview_available"]=json!(true);
        item["mesh_overview"]=json!({
            "vertex_count":200,"face_count":198,"face_index_count":594,
            "bounds_min":[0.0,-2.0,0.0],"bounds_max":[3.0,4.0,5.0],
            "geometry_sha256":"a".repeat(64),
            "digest_checked_in_authenticated_broker":true,
            "native_digest_recomputed":false,
            "complete_source_validated_in_broker":true,
            "full_vertex_face_arrays_transferred":false
        });
        verified_object_views(&[item.clone()],"session-A").unwrap();
        for (path,value) in [
            ("/mesh_overview/face_index_count",json!(32769)),
            ("/mesh_overview/vertex_count",json!(0)),
            ("/mesh_overview/bounds_min/1",json!(5.0)),
            ("/mesh_overview/geometry_sha256",json!("bad")),
            ("/mesh_overview/digest_checked_in_authenticated_broker",json!(false)),
            ("/mesh_overview/native_digest_recomputed",json!(true)),
            ("/mesh_overview/full_vertex_face_arrays_transferred",json!(true)),
            ("/mesh_overview_available",json!(false)),
            ("/mesh_overview/vertices",json!([[0,0,0]])),
            ("/geometry_truncated",json!(false)),
        ]{
            let mut bad=item.clone();
            if path=="/mesh_overview/vertices" {
                bad["mesh_overview"]["vertices"]=value;
            }else{
                *bad.pointer_mut(path).unwrap()=value;
            }
            assert!(verified_object_views(&[bad],"session-A").is_err(),"{path}");
        }
        let mut bad=item;
        bad["details_available"]=json!(false);
        bad["details"]=Value::Null;
        assert!(verified_object_views(&[bad],"session-A").is_err());
    }
    #[test]
    fn large_mesh_counts_only_fallback_is_provenance_bounded(){
        let mut mesh=page_object("MESH");
        mesh["mesh_counts_available"]=json!(true);
        mesh["mesh_counts"]=json!({
            "vertex_count":120_000,"face_count":98_000,"edge_count":210_000,
            "source":"authenticated_objects_list",
            "topology_verified_by_counts":false
        });
        mesh["mesh_inspection_skipped"]=json!("upstream_geometry_limit");
        mesh["geometry_available"]=json!(false);
        mesh["mesh_topology_inspected"]=json!(false);
        mesh["geometry_truncated"]=json!(true);
        mesh["mesh_geometry_summary"]=Value::Null;
        mesh["mesh_overview_available"]=json!(false);
        mesh["mesh_overview"]=Value::Null;
        verified_object_views(&[mesh.clone()],"session-A").unwrap();
        for (pointer,value) in [
            ("/mesh_counts/vertex_count",json!(100_000_001)),
            ("/mesh_counts/source",json!("unauthenticated")),
            ("/mesh_counts/topology_verified_by_counts",json!(true)),
            ("/mesh_counts/edge_count",json!(-1)),
            ("/mesh_inspection_skipped",json!("empty_or_degenerate_mesh")),
            ("/mesh_overview_available",json!(true)),
            ("/mesh_topology_inspected",json!(true)),
            ("/geometry_truncated",json!(false))
        ]{
            let mut forged=mesh.clone();
            *forged.pointer_mut(pointer).unwrap()=value;
            assert!(verified_object_views(&[forged],"session-A").is_err(),"{pointer}");
        }
        let mut no_detail=mesh;
        no_detail["details_available"]=json!(false);
        no_detail["details"]=Value::Null;
        assert!(verified_object_views(&[no_detail],"session-A").is_err());
    }
    #[test]
    fn read_only_mesh_page_work_budget_cannot_create_false_topology(){
        let mut mesh=page_object("MESH");
        mesh["mesh_counts_available"]=json!(true);
        mesh["mesh_counts"]=json!({
            "vertex_count":1000,"face_count":900,"edge_count":1800,
            "source":"authenticated_objects_list","topology_verified_by_counts":false
        });
        mesh["mesh_inspection_skipped"]=json!("page_work_budget");
        mesh["mesh_topology_inspected"]=json!(false);
        mesh["geometry_available"]=json!(false);
        mesh["geometry_truncated"]=json!(true);
        mesh["mesh_geometry_summary"]=Value::Null;
        mesh["mesh_overview_available"]=json!(false);
        mesh["mesh_overview"]=Value::Null;
        verified_object_views(&[mesh.clone()],"session-A").unwrap();
        mesh["mesh_topology_inspected"]=json!(true);
        assert!(verified_object_views(&[mesh],"session-A").is_err());
        let mut no_metadata=page_object("MESH");
        no_metadata["mesh_counts_available"]=json!(false);
        no_metadata["mesh_counts"]=Value::Null;
        no_metadata["mesh_inspection_skipped"]=json!("page_work_budget");
        no_metadata["mesh_topology_inspected"]=json!(false);
        no_metadata["geometry_available"]=json!(false);
        no_metadata["geometry_truncated"]=json!(true);
        no_metadata["mesh_geometry_summary"]=Value::Null;
        no_metadata["mesh_overview_available"]=json!(false);
        no_metadata["mesh_overview"]=Value::Null;
        verified_object_views(&[no_metadata.clone()],"session-A").unwrap();
        no_metadata["mesh_overview_available"]=json!(true);
        assert!(verified_object_views(&[no_metadata],"session-A").is_err());
    }
    #[test]
    fn in_range_mesh_metadata_must_match_full_or_compact_geometry(){
        let mut mesh=page_object("MESH");
        mesh["mesh_counts_available"]=json!(true);
        mesh["mesh_counts"]=json!({
            "vertex_count":200,"face_count":198,"edge_count":399,
            "source":"authenticated_objects_list","topology_verified_by_counts":false
        });
        mesh["mesh_inspection_skipped"]=Value::Null;
        mesh["mesh_topology_inspected"]=json!(false);
        mesh["geometry_available"]=json!(false);
        mesh["geometry_truncated"]=json!(true);
        mesh["mesh_geometry_summary"]=Value::Null;
        mesh["mesh_overview_available"]=json!(true);
        mesh["mesh_overview"]=json!({
            "vertex_count":200,"face_count":198,"face_index_count":594,
            "bounds_min":[0.0,0.0,0.0],"bounds_max":[199.0,6.0,0.0],
            "geometry_sha256":"a".repeat(64),
            "digest_checked_in_authenticated_broker":true,
            "native_digest_recomputed":false,
            "complete_source_validated_in_broker":true,
            "full_vertex_face_arrays_transferred":false
        });
        verified_object_views(&[mesh.clone()],"session-A").unwrap();
        mesh["mesh_counts"]["face_count"]=json!(199);
        assert!(verified_object_views(&[mesh],"session-A").is_err());
    }
    #[test]
    fn large_mesh_never_fabricates_verified_geometry(){
        let mut mesh=page_object("MESH");
        mesh["mesh_topology_inspected"]=json!(false);
        mesh["geometry_available"]=json!(false);
        mesh["geometry_truncated"]=json!(true);
        mesh["mesh_geometry_summary"]=Value::Null;
        verified_object_views(&[mesh.clone()],"session-A").unwrap();
        mesh["geometry_truncated"]=json!(false);
        assert!(verified_object_views(&[mesh],"session-A").is_err());
    }
    #[test]
    fn native_object_page_requires_unique_filtered_exact_continuation(){
        let mesh=page_object("MESH");
        let mut good=json!({"total":1,"next_offset":null,
            "objects":[mesh],"read_only":true});
        verified_object_page_contract(&good,"session-A",0,5,"Pro",None).unwrap();
        let mut wrong=good.clone();
        wrong["next_offset"]=json!(3);
        assert!(verified_object_page_contract(&wrong,"session-A",0,5,"Pro",None).is_err());
        wrong=good.clone();
        wrong["total"]=json!(2);
        assert!(verified_object_page_contract(&wrong,"session-A",0,5,"Pro",None).is_err());
        wrong=good.clone();
        wrong["objects"].as_array_mut().unwrap().push(page_object("MESH"));
        wrong["total"]=json!(2);
        assert!(verified_object_page_contract(&wrong,"session-A",0,5,"Pro",None).is_err());
        wrong=good.clone();
        wrong["objects"][0]["object_id"]=json!("different:obj");
        assert!(verified_object_page_contract(&wrong,"session-A",0,5,"Pro",None).is_err());
        assert!(verified_object_page_contract(&good,"session-A",0,5,"Wrong",None).is_err());
        assert!(verified_object_page_contract(&good,"session-A",0,5,"Pro",Some("LIGHT")).is_err());
        good["objects"][0]["revision"]=json!("not-a-sha");
        assert!(verified_object_page_contract(&good,"session-A",0,5,"Pro",None).is_err());
    }
    #[test]
    fn native_object_page_continuation_tracks_actual_query_window(){
        let one=page_object("MESH");
        let head=json!({"total":2,"next_offset":1,"objects":[one]});
        verified_object_page_contract(&head,"session-A",0,1,"Pro",None).unwrap();
        let tail=json!({"total":2,"next_offset":null,"objects":[page_object("CAMERA")]});
        verified_object_page_contract(&tail,"session-A",1,1,"Pro",None).unwrap();
        let empty=json!({"total":2,"next_offset":null,"objects":[]});
        verified_object_page_contract(&empty,"session-A",2,1,"Pro",None).unwrap();
        let mut forged=empty;
        forged["next_offset"]=json!(2);
        assert!(verified_object_page_contract(&forged,"session-A",2,1,"Pro",None).is_err());
    }
    #[test]
    fn historic_minimal_or_truncated_readback_never_claims_details(){
        let mut item=page_object("MESH");
        item["details_available"]=json!(false);
        item["details"]=Value::Null;
        item.as_object_mut().unwrap().remove("shader_nodes_inspected");
        item.as_object_mut().unwrap().remove("mesh_topology_inspected");
        verified_object_views(&[item.clone()],"session-A").unwrap();
        item["details"]=json!({"materials":["forged"]});
        assert!(verified_object_views(&[item.clone()],"session-A").is_err());
        item["details"]=Value::Null;
        item["shader_nodes_inspected"]=json!(true);
        assert!(verified_object_views(&[item],"session-A").is_err());
    }
    #[test]
    fn malformed_details_cannot_be_promoted_to_verified_inspection(){
        let original=page_object("MESH");
        let edits=[
            ("/details/material_slot_count",json!(3)),
            ("/details/modifiers/0/show_render",json!("yes")),
            ("/details/location",json!([1.0,2.0])),
            ("/details/dimensions/1",json!(2000000.0)),
            ("/details_available",json!(false)),
            ("/details_truncated",json!(true)),
            ("/shader_nodes_inspected",json!(true)),
            ("/mesh_topology_inspected",json!(true)),
            ("/revision",json!("bad")),
        ];
        for (path,value) in edits{
            let mut altered=original.clone();
            *altered.pointer_mut(path).unwrap()=value;
            assert!(verified_object_views(&[altered],"session-A").is_err(),"{path}");
        }
        let mut wrong=original.clone();
        wrong["object_id"]=json!("other-session:obj");
        assert!(verified_object_views(&[wrong],"session-A").is_err());
        let mut wrong=page_object("CAMERA");
        wrong["details"]["camera"]["clip_end"]=json!(-1);
        assert!(verified_object_views(&[wrong],"session-A").is_err());
        let mut wrong=page_object("LIGHT");
        wrong["details"]["light"]["energy"]=json!(-1.0);
        assert!(verified_object_views(&[wrong],"session-A").is_err());
    }
}
