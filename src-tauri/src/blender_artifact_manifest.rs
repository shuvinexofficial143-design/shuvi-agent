//! Typed, read-only handoff contract for team-38 scheduler / team-40 Adobe.
//! The manifest certifies native receipt verification, NOT an Adobe import,
//! visual quality, project compatibility or autonomous execution approval.
use std::path::Path;
use serde_json::{json,Value};
use uuid::Uuid;

use crate::blender_plan_worker::verify_output;

/// Optional material-still proof is a historical read-only preflight
/// from the *owned persistent* broker, never an image-quality or current
/// host-approval claim. Verify the actual source bytes during delivery and
/// reject any incomplete or contradictory claimed fields.
fn material_source_evidence(
    preflight:Option<&Value>,artifact:&Value,session:Option<&str>
)->Result<Value,String>{
    let is_material=artifact.get("format").and_then(Value::as_str)==Some("PNG")
        && artifact.get("path").and_then(Value::as_str)
            .and_then(|p|Path::new(p).file_name())
            .and_then(|p|p.to_str())==Some("shuvi41-proof-material-render.png");
    if !is_material {
        if preflight.is_some_and(|v|!v.is_null()){
            return Err("Unrelated Blender output cannot claim material-render preflight.".into());
        }
        return Ok(Value::Null);
    }
    let claim=preflight.filter(|v|v.is_object())
        .ok_or("Material PNG is missing its authenticated read-only source preflight.")?;
    let owner=session.ok_or("Material PNG requires persistent Blender session identity.")?;
    if claim.get("schema_version").and_then(Value::as_u64)!=Some(1)
        ||claim.get("verified").and_then(Value::as_bool)!=Some(true)
        ||claim.get("read_only_preflight").and_then(Value::as_bool)!=Some(true)
        ||claim.get("session_id").and_then(Value::as_str)!=Some(owner)
        ||claim.get("mesh_name").and_then(Value::as_str)!=Some("Shuvi41ProofMesh")
        ||claim.get("material_slot_name").and_then(Value::as_str)!=Some("Shuvi41ProofCopper")
        ||claim.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
        ||claim.get("key_light_name").and_then(Value::as_str)!=Some("Shuvi41ProofKey")
        ||claim.get("shader_parameters_independently_verified").and_then(Value::as_bool)!=Some(true)
        ||claim.get("shader_node_graph_revision_verified").and_then(Value::as_bool)!=Some(true)
        ||claim.get("render_completed_by_preflight").and_then(Value::as_bool)!=Some(false)
        ||claim.get("approval_reauthenticated_by_preflight").and_then(Value::as_bool)!=Some(false){
        return Err("Material render source preflight claims are missing or overstated.".into());
    }
    let revision=claim.get("source_scene_revision").and_then(Value::as_str)
        .ok_or("Material source preflight revision missing.")?;
    if revision.len()!=64 || !revision.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()){
        return Err("Material source preflight revision is invalid.".into());
    }
    let shader_rev=claim.get("shader_graph_revision").and_then(Value::as_str)
        .ok_or("Material read-only shader graph revision missing.")?;
    if shader_rev.len()!=64
        ||!shader_rev.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()){
        return Err("Material shader graph revision is invalid.".into());
    }
    let source=claim.get("source_blend_path").and_then(Value::as_str)
        .ok_or("Material source path missing.")?;
    if Path::new(source).file_name().and_then(|v|v.to_str())!=Some("shuvi41-proof-material.blend"){
        return Err("Material render must be sourced from the fixed material .blend.".into());
    }
    let digest=claim.get("source_sha256").and_then(Value::as_str)
        .ok_or("Material source SHA-256 missing.")?;
    let checked=crate::blender_input_checkpoint::inspect(Some(source),Some(digest))?
        .ok_or("Material source bytes are not available.")?;
    if checked.canonical_path!=source
        ||claim.get("source_bytes").and_then(Value::as_u64)!=Some(checked.bytes) {
        return Err("Material source preflight does not match native source bytes.".into());
    }
    Ok(json!({
        "schema_version":1,"source_blend_path":source,"source_sha256":digest,
        "source_bytes":checked.bytes,"source_scene_revision":revision,
        "source_session_id":owner,"mesh_name":"Shuvi41ProofMesh",
        "material_slot_name":"Shuvi41ProofCopper",
        "active_camera_name":"Shuvi41ProofCamera","key_light_name":"Shuvi41ProofKey",
        "native_source_sha256_verified_at_delivery":true,
        "read_only_preflight_verified_at_delivery":true,
        "shader_parameters_independently_verified":true,
        "shader_node_graph_revision_verified":true,
        "shader_graph_revision":shader_rev,
        "render_completed_by_preflight":false,
        "approval_reauthenticated_by_preflight":false,
    }))
}

