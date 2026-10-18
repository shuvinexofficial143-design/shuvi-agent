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
    source_checkpoint:Option<SourceCheckpoint>,
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

fn request(session:&mut OwnedSession,state:&ActionState,op:&str,plan:Option<&Value>,allow_render:bool,expected_revision:Option<&str>,deadline:Duration)->Result<Value,String>{
    if session.invalidated.load(Ordering::Acquire){
        return Err("Blender session was invalidated by the native watchdog.".into());
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
            if let Err(error)=spawn_watchdog(app,id,pid,start_time,watchdog,invalidated) {
                retire(state,&mut slot);
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
        retire(state,&mut slot);
    }
    result
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
                ||item.get("mesh_topology_inspected").and_then(Value::as_bool)==Some(true){
                return Err("Unavailable Blender details cannot claim validation.".into());
            }
            continue;
        }
        if truncated ||item.get("shader_nodes_inspected").and_then(Value::as_bool)!=Some(false)
            ||item.get("mesh_topology_inspected").and_then(Value::as_bool)!=Some(false){
            return Err("Blender detail projection cannot claim shader/mesh attestation.".into());
        }
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
            Some(scene_revision),PROBE_DEADLINE)?;
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
        verified_object_views(response["objects"].as_array()
            .ok_or("Blender object page missing.")?,id)?;
        Ok(json!({"status":"read_only_object_page","session_id":id,
            "scene_revision":scene_revision,"offset":offset,
            "total":response["total"],"next_offset":response["next_offset"],
            "objects":response["objects"],"read_only":true,
            "requires_new_action_approval_for_mutation":true}))
    })();
    if result.is_err() && slot.as_ref().is_some_and(|s|s.session_id==id){
        retire(state,&mut slot);
    }
    result
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
                ||proof.get("source_bytes").and_then(Value::as_u64)!=Some(source.bytes){
                return Err("Material render preflight is not bound to this native source, action and session.".into());
            }
        }else if material_claim.is_some(){
            return Err("Unrelated Blender plan cannot return material-render preflight.".into());
        }
        // Do not promote an authenticated response carrying the wrong output
        // filename, even if its bytes were verified inside the approved folder.
        crate::blender_plan_lineage::verify_final_artifact_binding(plan,&response)?;
        let manifest=crate::blender_artifact_manifest::build(
            &response,Path::new(&session.output_dir),action_id,Some(id))?;
        Ok(json!({"status":"verified","session_id":id,"full_plan_completed":true,
            "source_action_id":execution_action_id,"artifact":response["artifact"],
            "checkpoint_reopen":response["checkpoint_reopen"],"plan_steps":response["executed_steps"],
            "verified_by_native_sha256":true,"same_blender_session":true,
            "artifact_manifest":manifest,
            "approved_plan_lineage":plan_lineage,
            "input_checkpoint":session.source_checkpoint.as_ref().map(|s|s.json())}))
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
    let response=request(session,state,"close",None,false,None,PROBE_DEADLINE);
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
