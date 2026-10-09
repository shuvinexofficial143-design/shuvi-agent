use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;

fn valid_candidate_name(name:&str)->bool{
    name.starts_with("Adobe Animate")
        && !name.chars().any(char::is_control)
        && name.len()<=240
}

fn candidate_executable(dir:&Path)->Option<PathBuf>{
    for file in ["Animate.exe","Adobe Animate.exe"]{
        let candidate=dir.join(file);
        if candidate.is_file(){return Some(candidate);}
    }
    None
}

fn inspect_adobe_dir(adobe:&Path,source:&str)->Result<Vec<Value>,String>{
    if !adobe.is_dir(){return Ok(Vec::new());}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(MAX_ADOBE_ENTRIES){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !valid_candidate_name(&name){continue;}
        let Some(exe)=candidate_executable(&entry.path()) else{continue;};
        let canonical=fs::canonicalize(&exe).unwrap_or(exe);
        candidates.push(json!({
            "name":name,
            "animate_exe":canonical,
            "source":source,
            "launch_supported":true,
            "host_transport":"cep_plus_jsfl",
            "runtime_verified":false
        }));
    }
    Ok(candidates)
}

pub fn detect_from_roots(roots:&[(PathBuf,&str)])->Result<Value,String>{
    let mut seen=HashSet::new();
    let mut candidates=Vec::new();
    for (root,source) in roots.iter().take(4){
        let adobe=root.join("Adobe");
        for candidate in inspect_adobe_dir(&adobe,source)?{
            let Some(path)=candidate.get("animate_exe").and_then(Value::as_str) else{continue;};
            let key=path.to_ascii_lowercase();
            if seen.insert(key){candidates.push(candidate);}
            if candidates.len()>=16{break;}
        }
        if candidates.len()>=16{break;}
    }
    candidates.sort_by(|a,b|{
        b.get("name").and_then(Value::as_str).unwrap_or("")
            .cmp(a.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Ok(json!({
        "schema_version":1,
        "candidates":candidates,
        "candidate_count":candidates.len(),
        "detection_scope":"bounded_windows_program_files_adobe",
        "launch_supported":!candidates.is_empty(),
        "host_transport":"cep_plus_jsfl",
        "runtime_verified":false,
        "production_ready":false
    }))
}

#[cfg(target_os="windows")]
pub fn detect_installs()->Result<Value,String>{
    let mut roots=Vec::new();
    if let Some(value)=std::env::var_os("ProgramFiles"){roots.push((PathBuf::from(value),"ProgramFiles/Adobe"));}
    if let Some(value)=std::env::var_os("ProgramFiles(x86)"){roots.push((PathBuf::from(value),"ProgramFiles(x86)/Adobe"));}
    if roots.is_empty(){
        return Ok(json!({
            "schema_version":1,"candidates":[],"candidate_count":0,
            "detection_scope":"bounded_windows_program_files_adobe",
            "launch_supported":false,"host_transport":"cep_plus_jsfl",
            "runtime_verified":false,"production_ready":false,
            "reason":"Windows Program Files environment variables are unavailable."
        }));
    }
    detect_from_roots(&roots)
}

#[cfg(not(target_os="windows"))]
pub fn detect_installs()->Result<Value,String>{
    Ok(json!({
        "schema_version":1,"candidates":[],"candidate_count":0,
        "detection_scope":"windows_only",
        "launch_supported":false,"host_transport":"cep_plus_jsfl",
        "runtime_verified":false,"production_ready":false,
        "reason":"Adobe Animate desktop detection is Windows-targeted in Shuvi."
    }))
}

pub fn validate_requested_executable(path:&str)->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Adobe Animate executable path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    let valid_name=p.file_name().and_then(|v|v.to_str()).is_some_and(|v|
        v.eq_ignore_ascii_case("Animate.exe")||v.eq_ignore_ascii_case("Adobe Animate.exe"));
    if !p.is_absolute()||!valid_name{
        return Err("Adobe Animate executable must be an absolute path ending in Animate.exe or Adobe Animate.exe.".into());
    }
    Ok(())
}

pub fn exact_detected_executable(report:&Value,requested:&str)->Result<PathBuf,String>{
    validate_requested_executable(requested)?;
    let requested=fs::canonicalize(requested).map_err(|e|format!("Requested Adobe Animate executable is unavailable: {e}"))?;
    let candidates=report.get("candidates").and_then(Value::as_array)
        .ok_or("Adobe Animate detection report has no candidate inventory.")?;
    for candidate in candidates{
        let Some(value)=candidate.get("animate_exe").and_then(Value::as_str) else{continue;};
        let Ok(path)=fs::canonicalize(value) else{continue;};
        if path==requested{return Ok(path);}
    }
    Err("Requested Adobe Animate executable is not one of Shuvi's freshly detected Program Files candidates.".into())
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_animate",
        "source_milestone_percent":100,
        "source_scope_complete":true,
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true,
            "authenticated_cep_jsfl_bridge":true,
            "document_inspection":true,
            "timeline_inspection":true,
            "library_inspection":true,
            "symbol_metadata_inspection":true,
            "selection_inspection":true,
            "fresh_document_timeline_identity_recheck":true,
            "guarded_layer_property_writes":["rename","visible","locked"],
            "local_fla_checkpoint_integrity":true,
            "independent_post_write_readback":true,
            "checkpoint_recovery_handoff":true,
            "publish_export_preflight_planning":true,
            "canonical_acceptance_summary":true
        },
        "not_implemented":{
            "stable_element_object_ids":true,
            "layer_create_delete_reorder":true,
            "frame_content_mutation":true,
            "drawing_mutation":true,
            "publish_export_execution":true,
            "automatic_checkpoint_restore":true,
            "runtime_acceptance":true
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_animate",
        "source_milestone_percent":100,
        "source_coding_status":"declared_source_scope_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"cep_plus_jsfl",
        "bridge_scope":"bounded_inspection_plus_guarded_layer_metadata_writes",
        "host_ready_verified":false,
        "document_automation_ready":"declared_bounded_source_scope_complete",
        "source_completion":{"declared_scope_complete":true,"canonical_summary_tool":"animate_acceptance_summary","runtime_acceptance_pending":true},
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"real Windows Animate acceptance testing; do not expand source scope unless a new milestone is explicitly defined"
    })
}


