//! Existing approved Blender PLAN under exact PID-owned Windows Job Object.
//! Plan remains declarative JSON: no shell, arbitrary Python or free-form code.
//! Successful OS exit is NOT enough: exact authenticated Blender response and
//! on-disk final artifact hash must both pass inside original desktop lease.
use std::{ffi::OsString,fs::{self,OpenOptions},io::Write,path::{Path,PathBuf},time::Duration};
use serde_json::{Value,json};
use tauri::{AppHandle,Manager};
use uuid::Uuid;
use crate::execution_lease::NativeExecutionLease;
use crate::ActionState;

const MAX_PLAN_BYTES:usize=64*1024;
const MAX_RECEIPT_BYTES:usize=1024*1024;
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
fn native_plan_response(file:&Path,dir:&Path,output_dir:&Path,render:bool)->Result<Value,String>{
    let meta=fs::symlink_metadata(file)
        .map_err(|_|"Owned Blender plan final evidence is missing.")?;
    if !meta.is_file()||meta.file_type().is_symlink()
        ||meta.len()==0||meta.len()>MAX_RECEIPT_BYTES as u64{
        return Err("Owned Blender plan evidence file has invalid type/size.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes()&0x400!=0{
            return Err("Owned Blender plan evidence is a reparse point.".into());
        }
    }
    if fs::canonicalize(file).ok().and_then(|p|p.parent().map(Path::to_path_buf))
        !=Some(fs::canonicalize(dir).map_err(|_|"Blender private plan directory unavailable.")?){
        return Err("Blender plan evidence escaped its private directory.".into());
    }
    let bytes=crate::read_file_bytes_bounded(file,MAX_RECEIPT_BYTES,"owned Blender plan receipt")?;
    let value:Value=serde_json::from_slice(&bytes)
        .map_err(|_|"Owned Blender plan final response is malformed.")?;
    if value.get("protocol_version").and_then(Value::as_u64)!=Some(1)
        ||value.get("status").and_then(Value::as_str)!=Some("verified")
        ||value.get("complete").and_then(Value::as_bool)!=Some(true)
        ||value.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
        ||value.get("destructive_allowed").and_then(Value::as_bool)!=Some(false)
        ||value.get("render_approved").and_then(Value::as_bool)!=Some(render)
        ||value.get("executed_steps").and_then(Value::as_u64).is_none_or(|steps|steps==0||steps>6){
        return Err("Owned Blender plan lacks complete authenticated host readback.".into());
    }
    if !matches!(value.get("final_operation").and_then(Value::as_str),
        Some("file.checkpoint"|"render.execute")){
        return Err("Owned Blender plan final operation was not approved.".into());
    }
    if value["final_operation"]=="render.execute"&&!render{
        return Err("Unapproved render operation in Blender response.".into());
    }
    // Share exact existing final-artifact attestation with the legacy
    // Blender plan path: canonical approved folder, bounded file and SHA256.
    crate::blender_plan_worker::verify_output(&value,output_dir)?;
    Ok(json!({"status":"verified","worker":"blender",
        "full_plan_completed":true,"artifact":value["artifact"],
        "verified_by_native_sha256":true,
        "plan_steps":value["executed_steps"],"allow_render":render}))
}
fn prepare_plan(root:&Path,bytes:&[u8])->Result<TemporaryFile,String>{
    if bytes.is_empty()||bytes.len()>MAX_PLAN_BYTES{
        return Err("Owned Blender plan exceeds 64 KiB input budget.".into());
    }
    fs::create_dir_all(root).map_err(|_|"Cannot create private Blender plan directory.")?;
    let path=root.join(format!("{}.json",Uuid::new_v4()));
    let mut file=OpenOptions::new().create_new(true).write(true)
        .open(&path).map_err(|_|"Cannot create exclusive private Blender plan file.")?;
    file.write_all(bytes).map_err(|_|"Cannot write private Blender plan file.")?;
    file.sync_all().map_err(|_|"Cannot durably flush private Blender plan file.")?;
    Ok(TemporaryFile(path))
}
fn checked_app_paths(python_exe:&str,blender_exe:&str,blend_file:Option<&str>,
    output_dir:&str)->Result<(PathBuf,PathBuf),String>{
    let py=Path::new(python_exe);
    let blender=Path::new(blender_exe);
    let output=Path::new(output_dir);
    if !py.is_absolute()||!blender.is_absolute()||!output.is_absolute()
        ||!py.is_file()||!blender.is_file()||!output.is_dir()
        ||!matches!(py.file_name().and_then(|n|n.to_str()).unwrap_or_default().to_ascii_lowercase().as_str(),
            "python.exe"|"python3.exe")
        ||!blender.file_name().and_then(|n|n.to_str()).unwrap_or_default().eq_ignore_ascii_case("blender.exe"){
        return Err("Owned Blender plan must use approved existing absolute Python, Blender and output paths.".into());
    }
    if blend_file.is_some_and(|name|{
        let p=Path::new(name);
        !p.is_absolute()||!p.is_file()||!p.extension()
            .and_then(|n|n.to_str()).unwrap_or_default().eq_ignore_ascii_case("blend")
    }){
        return Err("Owned Blender plan input is not an approved existing .blend.".into());
    }
    Ok((py.to_path_buf(),blender.to_path_buf()))
}
pub(crate) fn execute<'a>(app:&AppHandle,state:&ActionState,
    slot:&mut Option<NativeExecutionLease<'a>>,
    action_id:&str,python_exe:&str,blender_exe:&str,blend_file:Option<&str>,
    output_dir:&str,plan:&Value,render:bool)->Result<Value,String>{
    let (python,blender)=checked_app_paths(python_exe,blender_exe,blend_file,output_dir)?;
    let script=app.path().resource_dir()
        .map_err(|_|"Cannot locate fixed Blender plan script.")?
        .join("blender-worker").join("shuvi_blender_plan.py");
    if !script.is_file(){return Err("Fixed Blender plan resource unavailable.".into());}
    let root=app.path().app_local_data_dir()
        .map_err(|_|"Cannot locate private owned Blender plan data.")?
        .join("owned-blender-plan");
    let bytes=serde_json::to_vec(plan).map_err(|_|"Cannot encode declarative Blender plan.")?;
    let input=prepare_plan(&root,&bytes)?;
    let evidence=TemporaryFile(root.join(format!("{}.json",Uuid::new_v4())));
    let cwd=script.parent().ok_or("Bundled Blender plan script has no parent directory.")?;
    let mut args=vec![
        OsString::from("-B"),script.as_os_str().to_os_string(),
        OsString::from("--python-plan"),input.0.as_os_str().to_os_string(),
        OsString::from("--blender-exe"),blender.as_os_str().to_os_string(),
        OsString::from("--output-dir"),OsString::from(output_dir),
        OsString::from("--result-file"),evidence.0.as_os_str().to_os_string()
    ];
    if let Some(file)=blend_file{
        args.push(OsString::from("--blend-file"));
        args.push(OsString::from(file));
    }
    if render{args.push(OsString::from("--allow-render"));}
    let lease=slot.take().ok_or("Original native desktop lease not held by approved Blender plan.")?;
    let mut child=crate::native_scheduler::owned_process::spawn_for_active_action(
        app,lease,action_id,"blender_run_plan",&python,&args,cwd,Duration::from_secs(120))?;
    let tracked=crate::native_scheduler::owned_process::RegisteredOwnedPid::start(state,child.pid())?;
    let result=child.wait_bounded_with_host_budget(state);
    // Do not restore native lease until all Job Object descendants are gone.
    let recovered=child.reclaim_terminal_lease()?;
    *slot=Some(recovered);
    drop(tracked);
    let status=result?;
    if status.phase!="exited"||status.exit_code!=Some(0)||!status.descendants_contained{
        return Err("Owned Blender plan cancelled/failed/timed out; inspect Blender output before retry.".into());
    }
    native_plan_response(&evidence.0,&root,Path::new(output_dir),render)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn approved_plan_bytes_are_durable_and_bounded(){
        let root=std::env::temp_dir().join(format!("shuvi-owned-plan-{}",Uuid::new_v4()));
        let guard=prepare_plan(&root,br#"{"steps":[]}"#).unwrap();
        assert_eq!(fs::read(&guard.0).unwrap(),br#"{"steps":[]}"#);
        assert!(prepare_plan(&root,&vec![b'x';MAX_PLAN_BYTES+1]).is_err());
        drop(guard);
        let _=fs::remove_dir(&root);
    }
    #[test]
    fn evidence_with_wrong_sha256_is_never_reported_as_saved_blender_work(){
        use sha2::{Digest,Sha256};
        let dir=std::env::temp_dir().join(format!("shuvi-owned-hash-test-{}",Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let output=dir.join("scene.blend");
        fs::write(&output,b"BLENDER test bytes").unwrap();
        let expected=format!("{:x}",Sha256::digest(b"different bytes"));
        let response=dir.join("receipt.json");
        fs::write(&response,serde_json::to_vec(&json!({
            "protocol_version":1,"status":"verified","complete":true,
            "authenticated_blender_plan":true,"destructive_allowed":false,
            "render_approved":false,"executed_steps":1,
            "final_operation":"file.checkpoint",
            "artifact":{"path":output.to_str().unwrap(),"sha256":expected,
                "bytes":fs::metadata(&output).unwrap().len()}
        })).unwrap()).unwrap();
        assert!(native_plan_response(&response,&dir,&dir,false).is_err());
        let _=fs::remove_file(&response);
        let _=fs::remove_file(&output);
        let _=fs::remove_dir(&dir);
    }
    #[test]
    fn false_authentication_and_wrong_render_flag_fail_closed(){
        let root=std::env::temp_dir().join(format!("shuvi-owned-receipt-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file=root.join("response.json");
        fs::write(&file,serde_json::to_vec(&json!({
            "protocol_version":1,"status":"verified","complete":true,
            "authenticated_blender_plan":false,"destructive_allowed":false,
            "render_approved":false,"executed_steps":2,
            "final_operation":"file.checkpoint","artifact":{}
        })).unwrap()).unwrap();
        assert!(native_plan_response(&file,&root,&root,false).is_err());
        let _=fs::remove_file(&file);let _=fs::remove_dir(&root);
    }
}
