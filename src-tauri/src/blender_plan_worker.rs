//! Approved Blender declarative plan execution. The AI supplies JSON data,
//! never Python code, CLI scripts, arbitrary shell args or Blender expressions.
//! Every requested plan is preflighted by the separate Python Controller.
use std::{fs::{self,OpenOptions,File},io::{Read,Write},path::{Path,PathBuf},process::{Command,Stdio},sync::atomic::{AtomicBool,Ordering},thread,time::Duration};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use uuid::Uuid;
use crate::{blender_input_checkpoint,ActionState,register_managed_process,unregister_managed_process,terminate_managed_process_tree,terminate_registered_process_tree,managed_process_identity_matches,current_runtime_status,bounded_child};

struct PlanFile(PathBuf);
impl Drop for PlanFile {fn drop(&mut self){let _=fs::remove_file(&self.0);}}

pub(crate) fn verify_output(output:&Value,root:&Path)->Result<(),String>{
    let artifact=output.get("artifact").ok_or("Blender output artifact receipt missing.")?;
    let name=artifact.get("path").and_then(Value::as_str).ok_or("Blender output path missing.")?;
    let expected=artifact.get("sha256").and_then(Value::as_str).ok_or("Blender output SHA-256 missing.")?;
    let expected_size=artifact.get("bytes").and_then(Value::as_u64).ok_or("Blender output size missing.")?;
    let kind=artifact.get("format").and_then(Value::as_str).ok_or("Blender output format missing.")?;
    let canonical=Path::new(name).canonicalize().map_err(|_|"Blender output artifact is not accessible.".to_string())?;
    // A checkpoint must be reopened in a different authenticated, read-only
    // Blender child. This is evidence of actual persistence, not just a path.
    match (kind,canonical.extension().and_then(|s|s.to_str()).map(|s|s.to_ascii_lowercase()).as_deref()) {
        ("BLEND",Some("blend"))=>{
            let proof=output.get("checkpoint_reopen").ok_or("Independent Blender checkpoint reopen proof missing.")?;
            let fingerprint=proof.get("fingerprint").and_then(Value::as_str)
                .ok_or("Blender reopen scene fingerprint missing.")?;
            let mesh_fingerprint=proof.get("mesh_fingerprint").and_then(Value::as_str)
                .ok_or("Blender reopen mesh fingerprint missing.")?;
            if proof.get("verified").and_then(Value::as_bool)!=Some(true)
                || proof.get("read_only").and_then(Value::as_bool)!=Some(true)
                || !fingerprint.bytes().all(|c|c.is_ascii_hexdigit())
                || fingerprint.len()!=64
                || mesh_fingerprint.len()!=64
                || !mesh_fingerprint.bytes().all(|c|c.is_ascii_hexdigit())
                || proof.get("object_count").and_then(Value::as_u64).is_none_or(|n|n>1000)
                || proof.get("mesh_geometry_verified").and_then(Value::as_bool)!=Some(true)
                || ["proof_camera_verified","proof_key_light_verified"].iter().any(|key|
                    proof.get(*key).is_some_and(|value|!value.is_null() && !value.is_boolean()))
                || proof.get("active_camera_name").is_some_and(|value|
                    !value.is_null() && value.as_str().is_none_or(|s|s.len()>256))
                || proof.get("mesh_count").and_then(Value::as_u64).is_none_or(|n|n>64)
                || proof.get("total_vertices").and_then(Value::as_u64).is_none_or(|n|n>8192)
                || proof.get("total_faces").and_then(Value::as_u64).is_none_or(|n|n>8192)
                || proof.get("mesh_count").and_then(Value::as_u64)>proof.get("object_count").and_then(Value::as_u64) {
                return Err("Blender checkpoint cannot be verified after independent reopen.".into());
            }
        },
        ("PNG",Some("png"))=>{
            let w=artifact.get("width").and_then(Value::as_u64);
            let h=artifact.get("height").and_then(Value::as_u64);
            if !w.is_some_and(|n|(16..=512).contains(&n))
                || !h.is_some_and(|n|(16..=512).contains(&n))
                || artifact.get("color_mode").and_then(Value::as_str)!=Some("RGBA")
                || artifact.get("bit_depth").and_then(Value::as_u64)!=Some(8) {
                return Err("Blender PNG receipt lacks validated dimensions/encoding.".into());
            }
        },
        _=>return Err("Blender output format does not match the on-disk extension.".into()),
    }
    let parent=canonical.parent().ok_or("Blender output has no parent.")?;
    if parent!=root.canonicalize().map_err(|_|"Blender output directory is unavailable.".to_string())? {
        return Err("Blender output escaped the approved output folder.".into());
    }
    let meta=fs::symlink_metadata(&canonical).map_err(|_|"Blender output metadata is unavailable.".to_string())?;
    if !meta.file_type().is_file() || meta.len()!=expected_size || meta.len()>128*1024*1024{
        return Err("Blender output file type/size does not match the receipt.".into());
    }
    let mut f=File::open(&canonical).map_err(|_|"Blender output could not be verified.".to_string())?;
    // Never rely on a filename/worker JSON alone: independently parse the
    // fixed-length Blender or PNG signature and metadata before hashing.
    // This is a structure/header check, NOT a full Blender/PNG decoder.
    let prefix_len=if kind=="BLEND"{12usize}else{33usize};
    let mut prefix=[0u8;33];
    f.read_exact(&mut prefix[..prefix_len])
        .map_err(|_|"Blender output is too short for its claimed file format.".to_string())?;
    if kind=="BLEND" {
        if &prefix[..7]!=b"BLENDER"
            || !matches!(prefix[7],b'-'|b'_')
            || !matches!(prefix[8],b'v'|b'V')
            || !prefix[9..12].iter().all(u8::is_ascii_digit) {
            return Err("Blender output has an invalid .blend header.".into());
        }
    }else{
        let w=u32::from_be_bytes(prefix[16..20].try_into().map_err(|_|"Invalid PNG width.")?);
        let h=u32::from_be_bytes(prefix[20..24].try_into().map_err(|_|"Invalid PNG height.")?);
        if &prefix[..8]!=b"\x89PNG\r\n\x1a\n"
            || &prefix[8..12]!=13u32.to_be_bytes().as_slice()
            || &prefix[12..16]!=b"IHDR"
            || w as u64!=artifact["width"].as_u64().unwrap_or(0)
            || h as u64!=artifact["height"].as_u64().unwrap_or(0)
            || prefix[24]!=8 || prefix[25]!=6
            || prefix[26]!=0 || prefix[27]!=0 || prefix[28]>1 {
            return Err("Blender PNG IHDR does not match the claimed RGBA8 render.".into());
        }
    }
    let mut hasher=Sha256::new();
    hasher.update(&prefix[..prefix_len]);
    let mut buf=[0u8;65536];
    loop {
        let n=f.read(&mut buf).map_err(|_|"Blender artifact readback failed.".to_string())?;
        if n==0 {break;}
        hasher.update(&buf[..n]);
    }
    if format!("{:x}",hasher.finalize())!=expected.to_ascii_lowercase(){
        return Err("Blender artifact hash differs from exact worker receipt.".into());
    }
    if kind=="PNG" {
        crate::blender_png_integrity::validate(
            &canonical,artifact["width"].as_u64().ok_or("PNG width missing.")?,
            artifact["height"].as_u64().ok_or("PNG height missing.")?,
        )?;
    }
    Ok(())
}

