use crate::after_effects_transport::{self,Request};
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::Path,process::Command,time::{Duration,Instant}};
use tokio::time::sleep;

const MAX_TIMEOUT_MS:u64=120_000;
const POLL_MS:u64=100;
const MAX_PENDING_JOBS:usize=64;
static DISPATCH_IO:std::sync::Mutex<()>=std::sync::Mutex::new(());

fn regular_file(path:&Path,label:&str)->Result<(),String>{
    if !path.is_absolute(){return Err(format!("{label} must be an absolute path."));}
    let meta=fs::symlink_metadata(path).map_err(|e|format!("{label} unavailable: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err(format!("{label} must be a regular non-symlink file."));}
    Ok(())
}

#[cfg(target_os="windows")]
fn trusted_afterfx_exe(path:&Path)->Result<(),String>{
    regular_file(path,"After Effects executable")?;
    if !path.file_name().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("afterfx.exe")){
        return Err("After Effects executable must be AfterFX.exe.".into());
    }
    let program_files=std::env::var_os("ProgramFiles").ok_or("ProgramFiles environment variable unavailable.")?;
    let adobe_root=Path::new(&program_files).join("Adobe");
    let root=fs::canonicalize(&adobe_root).map_err(|e|format!("Adobe Program Files root unavailable: {e}"))?;
    let exe=fs::canonicalize(path).map_err(|e|format!("After Effects executable cannot be canonicalized: {e}"))?;
    if !exe.starts_with(&root){return Err("After Effects executable is outside the trusted Program Files/Adobe root.".into());}
    let support=exe.parent().and_then(|v|v.file_name()).and_then(|v|v.to_str()).unwrap_or("");
    let product=exe.parent().and_then(Path::parent).and_then(|v|v.file_name()).and_then(|v|v.to_str()).unwrap_or("");
    if !support.eq_ignore_ascii_case("Support Files")||!product.starts_with("Adobe After Effects"){
        return Err("After Effects executable does not match the expected Adobe After Effects install layout.".into());
    }
    Ok(())
}

#[cfg(not(target_os="windows"))]
fn trusted_afterfx_exe(_path:&Path)->Result<(),String>{
    Err("After Effects execution is currently restricted to trusted Windows Adobe installs.".into())
}

fn render_output_evidence(result:&Value)->Value{
    let Some(outputs)=result.get("outputs").and_then(Value::as_array) else {
        return json!({"desktop_outputs_verified":false,"reason":"Host render result has no output inventory.","media_parse_verified":false,"media_decode_verified":false});
    };
    if outputs.is_empty()||outputs.len()>64{
        return json!({"desktop_outputs_verified":false,"reason":"Host render output inventory is empty or oversized.","media_parse_verified":false,"media_decode_verified":false});
    }
    let mut observed=Vec::new();let mut desktop_verified=true;let mut parse_verified=true;
    for output in outputs{
        let path=output.get("output_file").and_then(Value::as_str).unwrap_or("");
        let expected_size=output.get("size_bytes").and_then(Value::as_u64);
        let host_done=output.get("done").and_then(Value::as_bool)==Some(true);
        let host_changed=output.get("output_changed").and_then(Value::as_bool)==Some(true);
        let p=Path::new(path);
        let meta=if p.is_absolute(){fs::symlink_metadata(p).ok()}else{None};
        let regular=meta.as_ref().is_some_and(|m|m.is_file()&&!m.file_type().is_symlink());
        let size=meta.as_ref().map(|m|m.len());
        let item_verified=host_done&&host_changed&&regular&&size.is_some_and(|v|v>0)&&size==expected_size;
        if !item_verified{desktop_verified=false;}
        let parse=if item_verified {
            crate::after_effects_media_validation::validate(path,size)
        } else {
            json!({"output_file":path,"media_parse_verified":false,"media_decode_verified":false,
                "error":"Desktop output evidence failed before parsing."})
        };
        let item_parse=parse.get("media_parse_verified").and_then(Value::as_bool)==Some(true);
        if !item_parse{parse_verified=false;}
        observed.push(json!({"output_file":path,"host_done":host_done,"host_changed":host_changed,
            "expected_size_bytes":expected_size,"desktop_size_bytes":size,"regular_non_symlink":regular,
            "desktop_verified":item_verified,"media_validation":parse}));
    }
    json!({"desktop_outputs_verified":desktop_verified,"media_parse_verified":parse_verified,"media_decode_verified":false,
        "outputs":observed,
        "note":"Host DONE + exact desktop file metadata + bounded structural parsing are independent evidence. Byte-stream decode remains unverified."})
}

fn mogrt_output_evidence(result:&Value)->Value{
    let path=result.get("output_file").and_then(Value::as_str).unwrap_or("");
    let expected_size=result.get("size_bytes").and_then(Value::as_u64);
    let host_exists=result.get("output_exists").and_then(Value::as_bool)==Some(true);
    let p=Path::new(path);
    let extension_ok=p.extension().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("mogrt"));
    let meta=if p.is_absolute()&&extension_ok{fs::symlink_metadata(p).ok()}else{None};
    let regular=meta.as_ref().is_some_and(|m|m.is_file()&&!m.file_type().is_symlink());
    let size=meta.as_ref().map(|m|m.len());
    let verified=host_exists&&regular&&size.is_some_and(|v|v>0)&&size==expected_size;
    json!({"desktop_mogrt_verified":verified,"output_file":path,"expected_size_bytes":expected_size,
        "desktop_size_bytes":size,"regular_non_symlink":regular,"extension_ok":extension_ok,
        "note":"Desktop metadata verifies the exact non-empty .mogrt file and host-reported size; semantic template behavior still requires Premiere/AE runtime review."})
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

fn job_path(workspace:&Path,request_id:&str,suffix:&str)->std::path::PathBuf{
    workspace.join(format!("shuvi-ae-{request_id}.{suffix}"))
}

pub fn pending_jobs(workspace:&Path,reconcile_receipts:bool)->Result<Value,String>{
    if !workspace.is_absolute(){return Err("After Effects workspace must be absolute.".into());}
    if !workspace.exists(){return Ok(json!({"jobs":[],"blocking_count":0,"reconciled_count":0}));}
    if !workspace.is_dir(){return Err("After Effects workspace is not a directory.".into());}
    let mut request_paths=Vec::new();
    for entry in fs::read_dir(workspace).map_err(|e|format!("Could not inspect After Effects job workspace: {e}"))?{
        let entry=entry.map_err(|e|e.to_string())?;
        if !entry.file_type().map_err(|e|e.to_string())?.is_file(){continue;}
        let name=entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("shuvi-ae-")&&name.ends_with(".request.json"){
            request_paths.push(entry.path());
            if request_paths.len()>MAX_PENDING_JOBS{return Err("After Effects unresolved job count exceeds safety bound; inspect workspace manually.".into());}
        }
    }
    let mut jobs=Vec::new();let mut blocking=0usize;let mut reconciled=0usize;
    for request_path in request_paths{
        let raw=crate::read_file_bytes_bounded(&request_path,512*1024,"After Effects pending request")?;
        let request:Request=match serde_json::from_slice(&raw){
            Ok(v)=>v,
            Err(_)=>{
                blocking+=1;jobs.push(json!({"request_path":request_path,"state":"corrupt_request","reconciled":false}));continue;
            }
        };
        if let Err(error)=request.validate(){
            blocking+=1;jobs.push(json!({"request_id":request.request_id,"state":"invalid_request","error":error,"reconciled":false}));continue;
        }
        let expected_request=job_path(workspace,&request.request_id,"request.json");
        if expected_request!=request_path{
            blocking+=1;jobs.push(json!({"request_id":request.request_id,"state":"request_path_identity_mismatch","reconciled":false}));continue;
        }
        let receipt_path=job_path(workspace,&request.request_id,"receipt.json");
        let runner_path=job_path(workspace,&request.request_id,"runner.jsx");
        if !receipt_path.is_file(){
            blocking+=1;jobs.push(json!({"request_id":request.request_id,"action":request.action,
                "mutation":request.is_mutating(),"state":"receipt_missing","retry_safe":false,"reconciled":false}));continue;
        }
        let receipt_bytes=crate::read_file_bytes_bounded(&receipt_path,512*1024,"After Effects late receipt")?;
        match after_effects_transport::parse_receipt(&receipt_bytes,&request){
            Ok(receipt)=>{
                let verification=receipt.result.as_ref().and_then(|v|v.get("verification_status")).and_then(Value::as_str)
                    .unwrap_or(if receipt.ok{"accepted_unverified"}else{"host_error"});
                let render_evidence=if request.action=="render_queue" {
                    receipt.result.as_ref().map(render_output_evidence)
                }else{None};
                let render_verified=render_evidence.as_ref().is_some_and(|v|
                    v.get("desktop_outputs_verified").and_then(Value::as_bool)==Some(true)
                    && v.get("media_parse_verified").and_then(Value::as_bool)==Some(true));
                let mogrt_evidence=if request.action=="export_mogrt" {
                    receipt.result.as_ref().map(mogrt_output_evidence)
                }else{None};
                let mogrt_verified=mogrt_evidence.as_ref().and_then(|v|v.get("desktop_mogrt_verified")).and_then(Value::as_bool)==Some(true);
                let post_verified=if request.action=="render_queue" {
                    verification=="verified_render_completion"&&render_verified
                }else if request.action=="export_mogrt" {
                    verification=="verified_mogrt_file_readback"&&mogrt_verified
                }else{verification.starts_with("verified_")};
                let host_retry_safe=receipt.result.as_ref().and_then(|v|v.get("retry_safe")).and_then(Value::as_bool)
                    .unwrap_or(!request.is_mutating());
                if reconcile_receipts{
                    cleanup_job_files(&request_path,&runner_path);reconciled+=1;
                }else{blocking+=1;}
                jobs.push(json!({"request_id":request.request_id,"action":request.action,"mutation":request.is_mutating(),
                    "state":"receipt_available","host_receipt_ok":receipt.ok,"host_version":receipt.host_version,
                    "verification_status":verification,"post_state_verified":post_verified,"host_retry_safe":host_retry_safe,
                    "render_output_evidence":render_evidence,
                    "mogrt_output_evidence":mogrt_evidence,
                    "result":receipt.result,"host_error":receipt.error,"retry_safe":false,
                    "reconciled":reconcile_receipts,
                    "note":"Late receipt resolves dispatch completion, but retry remains disabled until the caller inspects current host state."}));
            }
            Err(error)=>{
                blocking+=1;jobs.push(json!({"request_id":request.request_id,"action":request.action,
                    "state":"invalid_receipt","error":error,"retry_safe":false,"reconciled":false}));
            }
        }
    }
    Ok(json!({"jobs":jobs,"blocking_count":blocking,"reconciled_count":reconciled,
        "new_dispatch_allowed":blocking==0,
        "note":"Any unresolved request blocks new After Effects dispatch. Valid late receipts may be explicitly reconciled; missing/corrupt receipts remain blocking."}))
}

pub async fn execute(
    afterfx_exe:&Path,
    core_script:&Path,
    workspace:&Path,
    request:&Request,
    timeout_ms:u64,
)->Result<Value,String>{
    request.validate()?;
    trusted_afterfx_exe(afterfx_exe)?;
    regular_file(core_script,"After Effects core adapter")?;
    if !workspace.is_absolute(){return Err("After Effects workspace must be absolute.".into());}
    fs::create_dir_all(workspace).map_err(|e|format!("Could not create After Effects workspace: {e}"))?;
    if !workspace.is_dir(){return Err("After Effects workspace is not a directory.".into());}

    let timeout_ms=timeout_ms.clamp(1_000,MAX_TIMEOUT_MS);
    let dispatch_guard=DISPATCH_IO.lock().map_err(|_|"After Effects dispatch lock unavailable.")?;
    let pending=pending_jobs(workspace,false)?;
    if pending.get("blocking_count").and_then(Value::as_u64).unwrap_or(0)>0{
        return Err("An earlier After Effects request is unresolved or has an unacknowledged late receipt; run after_effects_pending_jobs before dispatching another action.".into());
    }
    let checkpoint=if request.is_mutating(){
        let path=request.expected_project_file.as_deref().ok_or("Mutating AE request missing project expectation.")?;
        Some(crate::after_effects_checkpoint::create(Path::new(path),crate::now_ms())?)
    }else{None};
    let save_before=if request.action=="save_project" {
        let path=request.expected_project_file.as_deref().ok_or("After Effects save requires expected project file.")?;
        Some(crate::after_effects_project_persistence::fingerprint(path)?)
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
    drop(dispatch_guard);

    let started=Instant::now();
    let mut last_parse_error:Option<String>=None;
    loop{
        if plan.receipt_path.is_file(){
            match crate::read_file_bytes_bounded(&plan.receipt_path,512*1024,"After Effects receipt")
                .and_then(|bytes|after_effects_transport::parse_receipt(&bytes,request))
            {
                Ok(receipt)=>{
                    cleanup_job_files(&plan.request_path,&plan.runner_path);
                    let mut verification=receipt.result.as_ref()
                        .and_then(|v|v.get("verification_status")).and_then(Value::as_str)
                        .unwrap_or(if receipt.ok{"accepted_unverified"}else{"host_error"}).to_string();
                    let mut persistence_evidence:Option<Value>=None;
                    let save_persistence_verified=if request.action=="save_project" {
                        let path=request.expected_project_file.as_deref().ok_or("After Effects save lost expected project identity.")?;
                        let native_accepted=receipt.result.as_ref().and_then(|v|v.get("native_accepted")).and_then(Value::as_bool)==Some(true);
                        let reported_path=receipt.result.as_ref().and_then(|v|v.get("project_file")).and_then(Value::as_str).unwrap_or("");
                        let evidence=match(save_before.as_ref(),crate::after_effects_project_persistence::fingerprint(path)){
                            (Some(before),Ok(after))=>crate::after_effects_project_persistence::assess(before,&after,native_accepted,reported_path),
                            (_,Err(error))=>json!({"persistence_verified":false,"verification_status":"accepted_unverified",
                                "retry_safe":false,"after_error":error}),
                            (None,_)=>json!({"persistence_verified":false,"verification_status":"accepted_unverified",
                                "retry_safe":false,"before_error":"Missing pre-save fingerprint."})
                        };
                        let verified=evidence.get("persistence_verified").and_then(Value::as_bool)==Some(true);
                        if verified {verification="verified_file_persistence".into();}
                        persistence_evidence=Some(evidence);
                        verified
                    }else{false};
                    let render_evidence=if request.action=="render_queue" {
                        receipt.result.as_ref().map(render_output_evidence)
                    }else{None};
                    let render_verified=render_evidence.as_ref().is_some_and(|v|
                    v.get("desktop_outputs_verified").and_then(Value::as_bool)==Some(true)
                    && v.get("media_parse_verified").and_then(Value::as_bool)==Some(true));
                    let mogrt_evidence=if request.action=="export_mogrt" {
                        receipt.result.as_ref().map(mogrt_output_evidence)
                    }else{None};
                    let mogrt_verified=mogrt_evidence.as_ref().and_then(|v|v.get("desktop_mogrt_verified")).and_then(Value::as_bool)==Some(true);
                    let post_verified=if request.action=="save_project"{save_persistence_verified}
                        else if request.action=="render_queue"{verification=="verified_render_completion"&&render_verified}
                        else if request.action=="export_mogrt"{verification=="verified_mogrt_file_readback"&&mogrt_verified}
                        else{verification.starts_with("verified_")};
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
                        "project_persistence_evidence":persistence_evidence,
                        "render_output_evidence":render_evidence,
                        "mogrt_output_evidence":mogrt_evidence,
                        "host_retry_safe":host_retry_safe,
                        "checkpoint":checkpoint,
                        "checkpoint_recovery_verified":false,
                        "retry_safe":retry_safe,
                        "runtime_verified":false,
                        "note":"This is an execution receipt, not a current-source runtime acceptance attestation. Mutations require host readback; save_project additionally requires independent on-disk project change evidence."
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