fn bounded_text(value:Option<&str>,max:usize)->bool{
    value.is_some_and(|text|text.len()<=max&&!text.chars().any(char::is_control))
}

pub fn validate_context_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Animate context receipt must explicitly be readOnly=true.".into());
    }
    let has_document=value.get("hasDocument").and_then(Value::as_bool)
        .ok_or("Animate context hasDocument is required.")?;
    let signature=value.get("documentSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=1600&&!v.chars().any(char::is_control))
        .ok_or("Animate document signature is missing or invalid.")?;
    let timeline_signature=value.get("timelineSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=2000&&!v.chars().any(char::is_control))
        .ok_or("Animate timeline signature is missing or invalid.")?;
    if !has_document{
        if signature!="no_document"||timeline_signature!="no_timeline"{return Err("Closed Animate context must use no_document/no_timeline signatures.".into());}
        return Ok(value.clone());
    }
    let id=value.get("documentId").and_then(Value::as_i64)
        .filter(|v|*v>=0).ok_or("Animate documentId is invalid.")?;
    if id>i32::MAX as i64{return Err("Animate documentId exceeds supported bounds.".into());}
    if !bounded_text(value.get("documentName").and_then(Value::as_str),512){
        return Err("Animate documentName is missing or oversized.".into());
    }
    let layer_count=value.get("layerCount").and_then(Value::as_u64)
        .filter(|v|*v<=100_000).ok_or("Animate layerCount is invalid.")?;
    let current_frame=value.get("currentFrame").and_then(Value::as_i64)
        .filter(|v|*v>=0).ok_or("Animate currentFrame is invalid.")?;
    if current_frame>10_000_000{return Err("Animate currentFrame exceeds supported bounds.".into());}
    Ok(json!({
        "validated":true,
        "readOnly":true,
        "hasDocument":true,
        "documentId":id,
        "documentName":value.get("documentName"),
        "documentPath":value.get("documentPath").cloned().unwrap_or(Value::Null),
        "documentPathURI":value.get("documentPathURI").cloned().unwrap_or(Value::Null),
        "width":value.get("width"),
        "height":value.get("height"),
        "frameRate":value.get("frameRate"),
        "currentTimeline":value.get("currentTimeline"),
        "timelineName":value.get("timelineName"),
        "currentFrame":current_frame,
        "currentLayer":value.get("currentLayer"),
        "layerCount":layer_count,
        "selectionCount":value.get("selectionCount"),
        "documentSignature":signature,
        "timelineSignature":timeline_signature,
        "runtimeVerified":false
    }))
}

pub fn validate_timeline_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Animate timeline receipt must explicitly be readOnly=true.".into());
    }
    let signature=value.get("documentSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=1600&&!v.chars().any(char::is_control))
        .ok_or("Animate timeline document signature is missing or invalid.")?;
    let timeline_signature=value.get("timelineSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=2000&&!v.chars().any(char::is_control))
        .ok_or("Animate timeline signature is missing or invalid.")?;
    let layers=value.get("layers").and_then(Value::as_array).ok_or("Animate timeline layers are required.")?;
    if layers.len()>256{return Err("Animate timeline layer receipt exceeds 256 layers.".into());}
    for row in layers{
        let index=row.get("index").and_then(Value::as_u64).ok_or("Animate layer index is invalid.")?;
        if index>100_000{return Err("Animate layer index exceeds supported bounds.".into());}
        if !bounded_text(row.get("name").and_then(Value::as_str),512){
            return Err("Animate layer name is missing or oversized.".into());
        }
        if !bounded_text(row.get("layerType").and_then(Value::as_str),120){
            return Err("Animate layer type is missing or oversized.".into());
        }
    }
    Ok(json!({
        "validated":true,
        "readOnly":true,
        "documentSignature":signature,
        "timelineSignature":timeline_signature,
        "timelineName":value.get("timelineName"),
        "currentFrame":value.get("currentFrame"),
        "currentLayer":value.get("currentLayer"),
        "sourceLayerCount":value.get("sourceLayerCount"),
        "returnedLayerCount":layers.len(),
        "truncated":value.get("truncated"),
        "layers":layers,
        "runtimeVerified":false
    }))
}


pub fn validate_identity_signature<'a>(value:&'a str,label:&str)->Result<&'a str,String>{
    let trimmed=value.trim();
    if trimmed.is_empty()||trimmed.len()>2000||trimmed.chars().any(char::is_control){
        return Err(format!("Animate expected {label} signature must be 1..2000 characters without control characters."));
    }
    Ok(trimmed)
}

