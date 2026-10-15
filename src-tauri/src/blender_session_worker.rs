//! Rust-owned persistent Blender child with an authenticated fixed Python broker.
//! Called ONLY by ordinary audited, owner-approved native ToolAction variants.
//! No model-supplied Python, shell, arbitrary op or permission bypass.
use std::{
    io::{Read,Write}, path::Path, process::{Child,ChildStdin,Command,Stdio},
    sync::{Mutex,mpsc::{self,Receiver,RecvTimeoutError}},
    thread, time::{Duration,Instant},
};
use serde_json::{Value,json};
use crate::{
    ActionState,register_managed_process,unregister_managed_process,
    managed_process_identity_matches,terminate_managed_process_tree,current_runtime_status,
    blender_plan_worker,
};

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
}

impl Drop for OwnedSession {
    fn drop(&mut self) {
        // Child handle ownership is stronger than a PID guess. Only an owned,
        // still-running launcher may be terminated, including its child Blender
        // on Windows. Never stop a process because of a stale numeric PID alone.
        if matches!(self.child.try_wait(),Ok(None)) {
            let _=terminate_managed_process_tree(self.child.id());
            let _=self.child.kill();
        }
        let _=self.child.wait();
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
    if answer.get("session_id").and_then(Value::as_str)!=Some(session.session_id.as_str()){
        return Err("Blender broker returned a different session identity.".into());
    }
    Ok(answer)
}

fn retire(state:&ActionState,slot:&mut Option<OwnedSession>) {
    if let Some(session)=slot.take(){
        let pid=session.child.id();
        drop(session);
        unregister_managed_process(state,pid);
    }
}

pub(crate) fn start(
    registry:&SessionRegistry,state:&ActionState,python_exe:&str,blender_exe:&str,
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
    let mut child=command.spawn().map_err(|_|"Could not launch the fixed Blender session broker.".to_string())?;
    let pid=child.id();
    if let Err(error)=register_managed_process(state,pid) {
        let _=child.kill(); let _=child.wait();
        return Err(format!("Blender broker could not be bound to process identity: {error}"));
    }
    let input=match child.stdin.take(){Some(v)=>v,None=>{
        let _=terminate_managed_process_tree(pid);let _=child.kill();let _=child.wait();
        unregister_managed_process(state,pid);
        return Err("Blender broker lacks a private command channel.".into());
    }};
    let output=match child.stdout.take(){Some(v)=>v,None=>{
        let _=terminate_managed_process_tree(pid);let _=child.kill();let _=child.wait();
        unregister_managed_process(state,pid);
        return Err("Blender broker lacks a bounded response channel.".into());
    }};
    let mut session=OwnedSession{child,input,replies:reader(output),session_id:String::new(),
        output_dir:output_dir.into(),allow_render,created:Instant::now()};
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
            *slot=Some(session);
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
    retire(state,&mut slot);
    match response {
        Ok(v) if v.get("status").and_then(Value::as_str)==Some("closing")=>
            Ok(json!({"status":"closed","session_id":id,"process_retired":true,
                "no_automatic_reconnect":true})),
        _=>Err("Blender close outcome uncertain; owned launcher was retired.".into()),
    }
}
