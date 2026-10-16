//! Scheduled, approved Blender *read-only* inspection through Shuvi's
//! PID-owned Windows Job Object and durable OS receipt. Not a model shell.
//! The existing unscheduled Blender adapter stays unchanged. No render/mutate.
use std::{ffi::OsString,fs,path::{Path,PathBuf},time::Duration};
use serde_json::Value;
use tauri::{AppHandle,Manager};
use uuid::Uuid;
use crate::execution_lease::NativeExecutionLease;

const MAX_EVIDENCE:usize=1024*1024;
struct PrivateEvidence(PathBuf);
impl Drop for PrivateEvidence{
    fn drop(&mut self){let _=fs::remove_file(&self.0);}
}
fn verify_payload(file:&Path,dir:&Path,operation:&str)->Result<Value,String>{
    let meta=fs::symlink_metadata(file)
        .map_err(|_|"Approved Blender worker did not deliver private evidence.")?;
    if !meta.is_file()||meta.file_type().is_symlink()
       ||meta.len()==0||meta.len()>(MAX_EVIDENCE as u64){
        return Err("Blender inspection evidence has invalid size or file type.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes()&0x400!=0{
            return Err("Blender inspection evidence is a reparse point.".into());
        }
    }
    if fs::canonicalize(file).ok().and_then(|p|p.parent().map(Path::to_path_buf))
        !=Some(fs::canonicalize(dir).map_err(|_|"Blender private evidence directory unavailable.")?){
        return Err("Blender inspection evidence escaped its private directory.".into());
    }
    let bytes=crate::read_file_bytes_bounded(file,MAX_EVIDENCE,"owned Blender evidence")?;
    let value:Value=serde_json::from_slice(&bytes)
        .map_err(|_|"Blender inspection evidence JSON invalid.")?;
    if value.get("protocol_version").and_then(Value::as_u64)!=Some(1)
        ||value.get("operation").and_then(Value::as_str)!=Some(operation)
        ||value.get("status").and_then(Value::as_str)!=Some("succeeded")
        ||value.get("authenticated_bridge_roundtrip").and_then(Value::as_bool)!=Some(true)
        ||value.get("mutations_allowed").and_then(Value::as_bool)!=Some(false)
        ||value.get("rendering_allowed").and_then(Value::as_bool)!=Some(false)
        ||!value.get("data").is_some_and(Value::is_object){
        return Err("Blender inspection lacks authenticated read-only host evidence.".into());
    }
    Ok(value)
}
/// Consume the original execution lease into the child only while it runs,
/// then return the exact same lease to the caller before artifact readback
/// and higher-level action audit. Never release in between those boundaries.
pub(crate) fn inspect<'a>(
    app:&AppHandle,
    native_slot:&mut Option<NativeExecutionLease<'a>>,
    action_id:&str,
    python_exe:&str,blender_exe:&str,blend_file:Option<&str>,operation:&str,
)->Result<Value,String>{
    if !matches!(operation,"scene.inspect"|"system.capabilities"){
        return Err("Owned Blender inspect supports only read-only operations.".into());
    }
    let py=Path::new(python_exe);
    let blender=Path::new(blender_exe);
    if !py.is_absolute()||!blender.is_absolute()
        ||!py.is_file()||!blender.is_file()
        ||!matches!(py.file_name().and_then(|x|x.to_str()).unwrap_or_default().to_ascii_lowercase().as_str(),
            "python.exe"|"python3.exe")
        ||!blender.file_name().and_then(|x|x.to_str()).unwrap_or_default().eq_ignore_ascii_case("blender.exe"){
        return Err("Owned Blender inspection executable identities were not approved.".into());
    }
    if blend_file.is_some_and(|file|{
        let p=Path::new(file);
        !p.is_absolute()||!p.is_file()||!p.extension()
           .and_then(|x|x.to_str()).unwrap_or_default().eq_ignore_ascii_case("blend")
    }){
        return Err("Owned Blender inspection input must be an existing .blend.".into());
    }
    let script=app.path().resource_dir()
        .map_err(|_|"Cannot locate fixed bundled Blender script.")?
        .join("blender-worker").join("shuvi_blender_bridge.py");
    if !script.is_file(){
        return Err("Bundled Blender inspection worker resource missing.".into());
    }
    let work=app.path().app_local_data_dir()
        .map_err(|_|"Cannot locate private owned Blender worker storage.")?
        .join("owned-blender-inspect");
    fs::create_dir_all(&work).map_err(|_|"Cannot prepare private Blender evidence directory.")?;
    let evidence=PrivateEvidence(work.join(format!("{}.json",Uuid::new_v4())));
    let cwd=script.parent().ok_or("Fixed Blender resource has no directory.")?;
    let mut args=vec![OsString::from("-B"),script.as_os_str().to_os_string(),
        OsString::from("--blender-exe"),blender.as_os_str().to_os_string(),
        OsString::from("--operation"),OsString::from(operation),
        OsString::from("--result-file"),evidence.0.as_os_str().to_os_string()];
    if let Some(file)=blend_file{
        args.push(OsString::from("--blend-file"));
        args.push(OsString::from(file));
    }
    let lease=native_slot.take().ok_or("Native desktop lease missing at worker dispatch.")?;
    // PID ownership and launch-intent are backed by durable native journals.
    let mut child=crate::native_scheduler::owned_process::spawn_for_active_action(
        app,lease,action_id,"blender_inspect",py,&args,cwd,Duration::from_secs(45))?;
    let observed=child.wait_bounded();
    // On a failed/unknown OS termination do not take/release this lease.
    // The existing owner recovery journal must resolve the uncertain effects.
    let returned=child.reclaim_terminal_lease()?;
    *native_slot=Some(returned);
    let observed=observed?;
    if observed.phase!="exited"||observed.exit_code!=Some(0)
        ||!observed.descendants_contained {
        return Err("Owned Blender inspection process failed or was stopped; no readback verified.".into());
    }
    verify_payload(&evidence.0,&work,operation)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn missing_receipt_never_claims_blender_progress(){
        let dir=std::env::temp_dir();
        let file=dir.join(format!("not-a-real-blender-evidence-{}.json",Uuid::new_v4()));
        assert!(verify_payload(&file,&dir,"scene.inspect").is_err());
    }
    #[test]
    fn forged_success_or_wrong_operation_is_rejected(){
        let dir=std::env::temp_dir();
        let path=dir.join(format!("shuvi-evidence-{}.json",Uuid::new_v4()));
        let guard=PrivateEvidence(path.clone());
        fs::write(&path,serde_json::to_vec(&serde_json::json!({
          "protocol_version":1,"operation":"scene.inspect","status":"succeeded",
          "authenticated_bridge_roundtrip":false,"mutations_allowed":false,
          "rendering_allowed":false,"data":{}
        })).unwrap()).unwrap();
        assert!(verify_payload(&path,&dir,"scene.inspect").is_err());
        fs::write(&path,serde_json::to_vec(&serde_json::json!({
          "protocol_version":1,"operation":"scene.inspect","status":"succeeded",
          "authenticated_bridge_roundtrip":true,"mutations_allowed":false,
          "rendering_allowed":false,"data":{}
        })).unwrap()).unwrap();
        assert!(verify_payload(&path,&dir,"system.capabilities").is_err());
        assert!(verify_payload(&path,&dir,"scene.inspect").is_ok());
        drop(guard);
    }
}