pub fn validate_library_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Animate library receipt must explicitly be readOnly=true.".into());
    }
    validate_identity_signature(value.get("documentSignature").and_then(Value::as_str).unwrap_or(""),"document")?;
    validate_identity_signature(value.get("timelineSignature").and_then(Value::as_str).unwrap_or(""),"timeline")?;
    let items=value.get("items").and_then(Value::as_array).ok_or("Animate library items are required.")?;
    if items.len()>256{return Err("Animate library receipt exceeds 256 items.".into());}
    for item in items{
        let index=item.get("index").and_then(Value::as_u64).ok_or("Animate library item index is invalid.")?;
        if index>1_000_000{return Err("Animate library item index exceeds supported bounds.".into());}
        if !bounded_text(item.get("name").and_then(Value::as_str),1024){
            return Err("Animate library item name is missing or oversized.".into());
        }
        if !bounded_text(item.get("itemType").and_then(Value::as_str),160){
            return Err("Animate library item type is missing or oversized.".into());
        }
        for key in ["linkageClassName","symbolType"]{
            if let Some(text)=item.get(key).and_then(Value::as_str){
                if text.len()>512||text.chars().any(char::is_control){
                    return Err(format!("Animate library {key} is oversized or invalid."));
                }
            }
        }
    }
    Ok(value.clone())
}