/// Verify the structure of HISTORICAL material proof in a user-supplied
/// manifest; do not re-read arbitrary unapproved source paths here.
fn validate_historical_material_proof(evidence:&Value,artifact:&Value)->Result<bool,String>{
    let is_material=artifact.get("format").and_then(Value::as_str)==Some("PNG")
        && artifact.get("absolute_path").and_then(Value::as_str)
            .and_then(|p|Path::new(p).file_name())
            .and_then(|p|p.to_str())==Some("shuvi41-proof-material-render.png");
    if !is_material{
        if evidence.get("material_render_source").is_some_and(|v|!v.is_null()){
            return Err("Unrelated Blender output has injected material evidence.".into());
        }
        return Ok(false);
    }
    let proof=evidence.get("material_render_source").filter(|v|v.is_object())
        .ok_or("Material PNG has no historic source evidence.")?;
    let sha=proof.get("source_sha256").and_then(Value::as_str)
        .ok_or("Material history source hash missing.")?;
    let rev=proof.get("source_scene_revision").and_then(Value::as_str)
        .ok_or("Material history scene revision missing.")?;
    let shader=proof.get("shader_graph_revision").and_then(Value::as_str)
        .ok_or("Material historical shader fingerprint missing.")?;
    for hash in [sha,rev,shader]{
        if hash.len()!=64 || !hash.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()){
            return Err("Malformed historical material source identity.".into());
        }
    }
    if proof.get("schema_version").and_then(Value::as_u64)!=Some(1)
        ||proof.get("native_source_sha256_verified_at_delivery").and_then(Value::as_bool)!=Some(true)
        ||proof.get("read_only_preflight_verified_at_delivery").and_then(Value::as_bool)!=Some(true)
        ||proof.get("shader_parameters_independently_verified").and_then(Value::as_bool)!=Some(true)
        ||proof.get("shader_node_graph_revision_verified").and_then(Value::as_bool)!=Some(true)
        ||proof.get("render_completed_by_preflight").and_then(Value::as_bool)!=Some(false)
        ||proof.get("approval_reauthenticated_by_preflight").and_then(Value::as_bool)!=Some(false)
        ||proof.get("source_blend_path").and_then(Value::as_str)
            .and_then(|p|Path::new(p).file_name()).and_then(|p|p.to_str())!=Some("shuvi41-proof-material.blend")
        ||!Path::new(proof.get("source_blend_path").and_then(Value::as_str).unwrap_or("")).is_absolute()
        ||proof.get("source_bytes").and_then(Value::as_u64).is_none_or(|n|n<12 || n>128*1024*1024)
        ||proof.get("source_session_id").and_then(Value::as_str).is_none_or(|s|Uuid::parse_str(s).is_err())
        ||proof.get("mesh_name").and_then(Value::as_str)!=Some("Shuvi41ProofMesh")
        ||proof.get("material_slot_name").and_then(Value::as_str)!=Some("Shuvi41ProofCopper")
        ||proof.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
        ||proof.get("key_light_name").and_then(Value::as_str)!=Some("Shuvi41ProofKey"){
        return Err("Invalid or exaggerated historical material evidence.".into());
    }
    Ok(true)
}

/// Verify the ON-DISK bytes inside the approved root and build a bounded,
/// action-lineage-bound typed manifest. No files or applications are changed.
pub(crate) fn build(
    output:&Value,output_root:&Path,action_id:&str,session_id:Option<&str>
)->Result<Value,String>{
    let action=Uuid::parse_str(action_id)
        .map_err(|_|"Blender handoff needs the native approved action UUID.")?;
    if action.to_string()!=action_id.to_ascii_lowercase(){
        return Err("Blender action UUID must be in canonical hyphenated form.".into());
    }
    let session=match session_id{
        Some(id)=>{
            let parsed=Uuid::parse_str(id)
                .map_err(|_|"Blender handoff session UUID is invalid.")?;
            if parsed.to_string()!=id.to_ascii_lowercase(){
                return Err("Blender handoff session UUID must be canonical.".into());
            }
            Some(parsed.to_string())
        },
        None=>None,
    };
    if output.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
        || output.get("status").and_then(Value::as_str)!=Some("verified")
        || output.get("complete").and_then(Value::as_bool)!=Some(true)
        || output.get("destructive_allowed").and_then(Value::as_bool)!=Some(false) {
        return Err("Blender handoff requires authenticated complete non-destructive evidence.".into());
    }
    let steps=output.get("executed_steps").and_then(Value::as_u64)
        .filter(|n|(1..=6).contains(n))
        .ok_or("Blender handoff plan count invalid.")?;
    // Independently hash the real file and recheck the saved Blender reopen
    // receipt or PNG structure metadata before emitting anything consumable.
    verify_output(output,output_root)?;
    let artifact=output.get("artifact").ok_or("Blender artifact receipt missing.")?;
    let name=artifact.get("path").and_then(Value::as_str)
        .ok_or("Blender artifact has no exact absolute path.")?;
    let original=Path::new(name);
    if !original.is_absolute() ||
        std::fs::symlink_metadata(original)
            .map_err(|_|"Blender output file is missing.")?
            .file_type().is_symlink() {
        return Err("Blender output must not be a symbolic-link path.".into());
    }
    let canonical=original.canonicalize().map_err(|_|"Blender output path cannot be canonicalized.")?;
    let path=canonical.to_str().ok_or("Blender output path is not valid Unicode.")?;
    let kind=artifact.get("format").and_then(Value::as_str)
        .ok_or("Blender output format missing.")?;
    let saved=kind=="BLEND";
    let rendered=kind=="PNG";
    if !saved && !rendered{return Err("Unsupported Blender output kind.".into());}
    let proof=output.get("checkpoint_reopen");
    if saved && proof.and_then(|p|p.get("verified")).and_then(Value::as_bool)!=Some(true){
        return Err("Saved scene has no verified independent reopen proof.".into());
    }
    if rendered && proof.is_some_and(|v|!v.is_null()){
        return Err("A PNG may not carry unrelated scene-reopen evidence.".into());
    }
    let material=material_source_evidence(
        output.get("material_render_preflight"),artifact,session.as_deref()
    )?;
    let stage=if saved {Path::new(path).file_name().and_then(|x|x.to_str())}else{None};
    let fixed_stage=matches!(stage,Some("shuvi41-proof-stage1.blend"|"shuvi41-proof-stage2.blend"));
    if fixed_stage && (
        proof.and_then(|p|p.get("fixed_stage_geometry_verified")).and_then(Value::as_bool)!=Some(true)
        ||proof.and_then(|p|p.get("fixed_stage_name")).and_then(Value::as_str)!=stage
        ||proof.and_then(|p|p.get("proof_camera_verified")).and_then(Value::as_bool)!=Some(true)
        ||proof.and_then(|p|p.get("active_camera_name")).and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
        ||(stage==Some("shuvi41-proof-stage2.blend")
            && proof.and_then(|p|p.get("proof_key_light_verified")).and_then(Value::as_bool)!=Some(true))){
        return Err("Fixed Blender stage lacks persistent geometry and camera/light proof.".into());
    }
    let material_look= saved && Path::new(path).file_name().and_then(|x|x.to_str())
        ==Some("shuvi41-proof-material.blend");
    if material_look && (
        proof.and_then(|p|p.get("proof_copper_material_verified")).and_then(Value::as_bool)!=Some(true)
        ||proof.and_then(|p|p.get("shader_parameters_independently_verified")).and_then(Value::as_bool)!=Some(true)
        ||proof.and_then(|p|p.get("proof_copper_shader_revision")).and_then(Value::as_str)
            .is_none_or(|digest|digest.len()!=64||
                !digest.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()))
        ||proof.and_then(|p|p.get("active_camera_name")).and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
        ||proof.and_then(|p|p.get("proof_camera_verified")).and_then(Value::as_bool)!=Some(true)
        ||proof.and_then(|p|p.get("proof_key_light_verified")).and_then(Value::as_bool)!=Some(true)
    ){
        return Err("Material look checkpoint lacks persisted copper mesh/camera/light reopen proof.".into());
    }
    let visual_size=if rendered {
        json!({"width":artifact["width"],"height":artifact["height"],
            "color_mode":"RGBA","bit_depth":8})
    }else{Value::Null};
    Ok(json!({
        "schema_version":1,
        "producer":"shuvi41.blender",
        "status":"verified",
        "source_action_id":action.to_string(),
        "source_session_id":session,
        "artifact":{
            "absolute_path":path,
            "bytes":artifact["bytes"],
            "sha256":artifact["sha256"],
            "format":kind,
            "image":visual_size,
        },
        "evidence":{
            "native_file_sha256_readback":true,
            "independent_read_only_reopen":saved,
            "checkpoint_bytes_stable_during_reopen":saved,
            "checkpoint_file_sha256":if saved {proof.unwrap()["checkpoint_file_sha256"].clone()}else{Value::Null},
            "scene_fingerprint":if saved {proof.unwrap()["fingerprint"].clone()}else{Value::Null},
            "object_count":if saved {proof.unwrap()["object_count"].clone()}else{Value::Null},
            "mesh_geometry_verified":saved,
            "fixed_stage_geometry_verified":fixed_stage,
            "fixed_stage_name":if fixed_stage {proof.unwrap()["fixed_stage_name"].clone()}else{Value::Null},
            "material_look_checkpoint_verified":material_look,
            "proof_copper_material_verified":if material_look {Value::Bool(true)}else{Value::Null},
            "shader_parameters_independently_verified":if material_look {Value::Bool(true)}else{Value::Null},
            "proof_copper_shader_revision":if material_look {proof.unwrap()["proof_copper_shader_revision"].clone()}else{Value::Null},
            "material_render_source":material,
            "active_camera_name":if saved {proof.unwrap()["active_camera_name"].clone()}else{Value::Null},
            "proof_camera_verified":if saved {proof.unwrap()["proof_camera_verified"].clone()}else{Value::Null},
            "proof_key_light_verified":if saved {proof.unwrap()["proof_key_light_verified"].clone()}else{Value::Null},
            "mesh_fingerprint":if saved {proof.unwrap()["mesh_fingerprint"].clone()}else{Value::Null},
            "mesh_count":if saved {proof.unwrap()["mesh_count"].clone()}else{Value::Null},
            "total_vertices":if saved {proof.unwrap()["total_vertices"].clone()}else{Value::Null},
            "total_faces":if saved {proof.unwrap()["total_faces"].clone()}else{Value::Null},
            "executed_typed_steps":steps,
            "destructive_allowed":false,
        },
        "handoff":{
            "requires_new_action_approval":true,
            "import_performed":false,
            "target_application":Value::Null,
            "host_live_acceptance_proven":false,
            "visual_quality_verified":false,
        }
    }))
}


