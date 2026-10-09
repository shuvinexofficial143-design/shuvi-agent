//! Explicit read-only bridge to the separate shuvi_blender_agent Python package.
//! No arbitrary Python from the model: one fixed bundled adapter, two read-only
//! operations, authenticated local Blender child and exact structured result.
use std::{path::Path,process::{Command,Stdio},time::Duration};
use serde_json::Value;
use crate::{ActionState,register_managed_process,unregister_managed_process,terminate_managed_process_tree,bounded_child};

pub(crate) fn inspect(
    python_exe:&str,blender_exe:&str,blend_file:Option<&str>,operation:&str,
    script:&Path,state:&ActionState
)->Result<Value,String>{
    if !matches!(operation,"scene.inspect"|"system.capabilities"){
        return Err("Only read-only Blender inspection is supported.".into());
    }
    if !script.is_file(){return Err("Bundled Blender worker adapter not found; no Blender process started.".into());}
    let mut command=Command::new(python_exe);
    command.arg("-B").arg(script)
        .arg("--blender-exe").arg(blender_exe)
        .arg("--operation").arg(operation)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(path)=blend_file{command.arg("--blend-file").arg(path);}
    let mut child=command.spawn().map_err(|_|"Could not start the approved Python Blender worker.".to_string())?;
    let pid=child.id();
    if let Err(error)=register_managed_process(state,pid){
        let _=terminate_managed_process_tree(pid);
        let _=child.wait();
        return Err(format!("Untracked Blender worker was stopped before execution: {error}"));
    }
    let output=bounded_child::collect_with_deadline(child,Duration::from_secs(45));
    if output.is_err(){
        // The owned Python launcher must never be left running. A timeout
        // could still have produced a descendant; report outcome unknown.
        let _=terminate_managed_process_tree(pid);
    }
    unregister_managed_process(state,pid);
    let output=output.map_err(|e|format!("Blender worker inspection outcome unknown: {e}"))?;
    if !output.status.success(){
        return Err("Blender worker returned an error; read-only host inspection did not complete.".into());
    }
    let value:Value=serde_json::from_slice(&output.stdout)
        .map_err(|_|"Blender worker did not return a valid bounded JSON response.".to_string())?;
    if value.get("protocol_version").and_then(Value::as_u64)!=Some(1)
        || value.get("operation").and_then(Value::as_str)!=Some(operation)
        || value.get("status").and_then(Value::as_str)!=Some("succeeded")
        || value.get("authenticated_bridge_roundtrip").and_then(Value::as_bool)!=Some(true)
        || value.get("mutations_allowed").and_then(Value::as_bool)!=Some(false)
        || value.get("rendering_allowed").and_then(Value::as_bool)!=Some(false)
        || !value.get("data").is_some_and(Value::is_object)
    {
        return Err("Blender inspection lacks exact authenticated read-only host evidence.".into());
    }
    Ok(value)
}