pub fn validate_selection_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Animate selection receipt must explicitly be readOnly=true.".into());
    }
    validate_identity_signature(value.get("documentSignature").and_then(Value::as_str).unwrap_or(""),"document")?;
    validate_identity_signature(value.get("timelineSignature").and_then(Value::as_str).unwrap_or(""),"timeline")?;
    let signature=value.get("selectionSignature").and_then(Value::as_str).unwrap_or("");
    validate_identity_signature(signature,"selection snapshot")?;
    let elements=value.get("elements").and_then(Value::as_array).ok_or("Animate selection elements are required.")?;
    if elements.len()>64{return Err("Animate selection receipt exceeds 64 elements.".into());}
    for element in elements{
        let index=element.get("index").and_then(Value::as_u64).ok_or("Animate selected element index is invalid.")?;
        if index>100_000{return Err("Animate selected element index exceeds supported bounds.".into());}
        if !bounded_text(element.get("elementType").and_then(Value::as_str),160){
            return Err("Animate selected element type is missing or oversized.".into());
        }
        for key in ["name","instanceType","symbolType","libraryItemName","libraryItemType"]{
            if let Some(text)=element.get(key).and_then(Value::as_str){
                if text.len()>1024||text.chars().any(char::is_control){
                    return Err(format!("Animate selected element {key} is oversized or invalid."));
                }
            }
        }
    }
    Ok(value.clone())
}

pub fn validate_identity_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true)
        || value.get("mutationAuthorized").and_then(Value::as_bool)!=Some(false){
        return Err("Animate identity receipt must be read-only and must not authorize mutation.".into());
    }
    if value.get("documentIdentityMatched").and_then(Value::as_bool)!=Some(true)
        || value.get("timelineIdentityMatched").and_then(Value::as_bool)!=Some(true){
        return Err("Animate identity recheck did not confirm the expected document and timeline.".into());
    }
    validate_identity_signature(value.get("observedDocumentSignature").and_then(Value::as_str).unwrap_or(""),"observed document")?;
    validate_identity_signature(value.get("observedTimelineSignature").and_then(Value::as_str).unwrap_or(""),"observed timeline")?;
    Ok(value.clone())
}


#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerWriteRequest{
    pub expected_document_signature:String,
    pub expected_timeline_signature:String,
    pub expected_document_path:String,
    pub layer_index:u32,
    pub expected_layer_name:String,
    pub expected_layer_type:String,
    pub operation:String,
    pub expected_value:Value,
    pub value:Value,
    pub acknowledge_last_saved_disk_checkpoint:bool,
}

