use crate::after_effects_transport::{self,Request};
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::Path,process::Command,time::{Duration,Instant}};
use tokio::time::sleep;

const MAX_TIMEOUT_MS:u64=120_000;
const POLL_MS:u64=100;
const MAX_PENDING_JOBS:usize=64;
static DISPATCH_IO:std::sync::Mutex<()>=std::sync::Mutex::new(());
static CANCEL_IO:std::sync::Mutex<()>=std::sync::Mutex::new(());

fn regular_file(path:&Path,label:&str)->Result<(),String>{
    if !path.is_absolute(){return Err(format!("{label} must be an absolute path."));}
    let meta=fs::symlink_metadata(path).map_err(|e|format!("{label} unavailable: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err(format!("{label} must be a regular non-symlink file."));}
    for ancestor in path.ancestors(){
        let metadata=fs::symlink_metadata(ancestor).map_err(|e|format!("{label} path unavailable: {e}"))?;
        if metadata.file_type().is_symlink(){return Err(format!("{label} path contains a symlink."));}
        #[cfg(target_os="windows")]
        {use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes()&0x400!=0{return Err(format!("{label} path contains a reparse point."));}}
    }
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

fn trusted_preset_bytes(request:&Request)->Result<(Vec<u8>,Value),String>{
    let project=Path::new(request.expected_project_file.as_deref().ok_or("Preset requires exact project path.")?);
    let source=Path::new(request.args.get("preset_file").and_then(Value::as_str).ok_or("Preset path missing.")?);
    regular_file(source,"Animation preset")?;
    let root=project.parent().ok_or("Project parent unavailable.")?.join("Shuvi Assets").join("Presets");
    for path in source.ancestors(){
        let meta=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){return Err("Animation preset path contains a symlink.".into());}
        #[cfg(target_os="windows")]
        {use std::os::windows::fs::MetadataExt;
            if meta.file_attributes()&0x400!=0{return Err("Animation preset path contains a reparse point.".into());}}
    }
    let canonical_root=fs::canonicalize(&root).map_err(|_|"Trusted project preset root is unavailable: use <project folder>/Shuvi Assets/Presets.")?;
    let canonical=fs::canonicalize(source).map_err(|e|e.to_string())?;
    if !canonical.starts_with(&canonical_root){return Err("Animation preset is outside the trusted project asset root.".into());}
    let before=fs::symlink_metadata(source).map_err(|e|e.to_string())?;
    if before.len()==0||before.len()>16*1024*1024{return Err("Animation preset must be non-empty and at most 16 MiB.".into());}
    let bytes=crate::read_file_bytes_bounded(source,16*1024*1024,"Animation preset")?;
    let after=fs::symlink_metadata(source).map_err(|e|e.to_string())?;
    if bytes.len() as u64!=before.len()||before.len()!=after.len()||before.modified().ok()!=after.modified().ok(){
        return Err("Animation preset changed while staging; no host mutation dispatched.".into());
    }
    Ok((bytes,json!({"original_file":source,"trusted_asset_root":canonical_root,"size_bytes":before.len(),
        "regular_non_symlink":true,"preset_semantics_verified":false})))
}
fn render_output_evidence(result:&Value)->Value{
    let Some(outputs)=result.get("outputs").and_then(Value::as_array) else {
        return json!({"desktop_outputs_verified":false,"reason":"Host render result has no output inventory.","media_parse_verified":false,"media_decode_verified":false,"media_probe_available":crate::after_effects_media_validation::detect_probe().is_some(),"media_probe_evidence":[],"render_completion_verified":false});
    };
    if outputs.is_empty()||outputs.len()>64{
        return json!({"desktop_outputs_verified":false,"reason":"Host render output inventory is empty or oversized.","media_parse_verified":false,"media_decode_verified":false,"media_probe_available":crate::after_effects_media_validation::detect_probe().is_some(),"media_probe_evidence":[],"render_completion_verified":false});
    }
    let mut observed=Vec::new();let mut desktop_verified=true;let mut parse_verified=true;
    let probe_available=crate::after_effects_media_validation::detect_probe().is_some();
    let probe_deadline=Instant::now()+Duration::from_secs(15);
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
            crate::after_effects_media_validation::validate_with_budget(path,size,probe_deadline.saturating_duration_since(Instant::now()))
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
        "media_probe_available":probe_available,"media_probe_evidence":observed.iter().map(|v|v["media_validation"]["media_probe_evidence"].clone()).collect::<Vec<_>>(),
        "render_completion_verified":desktop_verified&&result.get("render_completion_verified").and_then(Value::as_bool)==Some(true),
        "outputs":observed,
        "note":"Host DONE, desktop files, structural markers and trusted probe metadata are separate evidence. Metadata parse never proves byte-stream decode or playability."})
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
fn valid_request_id(value:&str)->bool{
    !value.is_empty()&&value.len()<=80&&value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
}

pub fn cancel_render(workspace:&Path,request_id:&str)->Result<Value,String>{
    let _guard=CANCEL_IO.lock().map_err(|_|"After Effects cancellation lock unavailable.")?;
    if !workspace.is_absolute()||!workspace.is_dir(){return Err("After Effects job workspace is unavailable.".into());}
    if !valid_request_id(request_id){return Err("Invalid After Effects request_id.".into());}
    let request_path=job_path(workspace,request_id,"request.json");
    if !request_path.is_file(){return Err("No unresolved After Effects request exists for this request_id.".into());}
    regular_file(&request_path,"After Effects cancellation request")?;
    let raw=crate::read_file_bytes_bounded(&request_path,512*1024,"After Effects cancellation request")?;
    let request:Request=serde_json::from_slice(&raw).map_err(|_|"After Effects request JSON is corrupt.")?;
    request.validate()?;
    if request.request_id!=request_id{return Err("After Effects cancellation request identity mismatch.".into());}
    if request.action!="render_queue"{return Err("Only After Effects render_queue supports cooperative native cancellation.".into());}
    let receipt_path=job_path(workspace,request_id,"receipt.json");
    if receipt_path.is_file(){
        regular_file(&receipt_path,"After Effects cancellation receipt")?;
        let bytes=crate::read_file_bytes_bounded(&receipt_path,512*1024,"After Effects cancellation receipt")?;
        if after_effects_transport::parse_receipt(&bytes,&request).is_ok(){
            return Ok(json!({"request_id":request_id,"state":"already_finished","cancel_request_written":false,
                "native_stop_verified":false,"retry_safe":false,"automatic_rollback_performed":false}));
        }
        // A partial or invalid receipt is not terminal evidence; a scoped stop request remains safe.
    }
    let cancel_path=job_path(workspace,request_id,"cancel");
    if cancel_path.exists(){
        regular_file(&cancel_path,"After Effects cancel marker")?;
        let meta=fs::symlink_metadata(&cancel_path).map_err(|e|e.to_string())?;
        if !meta.is_file()||meta.file_type().is_symlink(){return Err("Existing After Effects cancel marker is not a regular file.".into());}
        let bytes=crate::read_file_bytes_bounded(&cancel_path,16*1024,"After Effects cancel marker")?;
        let marker:Value=serde_json::from_slice(&bytes).map_err(|_|"Existing After Effects cancel marker is corrupt.")?;
        if marker.get("request_id").and_then(Value::as_str)!=Some(request_id)
            ||marker.get("schema_version").and_then(Value::as_u64)!=Some(1)
            ||marker.get("expected_project_file").and_then(Value::as_str)!=request.expected_project_file.as_deref()
            ||marker.get("expected_project_revision").and_then(Value::as_u64)!=request.expected_project_revision
            ||marker.get("requested_at_ms").and_then(Value::as_u64).is_none_or(|v|v==0)
            ||marker.get("scope").and_then(Value::as_str)!=Some("render_queue_status_boundary_cooperative_stop"){
            return Err("Existing After Effects cancel marker identity mismatch.".into());
        }
        return Ok(json!({"request_id":request_id,"state":"cancel_already_requested","cancel_request_written":true,
            "native_stop_verified":false,"retry_safe":false,"automatic_rollback_performed":false,"cancel_path":cancel_path}));
    }
    let marker=json!({"schema_version":1,"request_id":request_id,"requested_at_ms":crate::now_ms(),
        "expected_project_file":request.expected_project_file,"expected_project_revision":request.expected_project_revision,
        "scope":"render_queue_status_boundary_cooperative_stop"});
    let bytes=serde_json::to_vec_pretty(&marker).map_err(|e|e.to_string())?;
    let temporary=workspace.join(format!("shuvi-ae-{request_id}.cancel-{}.tmp",uuid::Uuid::new_v4()));
    write_new(&temporary,&bytes,"After Effects cancel staging marker")?;
    // Publish only fully flushed bytes, without replacing an existing marker.
    let published=fs::hard_link(&temporary,&cancel_path);
    let _=fs::remove_file(&temporary);
    published.map_err(|e|format!("Could not atomically publish After Effects cancel marker: {e}"))?;
    Ok(json!({"request_id":request_id,"state":"cancel_requested","cancel_request_written":true,
        "native_stop_verified":false,"retry_safe":false,"automatic_rollback_performed":false,"cancel_path":cancel_path,
        "note":"The marker requests cooperative stop at an After Effects render status callback. It is not proof the native render has stopped."}))
}

fn cancellation_outcome(request:&Request,receipt:&after_effects_transport::Receipt)->(bool,bool){
    if request.action!="render_queue"||!receipt.ok{return (false,false);}
    let Some(result)=receipt.result.as_ref() else{return (false,false);};
    if result["render_cancel_verified"]!=true||result["cancel_observed"]!=true||result["cancel_requested"]!=true
        ||result["queue_rendering_after"]!=false{return (false,false);}
    if result["verification_status"]=="verified_render_cancelled_before_start"&&result["render_started"]==false{
        return (true,false); // Prevented launch is distinct from stopping a running render.
    }
    if result["verification_status"]!="verified_render_cancelled"||result["render_started"]!=true
        ||result["render_stopped"]!=true||result["callbacks_restored"]!=true{return (false,false);}
    let Some(expected)=request.args.get("items").and_then(Value::as_array) else{return (false,false);};
    let Some(outputs)=result.get("outputs").and_then(Value::as_array) else{return (false,false);};
    if expected.is_empty()||expected.len()>64||expected.len()!=outputs.len(){return (false,false);}
    let mut indexes=std::collections::HashSet::new();
    for output in outputs{
        let Some(index)=output["queue_index"].as_u64() else{return (false,false);};
        if !indexes.insert(index){return (false,false);}
        let Some(spec)=expected.iter().find(|s|s["queue_index"].as_u64()==Some(index)) else{return (false,false);};
        if spec["comp_id"]!=output["comp_id"]||spec["comp_id"].as_u64().is_none_or(|v|v==0){return (false,false);}
        let (Some(want),Some(actual))=(spec["output_file"].as_str(),output["output_file"].as_str()) else{return (false,false);};
        if Path::new(want)!=Path::new(actual){return (false,false);}
    }
    let stopped=outputs.iter().any(|v|v["user_stopped"]==true);
    (stopped,stopped)
}

pub fn pending_jobs(workspace:&Path,reconcile_receipts:bool)->Result<Value,String>{
    if !workspace.is_absolute(){return Err("After Effects workspace must be absolute.".into());}
    if !workspace.exists(){return Ok(json!({"jobs":[],"blocking_count":0,"reconciled_count":0}));}
    if !workspace.is_dir(){return Err("After Effects workspace is not a directory.".into());}
    let mut request_paths=Vec::new();
    for entry in fs::read_dir(workspace).map_err(|e|format!("Could not inspect After Effects job workspace: {e}"))?{
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("shuvi-ae-")&&name.ends_with(".request.json"){
            request_paths.push(entry.path());
            if request_paths.len()>MAX_PENDING_JOBS{return Err("After Effects unresolved job count exceeds safety bound; inspect workspace manually.".into());}
        }
    }
    let mut jobs=Vec::new();let mut blocking=0usize;let mut reconciled=0usize;
    for request_path in request_paths{
        if let Err(error)=regular_file(&request_path,"After Effects pending request"){
            blocking+=1;jobs.push(json!({"request_path":request_path,"state":"unsafe_request_path","error":error,"reconciled":false}));continue;
        }
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
        let cancel_path=job_path(workspace,&request.request_id,"cancel");
        let cancel_requested=cancel_path.is_file();
        if !receipt_path.is_file(){
            blocking+=1;jobs.push(json!({"request_id":request.request_id,"action":request.action,
                "mutation":request.is_mutating(),
                "state":if cancel_requested&&request.action=="render_queue"{"cancel_requested_waiting_for_receipt"}else{"receipt_missing"},
                "cancel_requested":cancel_requested,"native_stop_verified":false,
                "retry_safe":false,"reconciled":false}));continue;
        }
        if let Err(error)=regular_file(&receipt_path,"After Effects late receipt"){
            blocking+=1;jobs.push(json!({"request_id":request.request_id,"state":"unsafe_receipt_path","error":error,"reconciled":false}));continue;
        }
        let receipt_bytes=crate::read_file_bytes_bounded(&receipt_path,512*1024,"After Effects late receipt")?;
        match after_effects_transport::parse_receipt(&receipt_bytes,&request){
            Ok(receipt)=>{
                let verification=receipt.result.as_ref().and_then(|v|v.get("verification_status")).and_then(Value::as_str)
                    .unwrap_or(if receipt.ok{"accepted_unverified"}else{"host_error"});
                let (cancel_verified,native_stop_verified)=cancellation_outcome(&request,&receipt);
                let render_evidence=if request.action=="render_queue"&&!cancel_verified&&verification=="verified_render_completion" {
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
                    !cancel_verified&&verification=="verified_render_completion"&&render_verified
                }else if request.action=="export_mogrt" {
                    verification=="verified_mogrt_file_readback"&&mogrt_verified
                }else{verification.starts_with("verified_")};
                let host_retry_safe=receipt.result.as_ref().and_then(|v|v.get("retry_safe")).and_then(Value::as_bool)
                    .unwrap_or(!request.is_mutating());
                if reconcile_receipts{
                    cleanup_job_files(&request_path,&runner_path);reconciled+=1;
                }else{blocking+=1;}
                jobs.push(json!({"request_id":request.request_id,"action":request.action,"mutation":request.is_mutating(),
                    "state":if cancel_verified{"cancelled"}else{"receipt_available"},"host_receipt_ok":receipt.ok,"host_version":receipt.host_version,
                    "verification_status":verification,"post_state_verified":post_verified,"cancel_requested":cancel_requested,
                    "native_stop_verified":native_stop_verified,"automatic_rollback_performed":false,"host_retry_safe":host_retry_safe,
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
    let plan=after_effects_transport::runner_plan(afterfx_exe,core_script,workspace,request)?;
    let preset_path=job_path(workspace,&request.request_id,"preset.ffx");
    if plan.request_path.exists()||plan.runner_path.exists()||plan.receipt_path.exists()||plan.cancel_path.exists()||preset_path.exists(){
        return Err("After Effects job identity collides with an existing request/runner/receipt/cancel marker; use a fresh request_id.".into());
    }
    let preset_source=if request.action=="apply_preset"{Some(trusted_preset_bytes(request)?)}else{None};
    let checkpoint=if request.is_mutating(){
        let path=request.expected_project_file.as_deref().ok_or("Mutating AE request missing project expectation.")?;
        Some(crate::after_effects_checkpoint::create_for_request(Path::new(path),crate::now_ms(),&request.request_id,
            request.expected_project_revision.ok_or("Checkpoint requires project revision.")?)?)
    }else{None};
    let save_before=if request.action=="save_project" {
        let path=request.expected_project_file.as_deref().ok_or("After Effects save requires expected project file.")?;
        Some(crate::after_effects_project_persistence::fingerprint(path)?)
    }else{None};

    let request_bytes=serde_json::to_vec_pretty(request).map_err(|e|e.to_string())?;
    let preset_evidence=if let Some((bytes,mut evidence))=preset_source{
        write_new(&preset_path,&bytes,"staged animation preset")?;
        if crate::read_file_bytes_bounded(&preset_path,16*1024*1024,"staged preset")?!=bytes{
            return Err("Staged preset bytes failed independent readback; no host mutation dispatched.".into());
        }
        evidence["staged_file"]=json!(preset_path);evidence["staged_bytes_verified"]=json!(true);
        Some(evidence)
    }else{None};
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
            match regular_file(&plan.receipt_path,"After Effects receipt")
                .and_then(|_|crate::read_file_bytes_bounded(&plan.receipt_path,512*1024,"After Effects receipt"))
                .and_then(|bytes|after_effects_transport::parse_receipt(&bytes,request))
            {
                Ok(receipt)=>{
                    cleanup_job_files(&plan.request_path,&plan.runner_path);
                    let cancel_requested=plan.cancel_path.is_file();

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
                    let (cancel_verified,native_stop_verified)=cancellation_outcome(&request,&receipt);
                    let render_evidence=if request.action=="render_queue"&&!cancel_verified&&verification=="verified_render_completion" {
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
                        else if request.action=="render_queue"{!cancel_verified&&verification=="verified_render_completion"&&render_verified}
                        else if request.action=="export_mogrt"{verification=="verified_mogrt_file_readback"&&mogrt_verified}
                        else{verification.starts_with("verified_")};
                    let host_retry_safe=receipt.result.as_ref()
                        .and_then(|v|v.get("retry_safe")).and_then(Value::as_bool)
                        .unwrap_or(!request.is_mutating());
                    let success=receipt.ok && (!request.is_mutating() || post_verified);
                    let retry_safe=if request.is_mutating(){receipt.ok&&post_verified&&host_retry_safe}else{true};
                    return Ok(json!({
                        "state":if cancel_verified{"cancelled"}else if success{"verified"}else if receipt.ok{"accepted_unverified"}else if request.is_mutating(){"uncertain"}else{"failed_read_only"},
                        "request_id":request.request_id,
                        "action":request.action,
                        "afterfx_pid":pid,
                        "host_receipt_ok":receipt.ok,
                        "host_version":receipt.host_version,
                        "result":receipt.result,
                        "host_error":receipt.error,
                        "verification_status":verification,
                        "post_state_verified":post_verified,
                        "cancel_requested":cancel_requested,
                        "native_stop_verified":native_stop_verified,
                        "automatic_rollback_performed":false,
                        "project_persistence_evidence":persistence_evidence,
                        "render_output_evidence":render_evidence,
                        "mogrt_output_evidence":mogrt_evidence,
                        "host_retry_safe":host_retry_safe,
                        "checkpoint":checkpoint,
                        "preset_file_evidence":preset_evidence,
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
                "preset_file_evidence":preset_evidence,
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
    #[test]fn presets_require_project_asset_root_and_bounded_regular_files(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-preset-{}",uuid::Uuid::new_v4()));
        let assets=root.join("Shuvi Assets/Presets");fs::create_dir_all(&assets).unwrap();
        let preset=assets.join("title.ffx");fs::write(&preset,b"test-preset-bytes").unwrap();
        let mut request=render_request(&root);request.action="apply_preset".into();
        request.args=json!({"preset_file":preset,"comp_id":12,"layer_id":34});
        request.validate().unwrap();
        assert_eq!(trusted_preset_bytes(&request).unwrap().0,b"test-preset-bytes");
        let outside=root.join("arbitrary.ffx");fs::write(&outside,b"other").unwrap();
        request.args["preset_file"]=json!(outside);assert!(trusted_preset_bytes(&request).is_err());
        fs::write(&preset,b"").unwrap();request.args["preset_file"]=json!(preset);
        assert!(trusted_preset_bytes(&request).is_err());
        request.args["preset_file"]=json!(root.join("wrong.jsx"));assert!(request.validate().is_err());
        let _=fs::remove_dir_all(root);
    }
    fn render_request(root:&Path)->Request{
        Request{schema_version:1,request_id:"render-1".into(),action:"render_queue".into(),
            expected_project_file:Some(root.join("edit.aep").to_string_lossy().into_owned()),expected_project_revision:Some(5),
            args:json!({"items":[{"queue_index":1,"comp_id":12,"output_file":root.join("out.mov")} ]})}
    }
    #[test]fn cancellation_marker_is_identity_bound_atomic_and_durable(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-cancel-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();let request=render_request(&root);
        let request_path=job_path(&root,&request.request_id,"request.json");
        fs::write(&request_path,serde_json::to_vec(&request).unwrap()).unwrap();
        let result=cancel_render(&root,&request.request_id).unwrap();
        assert_eq!(result["native_stop_verified"],false);
        let marker=job_path(&root,&request.request_id,"cancel");
        let content:Value=serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
        assert_eq!(content["expected_project_revision"],5);
        assert_eq!(content["expected_project_file"],json!(request.expected_project_file));
        assert_eq!(cancel_render(&root,&request.request_id).unwrap()["state"],"cancel_already_requested");
        let receipt=after_effects_transport::Receipt{schema_version:1,request_id:request.request_id.clone(),ok:true,
            host_version:Some("test-model".into()),error:None,result:Some(json!({"verification_status":"verified_render_cancelled_before_start",
                "render_cancel_verified":true,"cancel_requested":true,"cancel_observed":true,"queue_rendering_after":false,"render_started":false}))};
        fs::write(job_path(&root,&request.request_id,"receipt.json"),serde_json::to_vec(&receipt).unwrap()).unwrap();
        let jobs=pending_jobs(&root,true).unwrap();
        assert_eq!(jobs["jobs"][0]["state"],"cancelled");
        assert_eq!(jobs["jobs"][0]["native_stop_verified"],false);
        assert!(marker.is_file());assert!(!request_path.exists());
        let _=fs::remove_dir_all(root);
    }
    #[test]fn cancellation_outcome_requires_observation_and_exact_queue_identity(){
        let root=std::env::temp_dir();let request=render_request(&root);
        let result=json!({"verification_status":"verified_render_cancelled","render_cancel_verified":true,
            "cancel_requested":true,"cancel_observed":true,"queue_rendering_after":false,"render_started":true,
            "render_stopped":true,"callbacks_restored":true,
            "outputs":[{"queue_index":1,"comp_id":12,"output_file":root.join("out.mov"),"user_stopped":true}]});
        let mut receipt=after_effects_transport::Receipt{schema_version:1,request_id:request.request_id.clone(),ok:true,
            host_version:Some("test-model".into()),error:None,result:Some(result.clone())};
        assert_eq!(cancellation_outcome(&request,&receipt),(true,true));
        for (field,value) in [("cancel_observed",json!(false)),("queue_rendering_after",json!(true)),("render_stopped",json!(false))]{
            let mut bad=result.clone();bad[field]=value;receipt.result=Some(bad);
            assert_eq!(cancellation_outcome(&request,&receipt),(false,false));
        }
        let mut bad=result.clone();bad["outputs"][0]["comp_id"]=json!(99);receipt.result=Some(bad);
        assert_eq!(cancellation_outcome(&request,&receipt),(false,false));
    }
    #[test]fn partial_or_wrong_identity_receipt_is_not_already_finished(){
        for bytes in [b"{".as_slice(),br#"{"schema_version":1,"request_id":"other","ok":true,"result":{}}"#.as_slice()]{
            let root=std::env::temp_dir().join(format!("shuvi-ae-partial-{}",uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();let request=render_request(&root);
            fs::write(job_path(&root,&request.request_id,"request.json"),serde_json::to_vec(&request).unwrap()).unwrap();
            fs::write(job_path(&root,&request.request_id,"receipt.json"),bytes).unwrap();
            let result=cancel_render(&root,&request.request_id).unwrap();
            assert_eq!(result["state"],"cancel_requested");assert_eq!(result["native_stop_verified"],false);
            assert!(job_path(&root,&request.request_id,"cancel").is_file());let _=fs::remove_dir_all(root);
        }
    }
    #[test]fn invalid_output_inventory_retains_separate_negative_evidence(){
        for result in [json!({}),json!({"outputs":[]})]{
            let evidence=render_output_evidence(&result);
            assert_eq!(evidence["desktop_outputs_verified"],false);assert_eq!(evidence["media_parse_verified"],false);
            assert_eq!(evidence["render_completion_verified"],false);assert!(evidence["media_probe_evidence"].is_array());
        }
    }
    #[test]fn detection_never_promotes_runtime(){
        let value=detect_installs().unwrap();
        assert_eq!(value["runtime_verified"],false);
    }
}
