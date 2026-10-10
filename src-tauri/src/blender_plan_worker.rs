//! Approved Blender declarative plan execution. The AI supplies JSON data,
//! never Python code, CLI scripts, arbitrary shell args or Blender expressions.
//! Every requested plan is preflighted by the separate Python Controller.
use std::{fs::{self,OpenOptions,File},io::{Read,Write},path::{Path,PathBuf},process::{Command,Stdio},time::Duration};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use uuid::Uuid;
use crate::{ActionState,register_managed_process,unregister_managed_process,terminate_managed_process_tree,bounded_child};

struct PlanFile(PathBuf);
impl Drop for PlanFile {fn drop(&mut self){let _=fs::remove_file(&self.0);}}

fn verify_output(output:&Value,root:&Path)->Result<(),String>{
    let artifact=output.get("artifact").ok_or("Blender output artifact receipt missing.")?;
    let name=artifact.get("path").and_then(Value::as_str).ok_or("Blender output path missing.")?;
    let expected=artifact.get("sha256").and_then(Value::as_str).ok_or("Blender output SHA-256 missing.")?;
    let expected_size=artifact.get("bytes").and_then(Value::as_u64).ok_or("Blender output size missing.")?;
    let canonical=Path::new(name).canonicalize().map_err(|_|"Blender output artifact is not accessible.".to_string())?;
    let parent=canonical.parent().ok_or("Blender output has no parent.")?;
    if parent!=root.canonicalize().map_err(|_|"Blender output directory is unavailable.".to_string())? {
        return Err("Blender output escaped the approved output folder.".into());
    }
    let meta=fs::symlink_metadata(&canonical).map_err(|_|"Blender output metadata is unavailable.".to_string())?;
    if !meta.file_type().is_file() || meta.len()!=expected_size || meta.len()>128*1024*1024{
        return Err("Blender output file type/size does not match the receipt.".into());
    }
    let mut f=File::open(&canonical).map_err(|_|"Blender output could not be verified.".to_string())?;
    let mut hasher=Sha256::new();
    let mut buf=[0u8;65536];
    loop {
        let n=f.read(&mut buf).map_err(|_|"Blender artifact readback failed.".to_string())?;
        if n==0 {break;}
        hasher.update(&buf[..n]);
    }
    if format!("{:x}",hasher.finalize())!=expected.to_ascii_lowercase(){
        return Err("Blender artifact hash differs from exact worker receipt.".into());
    }
    Ok(())
}

pub(crate) fn execute(
    python_exe:&str,blender_exe:&str,blend_file:Option<&str>,
    output_dir:&str,plan:&Value,allow_render:bool,
    script:&Path,work_dir:&Path,state:&ActionState,execution_action_id:Option<&str>
)->Result<Value,String>{
    if !script.is_file(){return Err("Fixed Blender plan adapter missing.".into());}
    let plan_bytes=serde_json::to_vec(plan).map_err(|_|"Invalid Blender JSON plan.".to_string())?;
    if plan_bytes.is_empty() || plan_bytes.len()>64*1024{
        return Err("Blender plan exceeds the bounded 64 KiB budget.".into());
    }
    fs::create_dir_all(work_dir).map_err(|_|"Cannot create Shuvi private Blender plan directory.".to_string())?;
    let path=work_dir.join(format!("{}.json",Uuid::new_v4()));
    let guard=PlanFile(path.clone());
    {
        let mut f=OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|_|"Cannot reserve private Blender plan input.".to_string())?;
        f.write_all(&plan_bytes).map_err(|_|"Cannot write bounded Blender plan input.".to_string())?;
        f.sync_all().map_err(|_|"Could not flush Blender plan input.".to_string())?;
    }
    let mut command=Command::new(python_exe);
    command.arg("-B").arg(script).arg("--python-plan").arg(&path)
        .arg("--blender-exe").arg(blender_exe).arg("--output-dir").arg(output_dir)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(input)=blend_file{command.arg("--blend-file").arg(input);}
    if allow_render{command.arg("--allow-render");}
    let mut child=command.spawn().map_err(|_|"Blender plan launcher could not be started.".to_string())?;
    let pid=child.id();
    if let Err(error)=register_managed_process(state,pid){
        let _=terminate_managed_process_tree(pid);
        let _=child.wait();
        return Err(format!("Blender plan launcher was stopped before execution: {error}"));
    }
    if let Some(action_id)=execution_action_id{
        match state.running_action_children.lock(){
            Ok(mut running)=>{running.insert(action_id.to_string(),pid);}
            Err(_)=>{
                let _=terminate_managed_process_tree(pid);
                unregister_managed_process(state,pid);
                let _=child.kill();
                let _=child.wait();
                return Err("Could not register cancellable Blender child; stopped before dispatch.".into());
            }
        }
    }
    // Track the exact registered child so remote Stop can terminate its entire
    // owned Windows process tree (including the Blender background child).
    let output=bounded_child::collect_with_deadline(child,Duration::from_secs(120));
    if output.is_err(){let _=terminate_managed_process_tree(pid);}
    if let Some(action_id)=execution_action_id{
        if let Ok(mut running)=state.running_action_children.lock(){running.remove(action_id);}
    }
    unregister_managed_process(state,pid);
    let output=output.map_err(|_|"Blender plan outcome unknown after deadline or cancellation; inspect before retry.".to_string())?;
    if !output.status.success(){
        return Err("Blender plan failed or had partial/unknown results; inspect scene/output before retry.".into());
    }
    let value:Value=serde_json::from_slice(&output.stdout)
        .map_err(|_|"Blender plan returned malformed bounded output.".to_string())?;
    if value.get("protocol_version").and_then(Value::as_u64)!=Some(1)
        ||value.get("status").and_then(Value::as_str)!=Some("verified")
        ||value.get("complete").and_then(Value::as_bool)!=Some(true)
        ||value.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
        ||value.get("destructive_allowed").and_then(Value::as_bool)!=Some(false)
        ||value.get("render_approved").and_then(Value::as_bool)!=Some(allow_render)
    {return Err("Blender plan lacks authenticated complete readback evidence.".into());}
    verify_output(&value,Path::new(output_dir))?;
    drop(guard);
    Ok(json!({"status":"verified","worker":"blender","full_plan_completed":true,
        "artifact":value["artifact"],"verified_by_native_sha256":true,
        "plan_steps":value["executed_steps"],"allow_render":allow_render}))
}
