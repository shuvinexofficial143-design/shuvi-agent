use crate::after_effects_transport::{self,Request};
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::Path,process::Command,time::{Duration,Instant}};
use tokio::time::sleep;

const MAX_TIMEOUT_MS:u64=120_000;
const POLL_MS:u64=100;

fn regular_file(path:&Path,label:&str)->Result<(),String>{
    if !path.is_absolute(){return Err(format!("{label} must be an absolute path."));}
    let meta=fs::symlink_metadata(path).map_err(|e|format!("{label} unavailable: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err(format!("{label} must be a regular non-symlink file."));}
    Ok(())
}

fn write_new(path:&Path,bytes:&[u8],label:&str)->Result<(),String>{
    let mut file=OpenOptions::new().write(true).create_new(true).open(path)
        .map_err(|e|format!("Could not reserve {label}: {e}"))?;
    if let Err(error)=file.write_all(bytes).and_then(|_|file.sync_all()){
        let _=fs::remove_file(path);
        return Err(format!("Could not persist {label}: {error}"));
    }
    Ok(())
}

fn cleanup_job_files(request_path:&Path,runner_path:&Path){
    let _=fs::remove_file(request_path);
    let _=fs::remove_file(runner_path);
}

pub async fn execute(
    afterfx_exe:&Path,
    core_script:&Path,
    workspace:&Path,
    request:&Request,
    timeout_ms:u64,
)->Result<Value,String>{
    request.validate()?;
    regular_file(afterfx_exe,"After Effects executable")?;
    regular_file(core_script,"After Effects core adapter")?;
    if !workspace.is_absolute(){return Err("After Effects workspace must be absolute.".into());}
    fs::create_dir_all(workspace).map_err(|e|format!("Could not create After Effects workspace: {e}"))?;
    if !workspace.is_dir(){return Err("After Effects workspace is not a directory.".into());}

    let timeout_ms=timeout_ms.clamp(1_000,MAX_TIMEOUT_MS);
    let checkpoint=if request.is_mutating(){
        let path=request.expected_project_file.as_deref().ok_or("Mutating AE request missing project expectation.")?;
        Some(crate::after_effects_checkpoint::create(Path::new(path),crate::now_ms())?)
    }else{None};

    let plan=after_effects_transport::runner_plan(afterfx_exe,core_script,workspace,request)?;
    if plan.request_path.exists()||plan.runner_path.exists()||plan.receipt_path.exists(){
        return Err("After Effects job identity collides with an existing request/runner/receipt; use a fresh request_id.".into());
    }
    let request_bytes=serde_json::to_vec_pretty(request).map_err(|e|e.to_string())?;
    write_new(&plan.request_path,&request_bytes,"After Effects request")?;
    if let Err(error)=write_new(&plan.runner_path,plan.runner_script.as_bytes(),"After Effects runner"){
        let _=fs::remove_file(&plan.request_path);
        return Err(error);
    }

    let child=match Command::new(afterfx_exe).args(&plan.afterfx_arguments).spawn(){
        Ok(child)=>child,
        Err(error)=>{
            cleanup_job_files(&plan.request_path,&plan.runner_path);
            return Err(format!("After Effects dispatch did not start: {error}"));
        }
    };
    let pid=child.id();
    drop(child);

    let started=Instant::now();
    let mut last_parse_error:Option<String>=None;
    loop{
        if plan.receipt_path.is_file(){
            match crate::read_file_bytes_bounded(&plan.receipt_path,512*1024,"After Effects receipt")
                .and_then(|bytes|after_effects_transport::parse_receipt(&bytes,request))
            {
                Ok(receipt)=>{
                    cleanup_job_files(&plan.request_path,&plan.runner_path);
                    let verification=receipt.result.as_ref()
                        .and_then(|v|v.get("verification_status")).and_then(Value::as_str)
                        .unwrap_or(if receipt.ok{"accepted_unverified"}else{"host_error"});
                    let post_verified=verification.starts_with("verified_");
                    let host_retry_safe=receipt.result.as_ref()
                        .and_then(|v|v.get("retry_safe")).and_then(Value::as_bool)
                        .unwrap_or(!request.is_mutating());
                    let success=receipt.ok && (!request.is_mutating() || post_verified);
                    let retry_safe=if request.is_mutating(){receipt.ok&&post_verified&&host_retry_safe}else{true};
                    return Ok(json!({
                        "state":if success{"verified"}else if receipt.ok{"accepted_unverified"}else if request.is_mutating(){"uncertain"}else{"failed_read_only"},
                        "request_id":request.request_id,
                        "action":request.action,
                        "afterfx_pid":pid,
                        "host_receipt_ok":receipt.ok,
                        "host_version":receipt.host_version,
                        "result":receipt.result,
                        "host_error":receipt.error,
                        "verification_status":verification,
                        "post_state_verified":post_verified,
                        "host_retry_safe":host_retry_safe,
                        "checkpoint":checkpoint,
                        "checkpoint_recovery_verified":false,
                        "retry_safe":retry_safe,
                        "runtime_verified":false,
                        "note":"This is an execution receipt, not a current-source runtime acceptance attestation. Mutations are successful only with independent host readback."
                    }));
                }
                Err(error)=>last_parse_error=Some(error),
            }
        }
        if started.elapsed()>=Duration::from_millis(timeout_ms){
            return Ok(json!({
                "state":"execution_status_unknown",
                "request_id":request.request_id,
                "action":request.action,
                "afterfx_pid":pid,
                "receipt_path":plan.receipt_path,
                "checkpoint":checkpoint,
                "checkpoint_recovery_verified":false,
                "retry_safe":false,
                "runtime_verified":false,
                "last_receipt_error":last_parse_error,
                "note":"Timeout after After Effects dispatch is not proof that the action did not run. Inspect exact host state before any retry."
            }));
        }
        sleep(Duration::from_millis(POLL_MS)).await;
    }
}

#[cfg(target_os="windows")]
pub fn detect_installs()->Result<Value,String>{
    let program_files=std::env::var_os("ProgramFiles").ok_or("ProgramFiles environment variable unavailable.")?;
    let adobe=Path::new(&program_files).join("Adobe");
    if !adobe.is_dir(){return Ok(json!({"candidates":[],"runtime_verified":false}));}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(&adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(128){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("Adobe After Effects"){continue;}
        let exe=entry.path().join("Support Files").join("AfterFX.exe");
        if exe.is_file(){
            candidates.push(json!({"name":name,"afterfx_exe":exe,"source":"ProgramFiles/Adobe","runtime_verified":false}));
        }
    }
    Ok(json!({"candidates":candidates,"runtime_verified":false}))
}

#[cfg(not(target_os="windows"))]
pub fn detect_installs()->Result<Value,String>{
    Ok(json!({"candidates":[],"runtime_verified":false,"reason":"After Effects desktop detection is Windows-targeted in Shuvi."}))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn detection_never_promotes_runtime(){
        let value=detect_installs().unwrap();
        assert_eq!(value["runtime_verified"],false);
    }
}