/// A manifest is user-supplied, historical JSON, not an approval token.
/// Refuse self-contradictory or inflated permissions before checking the file.
fn validate_historical_claim_boundaries(manifest:&Value)->Result<(),String>{
    let handoff=manifest.get("handoff").ok_or("Blender handoff claims are missing.")?;
    if handoff.get("requires_new_action_approval").and_then(Value::as_bool)!=Some(true)
        ||handoff.get("import_performed").and_then(Value::as_bool)!=Some(false)
        ||handoff.get("target_application")!=Some(&Value::Null)
        ||handoff.get("host_live_acceptance_proven").and_then(Value::as_bool)!=Some(false)
        ||handoff.get("visual_quality_verified").and_then(Value::as_bool)!=Some(false){
        return Err("Historical Blender handoff cannot claim approval, host acceptance, visual inspection or an import.".into());
    }
    let artifact=manifest.get("artifact").ok_or("Blender handoff artifact missing.")?;
    let kind=artifact.get("format").and_then(Value::as_str)
        .ok_or("Blender handoff format missing.")?;
    let saved=match kind{
        "BLEND"=>true,
        "PNG"=>false,
        _=>return Err("Unsupported Blender handoff artifact format.".into()),
    };
    let evidence=manifest.get("evidence").ok_or("Blender handoff proof is missing.")?;
    if evidence.get("native_file_sha256_readback").and_then(Value::as_bool)!=Some(true)
        ||evidence.get("destructive_allowed").and_then(Value::as_bool)!=Some(false)
        ||evidence.get("executed_typed_steps").and_then(Value::as_u64)
            .is_none_or(|n|!(1..=6).contains(&n))
        ||evidence.get("independent_read_only_reopen").and_then(Value::as_bool)!=Some(saved)
        ||evidence.get("checkpoint_bytes_stable_during_reopen").and_then(Value::as_bool)!=Some(saved)
        ||evidence.get("mesh_geometry_verified").and_then(Value::as_bool)!=Some(saved){
        return Err("Historical Blender artifact evidence is incomplete or contradicts its output type.".into());
    }
    if saved {
        if artifact.get("image").is_some_and(|v|!v.is_null())
            ||evidence.get("material_render_source").is_some_and(|v|!v.is_null()){
            return Err("Saved Blender scene cannot claim PNG image metadata or an unrelated material still source.".into());
        }
    } else {
        if !artifact.get("image").is_some_and(Value::is_object)
            ||evidence.get("fixed_stage_geometry_verified").and_then(Value::as_bool)!=Some(false)
            ||evidence.get("material_look_checkpoint_verified").and_then(Value::as_bool)!=Some(false){
            return Err("PNG cannot masquerade as an independently reopened modeling or material checkpoint.".into());
        }
        // Build emits null for scene-only proof on PNG. No read-only file
        // check can convert a PNG into a scene reopen or geometry receipt.
        for key in [
            "checkpoint_file_sha256","scene_fingerprint","object_count",
            "fixed_stage_name","proof_copper_material_verified",
            "shader_parameters_independently_verified","proof_copper_shader_revision",
            "active_camera_name","proof_camera_verified","proof_key_light_verified",
            "mesh_fingerprint","mesh_count","total_vertices","total_faces"
        ]{
            if evidence.get(key).is_some_and(|v|!v.is_null()){
                return Err(format!("PNG handoff illegally claims historical Blender scene proof: {key}"));
            }
        }
    }
    Ok(())
}