pub(crate) fn execute(
    python_exe:&str,blender_exe:&str,blend_file:Option<&str>,
    expected_blend_sha256:Option<&str>,output_dir:&str,plan:&Value,allow_render:bool,
    script:&Path,work_dir:&Path,state:&ActionState,execution_action_id:Option<&str>
)->Result<Value,String>{
    // Lineage must be checked BEFORE launching Blender, not after mutations.
    let action_id=execution_action_id.ok_or("Blender mutation requires canonical native audit action UUID.")?;
    let parsed=Uuid::parse_str(action_id)
        .map_err(|_|"Blender native action UUID is invalid.")?;
    if parsed.to_string()!=action_id.to_ascii_lowercase(){
        return Err("Blender native action UUID must be canonical.".into());
    }
    if !script.is_file(){return Err("Fixed Blender plan adapter missing.".into());}
    let input_proof=blender_input_checkpoint::inspect(blend_file,expected_blend_sha256)?;
    let plan_lineage=crate::blender_plan_lineage::derive(plan)?;
    // One-off adapter must NOT allow a reserved material still: unlike
    // persistent broker, it has no independent material/camera/light preflight.
    crate::blender_plan_lineage::reserved_output_policy(
        plan,&plan_lineage,
        input_proof.as_ref().map(|x|x.canonical_path.as_str()),
        allow_render,false
    )?;
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
    if let Some(ref input)=input_proof{
        command.arg("--blend-file").arg(&input.canonical_path)
            .arg("--expected-blend-sha256").arg(&input.sha256);
    }
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
    // The Python launcher owns the Blender child. Remote Stop can terminate
    // that tree, and an independent watchdog enforces the native 4 GB ceiling.
    let hard_limit_triggered=AtomicBool::new(false);
    let termination_unconfirmed=AtomicBool::new(false);
    let output=thread::scope(|scope|{
        let monitor=scope.spawn(||{
            while managed_process_identity_matches(state,pid).unwrap_or(false){
                match current_runtime_status(state){
                    Ok(status) if status.over_hard_limit=>{
                        hard_limit_triggered.store(true,Ordering::Release);
                        let confirmed=terminate_registered_process_tree(state,pid).unwrap_or(false);
                        termination_unconfirmed.store(!confirmed,Ordering::Release);
                        break;
                    }
                    Ok(_)=>{},
                    Err(_)=>break,
                }
                thread::sleep(Duration::from_millis(250));
            }
        });
        let result=bounded_child::collect_with_deadline(child,Duration::from_secs(120));
        let _=monitor.join();
        result
    });
    if output.is_err(){let _=terminate_registered_process_tree(state,pid);}
    if let Some(action_id)=execution_action_id{
        if let Ok(mut running)=state.running_action_children.lock(){running.remove(action_id);}
    }
    unregister_managed_process(state,pid);
    if hard_limit_triggered.load(Ordering::Acquire){
        return Err(if termination_unconfirmed.load(Ordering::Acquire){
            "Blender plan exceeded the 4 GB hard RAM ceiling; process-tree termination is unconfirmed. Inspect before retry."
        }else{
            "Blender plan exceeded the 4 GB hard RAM ceiling and its managed process tree was stopped. Inspect before retry."
        }.into());
    }
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
    if value.get("input_checkpoint")!=Some(&input_proof.as_ref()
        .map(|source|source.json()).unwrap_or(Value::Null)){
        return Err("One-off Blender source checkpoint receipt differs from verified input.".into());
    }
    if let Some(ref input)=input_proof{
        blender_input_checkpoint::still_current(input)?;
    }
    // Independent, final Rust attestation: the output basename AND format
    // must equal the final approved typed step, not just hash/approved root.
    crate::blender_plan_lineage::verify_final_artifact_binding(plan,&value)?;
    let manifest=crate::blender_artifact_manifest::build(&value,Path::new(output_dir),action_id,None)?;
    drop(guard);
    Ok(json!({"status":"verified","worker":"blender","full_plan_completed":true,
        "artifact":value["artifact"],"verified_by_native_sha256":true,
        "plan_steps":value["executed_steps"],"allow_render":allow_render,
        "checkpoint_reopen":value["checkpoint_reopen"],
        "source_action_id":action_id,"artifact_manifest":manifest,
        "approved_plan_lineage":plan_lineage,
        "input_checkpoint":input_proof.as_ref().map(|p|p.json())}))
}
