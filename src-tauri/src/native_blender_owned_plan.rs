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
use sha2::{Digest,Sha256};

const MAX_PLAN_BYTES:usize=64*1024;
const MAX_RECEIPT_BYTES:usize=1024*1024;
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
fn approved_plan_contract(plan:&Value,allow_render:bool)->Result<(usize,&str),String>{
    let timeout=plan.get("timeout_ms").and_then(Value::as_u64)
        .ok_or("Approved Blender plan needs a bounded timeout_ms.")?;
    if timeout==0||timeout>90_000{
        return Err("Approved Blender plan timeout must be within 1..90000 ms.".into());
    }
    let steps=plan.get("steps").and_then(Value::as_array)
        .filter(|s|!s.is_empty()&&s.len()<=6)
        .ok_or("Approved Blender plan must contain 1..6 typed steps.")?;
    let mut names=std::collections::HashSet::new();
    for step in steps{
        let name=step.get("name").and_then(Value::as_str)
            .ok_or("Approved Blender plan step has no name.")?;
        if name.is_empty()||name.len()>96||!names.insert(name){
            return Err("Approved Blender plan names must be unique and bounded.".into());
        }
        let operation=step.pointer("/request/operation").and_then(Value::as_str)
            .ok_or("Approved Blender plan step has no typed operation.")?;
        if operation=="render.execute"&&!allow_render{
            return Err("Blender plan render needs explicit owner permission.".into());
        }
    }
    let final_op=steps.last().and_then(|s|s.pointer("/request/operation"))
        .and_then(Value::as_str)
        .ok_or("Approved Blender plan final output operation is missing.")?;
    if !matches!(final_op,"file.checkpoint"|"render.execute"){
        return Err("Blender plan must end in an approved checkpoint/render.".into());
    }
    Ok((steps.len(),final_op))
}
fn approved_plan_hash_matches(response:&Value,expected:&str)->Result<(),String>{
    let actual=response.get("approved_plan_sha256").and_then(Value::as_str)
        .ok_or("Authenticated Blender plan response lacks exact input fingerprint.")?;
    if actual!=expected ||actual.len()!=64 ||!actual.bytes().all(|b|
        b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("Blender worker result does not match the exact approved plan bytes.".into());
    }
    Ok(())
}
fn native_plan_response(file:&Path,dir:&Path,output_dir:&Path,render:bool,
    expected_operation:&str,expected_steps:usize,expected_plan_sha256:&str)->Result<Value,String>{
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
    // The Python child hashes precisely the staged UTF-8 JSON bytes before
    // parsing. Rust hashes its independently prepared copy prior to launch;
    // the full approved plan, not only final operation/step count, is bound.
    approved_plan_hash_matches(&value,expected_plan_sha256)?;
    if value.get("final_operation").and_then(Value::as_str)!=Some(expected_operation)
        ||value.get("executed_steps").and_then(Value::as_u64)!=Some(expected_steps as u64){
        return Err("Blender completed operation/step count differs from exact approved plan.".into());
    }
    if value["final_operation"]=="render.execute"&&!render{
        return Err("Unapproved render operation in Blender response.".into());
    }
    let saved_path=value.pointer("/artifact/path").and_then(Value::as_str)
        .ok_or("Blender output evidence lacks saved artifact path.")?;
    let expected_extension=if expected_operation=="render.execute"{"png"}else{"blend"};
    if !Path::new(saved_path).extension().and_then(|ext|ext.to_str())
        .is_some_and(|ext|ext.eq_ignore_ascii_case(expected_extension)){
        return Err("Blender output file type does not match approved checkpoint/render operation.".into());
    }
    // Share exact existing final-artifact attestation with the legacy
    // Blender plan path: canonical approved folder, bounded file and SHA256.
    crate::blender_plan_worker::verify_output(&value,output_dir)?;
    Ok(json!({"status":"verified","worker":"blender",
        "full_plan_completed":true,"artifact":value["artifact"],
        "verified_by_native_sha256":true,
        "plan_steps":value["executed_steps"],"allow_render":render,
        "approved_plan_sha256":expected_plan_sha256}))
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
    let (expected_steps,expected_operation)=approved_plan_contract(plan,render)?;
    let (python,blender)=checked_app_paths(python_exe,blender_exe,blend_file,output_dir)?;
    // Reject an already-certified action or full private ledger BEFORE any
    // Blender mutation; every subsequent publication rechecks atomically.
    crate::native_blender_action_artifact::preflight_unused(app,action_id)?;
    let script=app.path().resource_dir()
        .map_err(|_|"Cannot locate fixed Blender plan script.")?
        .join("blender-worker").join("shuvi_blender_plan.py");
    if !script.is_file(){return Err("Fixed Blender plan resource unavailable.".into());}
    let root=app.path().app_local_data_dir()
        .map_err(|_|"Cannot locate private owned Blender plan data.")?
        .join("owned-blender-plan");
    let bytes=serde_json::to_vec(plan).map_err(|_|"Cannot encode declarative Blender plan.")?;
    let expected_plan_sha256=format!("{:x}",Sha256::digest(&bytes));
    let input=prepare_plan(&root,&bytes)?;
    let evidence=TemporaryFile(root.join(format!("{}.json",Uuid::new_v4())));
    let mut progress=crate::native_scheduler::worker_progress::ProgressChannel::create(
        &root,action_id,&expected_plan_sha256)?;
    let cwd=script.parent().ok_or("Bundled Blender plan script has no parent directory.")?;
    let mut args=vec![
        OsString::from("-B"),script.as_os_str().to_os_string(),
        OsString::from("--python-plan"),input.0.as_os_str().to_os_string(),
        OsString::from("--blender-exe"),blender.as_os_str().to_os_string(),
        OsString::from("--output-dir"),OsString::from(output_dir),
        OsString::from("--result-file"),evidence.0.as_os_str().to_os_string(),
        OsString::from("--worker-progress-file"),progress.pulse_path().as_os_str().to_os_string(),
        OsString::from("--worker-progress-key-file"),progress.key_path().as_os_str().to_os_string(),
        OsString::from("--worker-action-id"),OsString::from(action_id),
        OsString::from("--worker-plan-sha256"),OsString::from(expected_plan_sha256.as_str())
    ];
    if let Some(file)=blend_file{
        args.push(OsString::from("--blend-file"));
        args.push(OsString::from(file));
    }
    if render{args.push(OsString::from("--allow-render"));}
    // A missing native desktop lease must fail BEFORE reserving an output.
    if slot.is_none(){
        return Err("Original native desktop lease missing before resource reservation.".into());
    }
    // Persist exact project/output ownership before any Blender OS launch.
    // Crash/interrupted audit never automatically frees the output resource.
    crate::native_scheduler::resource_lanes::reserve_blender_plan(
        app,action_id,blend_file,output_dir)?;
    let lease=slot.take().ok_or("Original native desktop lease not held by approved Blender plan.")?;
    let mut child=crate::native_scheduler::owned_process::spawn_for_active_action(
        app,lease,action_id,"blender_run_plan",&python,&args,cwd,Duration::from_secs(120))?;
    let tracked=crate::native_scheduler::owned_process::RegisteredOwnedPid::start(state,child.pid())?;
    let result=child.wait_bounded_with_host_budget_and_progress(
        state,||progress.observe());
    // Do not restore native lease until all Job Object descendants are gone.
    let recovered=child.reclaim_terminal_lease()?;
    *slot=Some(recovered);
    drop(tracked);
    let status=result?;
    if status.phase!="exited"||status.exit_code!=Some(0)||!status.descendants_contained{
        return Err("Owned Blender plan cancelled/failed/timed out; inspect Blender output before retry.".into());
    }
    // Actual worker-side ACK is independently authenticated and action-bound.
    // Supervisor ticks and process exit cannot satisfy this check.
    progress.require_verified_artifact_ack()?;
    let verified=native_plan_response(&evidence.0,&root,
        Path::new(output_dir),render,expected_operation,expected_steps,
        &expected_plan_sha256)?;
    // Bind the verified worker artifact to the exact scheduled UUID before
    // the outer native action audit. No file hash or PID alone is an audit.
    crate::native_blender_action_artifact::record_verified(app,action_id,&verified)?;
    Ok(verified)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn exact_approved_plan_hash_blocks_stale_or_substituted_result(){
        let first=serde_json::json!({"steps":[{"name":"cube","request":{"operation":"file.checkpoint"}}]});
        let second=serde_json::json!({"steps":[{"name":"sphere","request":{"operation":"file.checkpoint"}}]});
        let first_hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&first).unwrap()));
        let second_hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&second).unwrap()));
        assert_ne!(first_hash,second_hash);
        let response=serde_json::json!({"approved_plan_sha256":first_hash});
        assert!(approved_plan_hash_matches(&response,&first_hash).is_ok());
        assert!(approved_plan_hash_matches(&response,&second_hash).is_err());
        assert!(approved_plan_hash_matches(&serde_json::json!({}),&first_hash).is_err());
        assert!(approved_plan_hash_matches(
            &serde_json::json!({"approved_plan_sha256":first_hash.to_uppercase()}),&first_hash).is_err());
    }
    #[test]
    fn exact_approved_plan_preflight_rejects_unknown_final_operation_and_unapproved_render(){
        let valid=json!({"timeout_ms":90_000,"steps":[{"name":"save",
            "request":{"operation":"file.checkpoint"}}]});
        assert_eq!(approved_plan_contract(&valid,false).unwrap(),(1,"file.checkpoint"));
        assert!(approved_plan_contract(&json!({"steps":[]}),false).is_err());
        assert!(approved_plan_contract(&json!({"timeout_ms":90_001,"steps":[
            {"name":"save","request":{"operation":"file.checkpoint"}}]}),false).is_err());
        let render=json!({"timeout_ms":15_000,"steps":[
            {"name":"frame","request":{"operation":"render.execute"}}]});
        assert!(approved_plan_contract(&render,false).is_err());
        assert_eq!(approved_plan_contract(&render,true).unwrap(),(1,"render.execute"));
        let duplicates=json!({"timeout_ms":15_000,"steps":[
            {"name":"save","request":{"operation":"scene.inspect"}},
            {"name":"save","request":{"operation":"file.checkpoint"}}]});
        assert!(approved_plan_contract(&duplicates,false).is_err());
    }
    #[test]
    fn authenticated_response_cannot_substitute_other_final_operation_or_step_count(){
        let dir=std::env::temp_dir().join(format!("shuvi-bind-operation-{}",Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let response=dir.join("receipt.json");
        fs::write(&response,serde_json::to_vec(&json!({
            "protocol_version":1,"status":"verified","complete":true,
            "authenticated_blender_plan":true,"destructive_allowed":false,
            "render_approved":true,"executed_steps":2,
            "final_operation":"render.execute","artifact":{}
        })).unwrap()).unwrap();
        // Both fail before inspecting absent artifact bytes or trusting success.
        assert!(native_plan_response(&response,&dir,&dir,true,"file.checkpoint",2,&"0".repeat(64)).is_err());
        assert!(native_plan_response(&response,&dir,&dir,true,"render.execute",1,&"0".repeat(64)).is_err());
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn correct_hash_of_wrong_output_type_never_satisfies_approved_render(){
        use sha2::{Digest,Sha256};
        let dir=std::env::temp_dir().join(format!("shuvi-plan-type-{}",Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let output=dir.join("wrong.blend");
        fs::write(&output,b"BLENDER fake checkpoint content").unwrap();
        let bytes=fs::metadata(&output).unwrap().len();
        let hash=format!("{:x}",Sha256::digest(fs::read(&output).unwrap()));
        let response=dir.join("response.json");
        fs::write(&response,serde_json::to_vec(&json!({
            "protocol_version":1,"status":"verified","complete":true,
            "authenticated_blender_plan":true,"destructive_allowed":false,
            "render_approved":true,"executed_steps":1,
            "final_operation":"render.execute",
            "artifact":{"path":output.to_str().unwrap(),"bytes":bytes,"sha256":hash}
        })).unwrap()).unwrap();
        assert!(native_plan_response(&response,&dir,&dir,true,"render.execute",1,&"0".repeat(64)).is_err());
        let _=fs::remove_dir_all(dir);
    }
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
        assert!(native_plan_response(&response,&dir,&dir,false,"file.checkpoint",1,&"0".repeat(64)).is_err());
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
        assert!(native_plan_response(&file,&root,&root,false,"file.checkpoint",2,&"0".repeat(64)).is_err());
        let _=fs::remove_file(&file);let _=fs::remove_dir(&root);
    }
}