impl LayerWriteRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_identity_signature(&self.expected_document_signature,"document")?;
        validate_identity_signature(&self.expected_timeline_signature,"timeline")?;
        if self.expected_document_path.trim().is_empty()||self.expected_document_path.len()>MAX_PATH_BYTES
            ||self.expected_document_path.chars().any(char::is_control)||!Path::new(&self.expected_document_path).is_absolute(){
            return Err("Animate guarded write requires an exact absolute saved FLA path.".into());
        }
        let ext=Path::new(&self.expected_document_path).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
        if ext!="fla"{return Err("Animate guarded write is currently limited to existing local .fla documents.".into());}
        if self.layer_index>100_000{return Err("Animate layer index exceeds supported bounds.".into());}
        if !bounded_text(Some(&self.expected_layer_name),512)||!bounded_text(Some(&self.expected_layer_type),160){
            return Err("Animate expected layer identity is missing, oversized, or invalid.".into());
        }
        if !self.acknowledge_last_saved_disk_checkpoint{
            return Err("Animate guarded write requires acknowledge_last_saved_disk_checkpoint=true because the disk checkpoint protects the last-saved FLA, not unsaved in-memory edits.".into());
        }
        match self.operation.as_str(){
            "rename"=>{
                let before=self.expected_value.as_str().ok_or("Animate rename expected_value must be a string.")?;
                let after=self.value.as_str().ok_or("Animate rename value must be a string.")?;
                if before!=self.expected_layer_name{
                    return Err("Animate rename expected_value must equal the inspected layer name.".into());
                }
                if after.trim().is_empty()||after.len()>512||after.chars().any(char::is_control){
                    return Err("Animate layer name must be 1..512 characters without control characters.".into());
                }
                if before==after{return Err("Animate guarded write refuses a no-op rename.".into());}
            }
            "visible"|"locked"=>{
                let before=self.expected_value.as_bool().ok_or("Animate visible/locked expected_value must be boolean.")?;
                let after=self.value.as_bool().ok_or("Animate visible/locked value must be boolean.")?;
                if before==after{return Err("Animate guarded write refuses a no-op boolean change.".into());}
            }
            _=>return Err("Animate layer operation must be rename, visible, or locked.".into())
        }
        Ok(())
    }

    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "expectedDocumentSignature":self.expected_document_signature,
            "expectedTimelineSignature":self.expected_timeline_signature,
            "expectedDocumentPath":self.expected_document_path,
            "layerIndex":self.layer_index,
            "expectedLayerName":self.expected_layer_name,
            "expectedLayerType":self.expected_layer_type,
            "operation":self.operation,
            "expectedValue":self.expected_value,
            "value":self.value
        }))
    }
}

fn exact_json_value(a:&Value,b:&Value)->bool{
    match (a,b){
        (Value::Number(x),Value::Number(y))=>x.as_f64().zip(y.as_f64()).is_some_and(|(a,b)|(a-b).abs()<=1e-9),
        _=>a==b
    }
}

fn layer_property(row:&Value,operation:&str)->Option<Value>{
    match operation{
        "rename"=>row.get("name").cloned(),
        "visible"=>row.get("visible").cloned(),
        "locked"=>row.get("locked").cloned(),
        _=>None
    }
}

pub fn validate_layer_write_precondition(request:&LayerWriteRequest,context:&Value,timeline:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("hasDocument").and_then(Value::as_bool)!=Some(true)
        ||context.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||context.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||context.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str()){
        return Err("Animate guarded write requires the exact freshly inspected local document and timeline.".into());
    }
    if timeline.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||timeline.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||timeline.get("truncated").and_then(Value::as_bool)==Some(true){
        return Err("Animate guarded write requires a complete fresh timeline inventory with matching identity.".into());
    }
    let layers=timeline.get("layers").and_then(Value::as_array).ok_or("Animate timeline layer inventory is missing.")?;
    let row=layers.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(request.layer_index as u64))
        .ok_or("Animate target layer index is not present in the fresh timeline inventory.")?;
    if row.get("name").and_then(Value::as_str)!=Some(request.expected_layer_name.as_str())
        ||row.get("layerType").and_then(Value::as_str)!=Some(request.expected_layer_type.as_str()){
        return Err("Animate target layer identity changed; inspect timeline again.".into());
    }
    let observed=layer_property(row,&request.operation).ok_or("Animate target property is unavailable in the fresh timeline inventory.")?;
    if !exact_json_value(&observed,&request.expected_value){
        return Err("Animate target layer property changed; inspect timeline again before writing.".into());
    }
    Ok(json!({
        "fresh_identity_verified":true,
        "layer_index":request.layer_index,
        "operation":request.operation,
        "checkpoint_scope":"last_saved_disk_fla_only"
    }))
}