fn validate_historical_material_session(
    manifest:&Value,material_proof_present:bool
)->Result<(),String>{
    if !material_proof_present{return Ok(());}
    let owner=manifest.get("source_session_id").and_then(Value::as_str)
        .ok_or("Material render handoff has no originating native session.")?;
    let source_owner=manifest.pointer("/evidence/material_render_source/source_session_id")
        .and_then(Value::as_str);
    if source_owner!=Some(owner){
        return Err("Material render historical source session conflicts with the Blender handoff owner.".into());
    }
    Ok(())
}

/// Read-only downstream receipt check. Only verifies the file bytes as they
/// exist NOW; prior action approval, Blender reopen and visual quality are
/// historical claims and cannot be re-authenticated from JSON alone.
/// This never imports an asset or authorizes another mutation.
pub(crate) fn reverify(manifest:&Value,approved_root:&Path)->Result<Value,String>{
    if manifest.get("schema_version").and_then(Value::as_u64)!=Some(1)
        ||manifest.get("producer").and_then(Value::as_str)!=Some("shuvi41.blender")
        ||manifest.get("status").and_then(Value::as_str)!=Some("verified") {
        return Err("Blender handoff manifest schema or permission boundaries differ.".into());
    }
    validate_historical_claim_boundaries(manifest)?;
    let action_id=manifest.get("source_action_id").and_then(Value::as_str)
        .ok_or("Blender handoff source action missing.")?;
    let parsed=Uuid::parse_str(action_id).map_err(|_|"Invalid Blender source action UUID.")?;
    if parsed.to_string()!=action_id {return Err("Noncanonical Blender source action UUID.".into());}
    if let Some(session_id)=manifest.get("source_session_id").filter(|v|!v.is_null()){
        let name=session_id.as_str().ok_or("Malformed Blender source session UUID.")?;
        if Uuid::parse_str(name).map_err(|_|"Invalid Blender source session UUID.")?.to_string()!=name{
            return Err("Noncanonical Blender session UUID.".into());
        }
    }
    let artifact=manifest.get("artifact").ok_or("Blender handoff artifact missing.")?;
    let file=artifact.get("absolute_path").and_then(Value::as_str)
        .ok_or("Blender handoff has no absolute file path.")?;
    if !Path::new(file).is_absolute(){return Err("Blender handoff path is not absolute.".into());}
    let hash=artifact.get("sha256").and_then(Value::as_str)
        .ok_or("Blender handoff SHA-256 missing.")?;
    if hash.len()!=64 || !hash.bytes().all(|x|x.is_ascii_hexdigit() && !x.is_ascii_uppercase()){
        return Err("Malformed Blender handoff SHA-256.".into());
    }
    let len=artifact.get("bytes").and_then(Value::as_u64)
        .filter(|n|*n>=12 && *n<=128*1024*1024)
        .ok_or("Blender handoff size outside bounds.")?;
    let kind=artifact.get("format").and_then(Value::as_str)
        .ok_or("Blender handoff format missing.")?;
    let file_meta=std::fs::symlink_metadata(file)
        .map_err(|_|"Blender handoff output is missing.")?;
    if file_meta.file_type().is_symlink() || !file_meta.file_type().is_file(){
        return Err("Blender handoff cannot use a symbolic link or non-file.".into());
    }
    let mut receipt=json!({"artifact":{"path":file,"bytes":len,
        "sha256":hash,"format":kind}});
    let kind_label=match kind{
        "BLEND"=>{
            let evidence=manifest.get("evidence").ok_or("Blender proof missing.")?;
            if evidence.get("independent_read_only_reopen").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("checkpoint_bytes_stable_during_reopen").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("checkpoint_file_sha256").and_then(Value::as_str)!=Some(hash){
                return Err("Blender source reopen file SHA history is missing or contradictory.".into());
            }
            let saved_name=Path::new(file).file_name().and_then(|x|x.to_str());
            let fixed_stage=matches!(saved_name,Some("shuvi41-proof-stage1.blend"|"shuvi41-proof-stage2.blend"));
            if fixed_stage && (
                evidence.get("fixed_stage_geometry_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("fixed_stage_name").and_then(Value::as_str)!=saved_name
                ||evidence.get("proof_camera_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
                ||(saved_name==Some("shuvi41-proof-stage2.blend")
                    && evidence.get("proof_key_light_verified").and_then(Value::as_bool)!=Some(true))){
                return Err("Fixed Blender stage lacks historical geometry and camera/light proof.".into());
            }
            if !fixed_stage && (evidence.get("fixed_stage_geometry_verified").and_then(Value::as_bool)==Some(true)
                ||evidence.get("fixed_stage_name").is_some_and(|v|!v.is_null())){
                return Err("Unrelated Blender checkpoint cannot claim fixed-stage geometry.".into());
            }
            let material_look=Path::new(file).file_name().and_then(|x|x.to_str())
                ==Some("shuvi41-proof-material.blend");
            if material_look && (
                evidence.get("material_look_checkpoint_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("proof_copper_material_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("shader_parameters_independently_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("proof_copper_shader_revision").and_then(Value::as_str)
                    .is_none_or(|digest|digest.len()!=64||
                        !digest.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()))
                ||evidence.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
                ||evidence.get("proof_camera_verified").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("proof_key_light_verified").and_then(Value::as_bool)!=Some(true)){
                return Err("Material look handoff lacks original independent copper/camera/light receipt.".into());
            }
            if !material_look && (evidence.get("material_look_checkpoint_verified").and_then(Value::as_bool)==Some(true)
                ||evidence.get("proof_copper_material_verified").and_then(Value::as_bool)==Some(true)
                ||evidence.get("shader_parameters_independently_verified").and_then(Value::as_bool)==Some(true)
                ||evidence.get("proof_copper_shader_revision").is_some_and(|v|!v.is_null())){
                return Err("Unrelated saved scene cannot impersonate the copper-look proof.".into());
            }
            receipt["checkpoint_reopen"]=json!({
                "verified":true,"read_only":true,
                "checkpoint_bytes_stable_during_reopen":true,
                "checkpoint_file_sha256":evidence["checkpoint_file_sha256"],
                "fingerprint":evidence["scene_fingerprint"],
                "object_count":evidence["object_count"],
                "mesh_geometry_verified":evidence["mesh_geometry_verified"],
                "fixed_stage_geometry_verified":evidence["fixed_stage_geometry_verified"],
                "fixed_stage_name":evidence["fixed_stage_name"],
                "active_camera_name":evidence["active_camera_name"],
                "proof_camera_verified":evidence["proof_camera_verified"],
                "proof_key_light_verified":evidence["proof_key_light_verified"],
                "proof_copper_material_verified":evidence["proof_copper_material_verified"],
                "shader_parameters_independently_verified":evidence["shader_parameters_independently_verified"],
                "proof_copper_shader_revision":evidence["proof_copper_shader_revision"],
                "mesh_fingerprint":evidence["mesh_fingerprint"],
                "mesh_count":evidence["mesh_count"],
                "total_vertices":evidence["total_vertices"],
                "total_faces":evidence["total_faces"]});
            "BLEND"
        },
        "PNG"=>{
            let image=artifact.get("image").ok_or("PNG image metadata missing.")?;
            for field in ["width","height","bit_depth","color_mode"]{
                if image.get(field).is_none(){return Err("PNG metadata incomplete.".into());}
            }
            for field in ["width","height","bit_depth","color_mode"]{
                receipt["artifact"][field]=image[field].clone();
            }
            "PNG"
        },
        _=>return Err("Unsupported Blender handoff artifact format.".into())
    };
    let material_proof_was_valid=validate_historical_material_proof(
        manifest.get("evidence").ok_or("Blender handoff evidence missing.")?,artifact
    )?;
    validate_historical_material_session(manifest,material_proof_was_valid)?;
    // This native readback re-hashes the actual current file and checks it
    // remains confined within an explicitly selected existing root.
    verify_output(&receipt,approved_root)?;
    Ok(json!({
        "status":"file_bytes_reverified",
        "source_action_id":action_id,
        "artifact_format":kind_label,
        "absolute_path":file,
        "bytes":len,
        "sha256":hash,
        "current_file_integrity_verified":true,
        "historical_material_render_source_record_well_formed":material_proof_was_valid,
        "material_source_current_bytes_reverified":false,
        "material_source_preflight_reexecuted":false,
        "material_look_checkpoint_historical_proof_only":kind_label=="BLEND"
            && Path::new(file).file_name().and_then(|x|x.to_str())==Some("shuvi41-proof-material.blend"),
        "material_look_reopened_again_by_this_review":false,
        "source_action_approval_reverified":false,
        "original_blender_reopen_reexecuted":false,
        "import_performed":false,
        "requires_new_action_approval":true
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs,io::Write};
    use sha2::{Digest,Sha256};
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi41-artifact-{}",Uuid::new_v4()));
            fs::create_dir(&path).expect("disposable fixture folder");
            Self(path)
        }
        fn save(&self,extension:&str)->(String,u64,String){
            let name=self.0.join(format!("sample.{extension}"));
            let bytes=b"BLENDER-v430safe-fixture";
            let mut handle=fs::File::create(&name).unwrap();
            handle.write_all(bytes).unwrap();
            (name.to_str().unwrap().to_owned(),bytes.len() as u64,format!("{:x}",Sha256::digest(bytes)))
        }
    }
    impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn proof(path:&str,size:u64,digest:&str)->Value{
        json!({
            "status":"verified","complete":true,"authenticated_blender_plan":true,
            "destructive_allowed":false,"executed_steps":2,
            "artifact":{"path":path,"bytes":size,"sha256":digest,"format":"BLEND"},
            "checkpoint_reopen":{"verified":true,"read_only":true,"fingerprint":"a".repeat(64),
                "checkpoint_bytes_stable_during_reopen":true,
                "checkpoint_file_sha256":digest,
                "object_count":2,"mesh_geometry_verified":true,
                "mesh_fingerprint":"c".repeat(64),
                "mesh_count":1,"total_vertices":3,"total_faces":1}
        })
    }
    const ACTION:&str="e5f8c84b-e405-4339-b6fd-e8ca80c457aa";
    const SESSION:&str="7f27d8bd-0c46-4f2b-a8c8-d9fe0895b113";

    #[test]
    fn authentic_handoff_contains_verified_provenance_but_no_import_claim(){
        let f=Fixture::new();
        let (path,size,sha)=f.save("blend");
        let data=build(&proof(&path,size,&sha),&f.0,ACTION,Some(SESSION)).unwrap();
        assert_eq!(data["schema_version"],1);
        assert_eq!(data["source_action_id"],ACTION);
        assert_eq!(data["source_session_id"],SESSION);
        assert_eq!(data["artifact"]["sha256"],sha);
        assert_eq!(data["evidence"]["independent_read_only_reopen"],true);
        assert_eq!(data["evidence"]["checkpoint_bytes_stable_during_reopen"],true);
        assert_eq!(data["evidence"]["checkpoint_file_sha256"],sha);
        assert_eq!(data["handoff"]["import_performed"],false);
        assert_eq!(data["handoff"]["host_live_acceptance_proven"],false);
        assert_eq!(data["handoff"]["requires_new_action_approval"],true);
    }
    #[test]
    fn reserved_stage_checkpoint_needs_real_persisted_shape_camera_and_light(){
        let f=Fixture::new();
        let (original,size,sha)=f.save("blend");
        for stage in ["shuvi41-proof-stage1.blend","shuvi41-proof-stage2.blend"]{
            let path=f.0.join(stage);
            fs::copy(&original,&path).unwrap();
            let path=path.to_str().unwrap();
            let mut result=proof(path,size,&sha);
            assert!(build(&result,&f.0,ACTION,None).is_err());
            result["checkpoint_reopen"]["fixed_stage_geometry_verified"]=json!(true);
            result["checkpoint_reopen"]["fixed_stage_name"]=json!(stage);
            result["checkpoint_reopen"]["proof_camera_verified"]=json!(true);
            result["checkpoint_reopen"]["active_camera_name"]=json!("Shuvi41ProofCamera");
            if stage.contains("stage2"){
                assert!(build(&result,&f.0,ACTION,None).is_err());
                result["checkpoint_reopen"]["proof_key_light_verified"]=json!(true);
            }
            let handoff=build(&result,&f.0,ACTION,None).unwrap();
            assert_eq!(handoff["evidence"]["fixed_stage_geometry_verified"],true);
            assert_eq!(handoff["evidence"]["fixed_stage_name"],stage);
            reverify(&handoff,&f.0).unwrap();
            let mut forged=handoff.clone();
            forged["evidence"]["fixed_stage_geometry_verified"]=json!(false);
            assert!(reverify(&forged,&f.0).is_err());
            let mut forged=handoff;
            forged["evidence"]["fixed_stage_name"]=json!("shuvi41-proof-stage3.blend");
            assert!(reverify(&forged,&f.0).is_err());
        }
    }
    #[test]
    fn tampering_on_disk_or_outside_approved_root_is_denied(){
        let f=Fixture::new();let elsewhere=Fixture::new();
        let (path,size,sha)=f.save("blend");
        assert!(build(&proof(&path,size,&sha),&elsewhere.0,ACTION,None).is_err());
        fs::write(&path,b"BLENDER-v430tampered-data!").unwrap();
        assert!(build(&proof(&path,size,&sha),&f.0,ACTION,None).is_err());
    }
    #[test]
    fn invalid_lineage_and_missing_reopen_evidence_are_denied(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let good=proof(&path,size,&sha);
        assert!(build(&good,&f.0,"forged-id",None).is_err());
        assert!(build(&good,&f.0,ACTION,Some("stale")).is_err());
        let mut bad=good.clone();bad.as_object_mut().unwrap().remove("checkpoint_reopen");
        assert!(build(&bad,&f.0,ACTION,None).is_err());
        for (field,value) in [
            ("checkpoint_file_sha256",json!("f".repeat(64))),
            ("checkpoint_bytes_stable_during_reopen",json!(false)),
        ]{
            let mut forged=good.clone();
            forged["checkpoint_reopen"][field]=value;
            assert!(build(&forged,&f.0,ACTION,None).is_err(),"{field}");
        }
    }

    #[test]
    fn downstream_rechecks_actual_bytes_but_never_promotes_prior_approval(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let source=build(&proof(&path,size,&sha),&f.0,ACTION,Some(SESSION)).unwrap();
        let check=reverify(&source,&f.0).unwrap();
        assert_eq!(check["status"],"file_bytes_reverified");
        assert_eq!(check["current_file_integrity_verified"],true);
        assert_eq!(check["source_action_approval_reverified"],false);
        assert_eq!(check["original_blender_reopen_reexecuted"],false);
        assert_eq!(check["import_performed"],false);
    }
    #[test]
    fn downstream_rejects_changed_bytes_wrong_root_and_forged_lineage(){
        let f=Fixture::new();let other=Fixture::new();
        let (path,size,sha)=f.save("blend");
        let source=build(&proof(&path,size,&sha),&f.0,ACTION,None).unwrap();
        assert!(reverify(&source,&other.0).is_err());
        let mut forged=source.clone();
        forged["source_action_id"]=json!("untracked");
        assert!(reverify(&forged,&f.0).is_err());
        let mut forged_permission=source.clone();
        forged_permission["handoff"]["import_performed"]=json!(true);
        assert!(reverify(&forged_permission,&f.0).is_err());
        fs::write(&path,b"BLENDER-v430tampered-manifest").unwrap();
        assert!(reverify(&source,&f.0).is_err());
    }
    #[test]
    fn native_material_delivery_binds_real_source_sha_camera_light_and_session(){
        let f=Fixture::new();
        let source=f.0.join("shuvi41-proof-material.blend");
        let bytes=b"BLENDER-v430material-proof-source";
        fs::write(&source,bytes).unwrap();
        let hash=format!("{:x}",Sha256::digest(bytes));
        // Production receipts use canonical Rust-resolved paths. Temp
        // directories may contain Windows path aliases; normalize fixture.
        let canonical=source.canonicalize().unwrap();
        let source_path=canonical.to_str().unwrap();
        let material_png=json!({"path":f.0.join("shuvi41-proof-material-render.png")
            .to_str().unwrap(),"format":"PNG"});
        let preflight=json!({
            "schema_version":1,"verified":true,"read_only_preflight":true,
            "session_id":SESSION,"source_scene_revision":"a".repeat(64),
            "source_blend_path":source_path,"source_sha256":hash,
            "source_bytes":bytes.len(),"mesh_name":"Shuvi41ProofMesh",
            "material_slot_name":"Shuvi41ProofCopper",
            "active_camera_name":"Shuvi41ProofCamera",
            "key_light_name":"Shuvi41ProofKey",
            "shader_parameters_independently_verified":true,
            "shader_node_graph_revision_verified":true,
            "shader_graph_revision":"e".repeat(64),
            "render_completed_by_preflight":false,
            "approval_reauthenticated_by_preflight":false
        });
        let proof=material_source_evidence(Some(&preflight),&material_png,Some(SESSION)).unwrap();
        assert_eq!(proof["source_sha256"],hash);
        assert_eq!(proof["native_source_sha256_verified_at_delivery"],true);
        assert_eq!(proof["shader_parameters_independently_verified"],true);
        assert_eq!(proof["shader_graph_revision"],"e".repeat(64));
        let file=json!({"format":"PNG","absolute_path":material_png["path"]});
        assert!(validate_historical_material_proof(
            &json!({"material_render_source":proof}),&file).unwrap());
        let mut altered=preflight.clone();
        altered["source_bytes"]=json!(bytes.len()+1);
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        altered=preflight.clone();
        altered["source_sha256"]=json!("0".repeat(64));
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        altered=preflight.clone();
        altered["key_light_name"]=json!("Counterfeit");
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        altered=preflight.clone();
        altered["shader_parameters_independently_verified"]=json!(false);
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        altered=preflight.clone();
        altered["shader_graph_revision"]=json!("not-a-shader-hash");
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        altered=preflight.clone();
        altered["shader_node_graph_revision_verified"]=json!(false);
        assert!(material_source_evidence(Some(&altered),&material_png,Some(SESSION)).is_err());
        assert!(material_source_evidence(Some(&preflight),&material_png,None).is_err());
        assert!(material_source_evidence(None,&material_png,Some(SESSION)).is_err());
        let unrelated=json!({"path":"/approved/other.png","format":"PNG"});
        assert!(material_source_evidence(Some(&preflight),&unrelated,Some(SESSION)).is_err());
        fs::write(&source,b"BLENDER-v430tampered!!!").unwrap();
        assert!(material_source_evidence(Some(&preflight),&material_png,Some(SESSION)).is_err());
    }
    #[test]
    fn historical_material_evidence_is_non_authoritative_and_fail_closed(){
        let f=Fixture::new();
        let material_file=f.0.join("shuvi41-proof-material.blend");
        let render_file=f.0.join("shuvi41-proof-material-render.png");
        let file=json!({"format":"PNG","absolute_path":render_file.to_str().unwrap()});
        let mut proof=json!({
            "schema_version":1,"source_blend_path":material_file.to_str().unwrap(),
            "source_sha256":"a".repeat(64),"source_scene_revision":"b".repeat(64),
            "source_bytes":100,"source_session_id":SESSION,
            "native_source_sha256_verified_at_delivery":true,
            "read_only_preflight_verified_at_delivery":true,
            "mesh_name":"Shuvi41ProofMesh","material_slot_name":"Shuvi41ProofCopper",
            "active_camera_name":"Shuvi41ProofCamera","key_light_name":"Shuvi41ProofKey",
            "shader_parameters_independently_verified":true,
            "shader_node_graph_revision_verified":true,
            "shader_graph_revision":"e".repeat(64),
            "render_completed_by_preflight":false,
            "approval_reauthenticated_by_preflight":false
        });
        assert!(validate_historical_material_proof(
            &json!({"material_render_source":proof}),&file).unwrap());
        proof["approval_reauthenticated_by_preflight"]=json!(true);
        assert!(validate_historical_material_proof(
            &json!({"material_render_source":proof}),&file).is_err());
        proof["approval_reauthenticated_by_preflight"]=json!(false);
        proof["shader_graph_revision"]=json!("bad");
        assert!(validate_historical_material_proof(
            &json!({"material_render_source":proof}),&file).is_err());
        let unrelated=json!({"format":"PNG",
            "absolute_path":f.0.join("unrelated.png").to_str().unwrap()});
        assert!(validate_historical_material_proof(
            &json!({"material_render_source":proof}),&unrelated).is_err());
        assert!(validate_historical_material_proof(&json!({}),&file).is_err());
    }
    #[test]
    fn copper_look_handoff_requires_independent_reopened_material_camera_and_light(){
        let f=Fixture::new();
        let source=f.0.join("shuvi41-proof-material.blend");
        let bytes=b"BLENDER-v430verified-copper-look";
        fs::write(&source,bytes).unwrap();
        let file=source.canonicalize().unwrap().to_str().unwrap().to_owned();
        let sha=format!("{:x}",Sha256::digest(bytes));
        let mut receipt=proof(&file,bytes.len() as u64,&sha);
        let reopened=&mut receipt["checkpoint_reopen"];
        reopened["proof_copper_material_verified"]=json!(true);
        reopened["shader_parameters_independently_verified"]=json!(true);
        reopened["proof_copper_shader_revision"]=json!("f".repeat(64));
        reopened["active_camera_name"]=json!("Shuvi41ProofCamera");
        reopened["proof_camera_verified"]=json!(true);
        reopened["proof_key_light_verified"]=json!(true);
        let manifest=build(&receipt,&f.0,ACTION,Some(SESSION)).unwrap();
        assert_eq!(manifest["evidence"]["material_look_checkpoint_verified"],true);
        assert_eq!(manifest["evidence"]["proof_copper_material_verified"],true);
        assert_eq!(manifest["evidence"]["shader_parameters_independently_verified"],true);
        assert_eq!(manifest["evidence"]["proof_copper_shader_revision"],"f".repeat(64));
        let review=reverify(&manifest,&f.0).unwrap();
        assert_eq!(review["current_file_integrity_verified"],true);
        assert_eq!(review["material_look_checkpoint_historical_proof_only"],true);
        assert_eq!(review["material_look_reopened_again_by_this_review"],false);
        for (key,value) in [
            ("proof_copper_material_verified",json!(false)),
            ("shader_parameters_independently_verified",json!(false)),
            ("proof_copper_shader_revision",json!("invalid")),
            ("active_camera_name",json!("WrongCamera")),
            ("proof_camera_verified",json!(false)),
            ("proof_key_light_verified",json!(false)),
        ]{
            let mut forged=receipt.clone();
            forged["checkpoint_reopen"][key]=value;
            assert!(build(&forged,&f.0,ACTION,Some(SESSION)).is_err(),"{key}");
        }
        let mut forged_manifest=manifest.clone();
        forged_manifest["evidence"]["proof_copper_material_verified"]=json!(false);
        assert!(reverify(&forged_manifest,&f.0).is_err());
        let mut forged_manifest=manifest.clone();
        forged_manifest["evidence"]["shader_parameters_independently_verified"]=json!(false);
        assert!(reverify(&forged_manifest,&f.0).is_err());
        let mut forged_manifest=manifest.clone();
        forged_manifest["evidence"]["checkpoint_file_sha256"]=json!("0".repeat(64));
        assert!(reverify(&forged_manifest,&f.0).is_err());
        let mut forged_manifest=manifest.clone();
        forged_manifest["evidence"]["checkpoint_bytes_stable_during_reopen"]=json!(false);
        assert!(reverify(&forged_manifest,&f.0).is_err());
        let mut forged_manifest=manifest.clone();
        forged_manifest["evidence"]["proof_copper_shader_revision"]=json!("bad");
        assert!(reverify(&forged_manifest,&f.0).is_err());
        fs::write(&source,b"BLENDER-v430changed-copper-look").unwrap();
        assert!(reverify(&manifest,&f.0).is_err());
    }
    #[test]
    fn stage2_checkpoint_is_not_mistaken_for_optional_look_proof(){
        let f=Fixture::new();
        let (file,n,sha)=f.save("blend");
        let manifest=build(&proof(&file,n,&sha),&f.0,ACTION,None).unwrap();
        assert_eq!(manifest["evidence"]["material_look_checkpoint_verified"],false);
        assert!(manifest["evidence"]["proof_copper_material_verified"].is_null());
        assert!(manifest["evidence"]["shader_parameters_independently_verified"].is_null());
        assert_eq!(reverify(&manifest,&f.0).unwrap()["material_look_checkpoint_historical_proof_only"],false);
        let mut forged=manifest.clone();
        forged["evidence"]["proof_copper_material_verified"]=json!(true);
        assert!(reverify(&forged,&f.0).is_err());
    }

    #[test]
    fn historical_handoff_rejects_claim_inflation_even_when_file_sha_is_valid(){
        let f=Fixture::new();
        let (path,size,sha)=f.save("blend");
        let manifest=build(&proof(&path,size,&sha),&f.0,ACTION,Some(SESSION)).unwrap();
        reverify(&manifest,&f.0).unwrap();
        for (pointer,value) in [
            ("/handoff/host_live_acceptance_proven",json!(true)),
            ("/handoff/visual_quality_verified",json!(true)),
            ("/handoff/target_application",json!("Adobe After Effects")),
            ("/handoff/import_performed",json!(true)),
            ("/handoff/requires_new_action_approval",json!(false)),
            ("/evidence/native_file_sha256_readback",json!(false)),
            ("/evidence/destructive_allowed",json!(true)),
            ("/evidence/executed_typed_steps",json!(0)),
            ("/evidence/executed_typed_steps",json!(7)),
            ("/evidence/independent_read_only_reopen",json!(false)),
            ("/evidence/checkpoint_bytes_stable_during_reopen",json!(false)),
            ("/evidence/mesh_geometry_verified",json!(false)),
            ("/evidence/material_render_source",json!({"forged":true})),
            ("/artifact/image",json!({"width":64,"height":64})),
        ]{
            let mut forged=manifest.clone();
            *forged.pointer_mut(pointer).expect("generated manifest field")=value;
            assert!(reverify(&forged,&f.0).is_err(),"{pointer}");
        }
    }

    #[test]
    fn historical_material_session_must_match_exact_original_handoff_session(){
        let correct=json!({"source_session_id":SESSION,
            "evidence":{"material_render_source":{"source_session_id":SESSION}}});
        validate_historical_material_session(&correct,true).unwrap();
        // An ordinary non-material render has no material session history.
        validate_historical_material_session(&json!({}),false).unwrap();
        let mut forged=correct.clone();
        forged["evidence"]["material_render_source"]["source_session_id"]=
            json!("ed1f188e-5573-4913-b61a-acb286c124f9");
        assert!(validate_historical_material_session(&forged,true).is_err());
        let mut forged=correct.clone();
        forged["source_session_id"]=Value::Null;
        assert!(validate_historical_material_session(&forged,true).is_err());
        let mut forged=correct;
        forged["evidence"]["material_render_source"]["source_session_id"]=Value::Null;
        assert!(validate_historical_material_session(&forged,true).is_err());
    }
    
    #[test]
    fn incomplete_or_untrusted_worker_cannot_claim_handoff(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let mut bad=proof(&path,size,&sha);
        bad["complete"]=json!(false);
        assert!(build(&bad,&f.0,ACTION,None).is_err());
        bad["complete"]=json!(true);
        bad["authenticated_blender_plan"]=json!(false);
        assert!(build(&bad,&f.0,ACTION,None).is_err());
    }
}