pub fn validate_layer_write_receipt(request:&LayerWriteRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutationPerformed").and_then(Value::as_bool)!=Some(true)
        ||value.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||value.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||value.get("layerIndex").and_then(Value::as_u64)!=Some(request.layer_index as u64)
        ||value.get("operation").and_then(Value::as_str)!=Some(request.operation.as_str())
        ||value.get("expectedLayerName").and_then(Value::as_str)!=Some(request.expected_layer_name.as_str())
        ||value.get("expectedLayerType").and_then(Value::as_str)!=Some(request.expected_layer_type.as_str()){
        return Err("Animate host mutation receipt does not match the approved target.".into());
    }
    let before=value.get("before").ok_or("Animate host mutation receipt is missing before state.")?;
    let after=value.get("after").ok_or("Animate host mutation receipt is missing after state.")?;
    if !exact_json_value(before,&request.expected_value)||!exact_json_value(after,&request.value){
        return Err("Animate host mutation receipt values do not match the approved request.".into());
    }
    if value.get("retrySafe").and_then(Value::as_bool)!=Some(false){
        return Err("Animate mutation receipt must explicitly disable blind retry.".into());
    }
    Ok(json!({
        "host_receipt_validated":true,
        "layer_index":request.layer_index,
        "operation":request.operation,
        "before":before,
        "after":after,
        "retry_safe":false
    }))
}

pub fn validate_layer_write_post_readback(request:&LayerWriteRequest,context:&Value,timeline:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("hasDocument").and_then(Value::as_bool)!=Some(true)
        ||context.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||context.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||context.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str()){
        return Err("Animate post-write document/timeline identity changed or is unavailable.".into());
    }
    if timeline.get("truncated").and_then(Value::as_bool)==Some(true)
        ||timeline.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||timeline.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str()){
        return Err("Animate post-write timeline readback is incomplete or stale.".into());
    }
    let layers=timeline.get("layers").and_then(Value::as_array).ok_or("Animate post-write layer inventory is missing.")?;
    let row=layers.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(request.layer_index as u64))
        .ok_or("Animate post-write target layer is missing.")?;
    if row.get("layerType").and_then(Value::as_str)!=Some(request.expected_layer_type.as_str()){
        return Err("Animate post-write layer type changed unexpectedly.".into());
    }
    if request.operation!="rename" && row.get("name").and_then(Value::as_str)!=Some(request.expected_layer_name.as_str()){
        return Err("Animate post-write layer identity changed unexpectedly.".into());
    }
    if request.operation=="rename" && row.get("name").and_then(Value::as_str)!=request.value.as_str(){
        return Err("Animate post-write rename readback does not match the approved value.".into());
    }
    let observed=layer_property(row,&request.operation).ok_or("Animate post-write property is unavailable.")?;
    if !exact_json_value(&observed,&request.value){
        return Err("Animate post-write readback does not match the approved value.".into());
    }
    Ok(json!({
        "post_state_verified":true,
        "layer_index":request.layer_index,
        "operation":request.operation,
        "observed":observed,
        "document_identity_stable":true,
        "timeline_identity_stable":true
    }))
}


#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishPlanRequest{
    pub expected_document_signature:String,
    pub expected_timeline_signature:String,
    pub expected_document_path:String,
    pub intent:String,
    pub expected_output_directory:String,
    pub overwrite_existing:bool,
}

impl PublishPlanRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_identity_signature(&self.expected_document_signature,"document")?;
        validate_identity_signature(&self.expected_timeline_signature,"timeline")?;
        if self.expected_document_path.trim().is_empty()||self.expected_document_path.len()>MAX_PATH_BYTES
            ||self.expected_document_path.chars().any(char::is_control)||!Path::new(&self.expected_document_path).is_absolute(){
            return Err("Animate publish plan requires an exact absolute local FLA path.".into());
        }
        if Path::new(&self.expected_document_path).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase()!="fla"{
            return Err("Animate publish plan is limited to an existing local .fla document.".into());
        }
        if self.intent!="current_document_publish"{
            return Err("Animate publish intent must be current_document_publish.".into());
        }
        if self.expected_output_directory.trim().is_empty()||self.expected_output_directory.len()>MAX_PATH_BYTES
            ||self.expected_output_directory.chars().any(char::is_control)||!Path::new(&self.expected_output_directory).is_absolute(){
            return Err("Animate publish plan requires an exact absolute expected output directory.".into());
        }
        if self.overwrite_existing{
            return Err("Animate 100% source publish planner refuses overwrite_existing=true.".into());
        }
        Ok(())
    }
}

pub fn plan_publish(request:&PublishPlanRequest,context:&Value,timeline:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("hasDocument").and_then(Value::as_bool)!=Some(true)
        ||context.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||context.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||context.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str()){
        return Err("Animate publish plan requires the exact freshly inspected local document and timeline.".into());
    }
    if timeline.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||timeline.get("timelineSignature").and_then(Value::as_str)!=Some(request.expected_timeline_signature.as_str())
        ||timeline.get("truncated").and_then(Value::as_bool)==Some(true){
        return Err("Animate publish plan requires a complete fresh timeline inventory with matching identity.".into());
    }
    Ok(json!({
        "plan_type":"animate_current_document_publish_preflight",
        "intent":request.intent,
        "document_path":request.expected_document_path,
        "expected_output_directory":request.expected_output_directory,
        "overwrite_existing":false,
        "document_identity_verified":true,
        "timeline_identity_verified":true,
        "mutation_performed":false,
        "publish_execution_supported":false,
        "export_execution_supported":false,
        "requires_real_host_acceptance_before_execution":true,
        "next_required_evidence":[
            "current Animate publish settings/profile inspection",
            "exact expected output artifact inventory",
            "host publish completion signal",
            "post-publish filesystem artifact verification"
        ],
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

pub fn completion_summary()->Value{
    json!({
        "integration":"adobe_animate",
        "source_milestone_percent":100,
        "source_scope_complete":true,
        "implemented_scope":{
            "detect_launch":true,
            "authenticated_cep_jsfl_bridge":true,
            "read_only_document_timeline_library_selection_inspection":true,
            "document_timeline_identity_guards":true,
            "guarded_layer_property_writes":["rename","visible","locked"],
            "last_saved_local_fla_checkpoint_integrity":true,
            "checkpoint_verification":true,
            "checkpoint_recovery_handoff":true,
            "independent_post_write_readback":true,
            "bounded_publish_export_preflight_planning":true,
            "canonical_source_acceptance_summary":true
        },
        "intentionally_unclaimed":[
            "arbitrary_jsfl_execution",
            "stable_persistent_stage_element_ids",
            "layer_create_delete_reorder",
            "frame_content_mutation",
            "drawing_or_stage_content_mutation",
            "library_or_symbol_mutation",
            "actionscript_mutation",
            "automatic_checkpoint_restore",
            "publish_or_export_execution",
            "save_or_save_as_automation",
            "runtime_acceptance"
        ],
        "safety_gates":[
            "permission-first typed high-risk layer mutations",
            "fresh exact document and timeline signatures",
            "exact layer index name type and expected value",
            "last-saved local FLA checkpoint before mutation",
            "checkpoint scope explicitly excludes unsaved in-memory edits",
            "no blind retry after uncertain mutation dispatch",
            "independent post-write readback",
            "recovery handoff is planning-only",
            "publish/export is preflight planning-only"
        ],
        "source_runtime_verified":false,
        "production_ready":false
    })
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn executable_path_is_bounded(){
        assert!(validate_requested_executable(r"C:\Program Files\Adobe\Adobe Animate 2026\Animate.exe").is_ok());
        assert!(validate_requested_executable(r"C:\Program Files\Adobe\Adobe Animate 2026\Photoshop.exe").is_err());
        assert!(validate_requested_executable("").is_err());
    }

    #[test]
    fn reports_do_not_promote_runtime(){
        let capability=capability_report();
        assert_eq!(capability["source_milestone_percent"],100);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"cep_plus_jsfl");
        assert_eq!(readiness["document_automation_ready"],"declared_bounded_source_scope_complete");
    }

    #[test]
    fn identity_signatures_are_bounded_and_never_authorize_mutation(){
        assert_eq!(validate_identity_signature("doc|1","document").unwrap(),"doc|1");
        assert!(validate_identity_signature("","document").is_err());
        let receipt=json!({
            "readOnly":true,
            "mutationAuthorized":false,
            "documentIdentityMatched":true,
            "timelineIdentityMatched":true,
            "observedDocumentSignature":"doc|1",
            "observedTimelineSignature":"timeline|1"
        });
        validate_identity_receipt(&receipt).unwrap();
    }

    #[test]
    fn guarded_layer_write_requires_exact_state_and_acknowledged_checkpoint_scope(){
        let path=std::env::temp_dir().join("animate-test.fla").to_string_lossy().into_owned();
        let request=LayerWriteRequest{
            expected_document_signature:"doc|1".into(),
            expected_timeline_signature:"timeline|1".into(),
            expected_document_path:path.clone(),
            layer_index:0,
            expected_layer_name:"Artwork".into(),
            expected_layer_type:"normal".into(),
            operation:"visible".into(),
            expected_value:json!(true),
            value:json!(false),
            acknowledge_last_saved_disk_checkpoint:true,
        };
        request.validate().unwrap();
        let context=json!({"hasDocument":true,"documentSignature":"doc|1","timelineSignature":"timeline|1","documentPath":path});
        let timeline=json!({"documentSignature":"doc|1","timelineSignature":"timeline|1","truncated":false,
            "layers":[{"index":0,"name":"Artwork","layerType":"normal","visible":true,"locked":false}]});
        assert_eq!(validate_layer_write_precondition(&request,&context,&timeline).unwrap()["fresh_identity_verified"],true);
        let receipt=json!({"mutationPerformed":true,"documentSignature":"doc|1","timelineSignature":"timeline|1",
            "layerIndex":0,"operation":"visible","expectedLayerName":"Artwork","expectedLayerType":"normal",
            "before":true,"after":false,"retrySafe":false});
        assert_eq!(validate_layer_write_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
        let post=json!({"documentSignature":"doc|1","timelineSignature":"timeline|1","truncated":false,
            "layers":[{"index":0,"name":"Artwork","layerType":"normal","visible":false,"locked":false}]});
        assert_eq!(validate_layer_write_post_readback(&request,&context,&post).unwrap()["post_state_verified"],true);
    }

    #[test]
    fn publish_planner_is_identity_guarded_and_execution_free(){
        let path=std::env::temp_dir().join("animate-publish.fla").to_string_lossy().into_owned();
        let out=std::env::temp_dir().join("animate-output").to_string_lossy().into_owned();
        let request=PublishPlanRequest{
            expected_document_signature:"doc|1".into(),
            expected_timeline_signature:"timeline|1".into(),
            expected_document_path:path.clone(),
            intent:"current_document_publish".into(),
            expected_output_directory:out,
            overwrite_existing:false,
        };
        let context=json!({"hasDocument":true,"documentSignature":"doc|1","timelineSignature":"timeline|1","documentPath":path});
        let timeline=json!({"documentSignature":"doc|1","timelineSignature":"timeline|1","truncated":false,"layers":[]});
        let plan=plan_publish(&request,&context,&timeline).unwrap();
        assert_eq!(plan["publish_execution_supported"],false);
        assert_eq!(plan["mutation_performed"],false);
    }

    #[test]
    fn completion_summary_never_promotes_runtime(){
        let summary=completion_summary();
        assert_eq!(summary["source_milestone_percent"],100);
        assert_eq!(summary["source_scope_complete"],true);
        assert_eq!(summary["source_runtime_verified"],false);
        assert_eq!(summary["production_ready"],false);
    }
}
