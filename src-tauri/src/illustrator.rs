use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;

fn valid_candidate_name(name:&str)->bool{
    name.starts_with("Adobe Illustrator")
        && !name.chars().any(char::is_control)
        && name.len()<=240
}

fn candidate_executable(dir:&Path)->Option<PathBuf>{
    let candidate=dir.join("Support Files").join("Contents").join("Windows").join("Illustrator.exe");
    if candidate.is_file(){return Some(candidate);}
    let flat=dir.join("Illustrator.exe");
    if flat.is_file(){return Some(flat);}
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
            "illustrator_exe":canonical,
            "source":source,
            "launch_supported":true,
            "host_transport":"cep_plus_extendscript",
            "future_host_transport":"bounded_cep_plus_extendscript",
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
            let Some(path)=candidate.get("illustrator_exe").and_then(Value::as_str) else{continue;};
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
        "host_transport":"cep_plus_extendscript",
        "future_host_transport":"bounded_cep_plus_extendscript",
        "source_runtime_verified":false,
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
            "launch_supported":false,"host_transport":"cep_plus_extendscript",
            "future_host_transport":"bounded_cep_plus_extendscript",
            "source_runtime_verified":false,"production_ready":false,
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
        "launch_supported":false,"host_transport":"cep_plus_extendscript",
        "future_host_transport":"bounded_cep_plus_extendscript",
        "source_runtime_verified":false,"production_ready":false,
        "reason":"Adobe Illustrator desktop detection is Windows-targeted in Shuvi."
    }))
}

pub fn validate_requested_executable(path:&str)->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Adobe Illustrator executable path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    let valid_name=p.file_name().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("Illustrator.exe"));
    if !p.is_absolute()||!valid_name{
        return Err("Adobe Illustrator executable must be an absolute path ending in Illustrator.exe.".into());
    }
    Ok(())
}

pub fn exact_detected_executable(report:&Value,requested:&str)->Result<PathBuf,String>{
    validate_requested_executable(requested)?;
    let requested=fs::canonicalize(requested).map_err(|e|format!("Requested Adobe Illustrator executable is unavailable: {e}"))?;
    let candidates=report.get("candidates").and_then(Value::as_array)
        .ok_or("Adobe Illustrator detection report has no candidate inventory.")?;
    for candidate in candidates{
        let Some(value)=candidate.get("illustrator_exe").and_then(Value::as_str) else{continue;};
        let Ok(path)=fs::canonicalize(value) else{continue;};
        if path==requested{return Ok(path);}
    }
    Err("Requested Adobe Illustrator executable is not one of Shuvi's freshly detected Program Files candidates.".into())
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_illustrator",
        "source_milestone_percent":80,
        "source_scope_complete":false,
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true,
            "authenticated_cep_extendscript_bridge":true,
            "document_inspection":true,
            "artboard_inspection":true,
            "layer_inspection":true,
            "page_item_inspection":true,
            "selection_inspection":true,
            "fresh_document_identity_recheck":true,
            "guarded_layer_property_writes":["rename","visible","locked"],
            "local_ai_checkpoint_integrity":true,
            "independent_post_write_readback":true
        },
        "planned_transport":{
            "kind":"cep_plus_extendscript",
            "illustrator_cep_host_id":"ILST",
            "implemented":true
        },
        "not_implemented":{
            "layer_create_delete_reorder":true,
            "page_item_mutation":true,
            "path_text_appearance_mutation":true,
            "save_automation":true,
            "export":true,
            "runtime_acceptance":true
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_illustrator",
        "source_milestone_percent":80,
        "source_coding_status":"guarded_layer_metadata_writes_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"cep_plus_extendscript",
        "planned_host_transport":"bounded_cep_plus_extendscript",
        "planned_cep_host_id":"ILST",
        "host_ready_verified":false,
        "bridge_scope":"bounded_inspection_plus_guarded_layer_metadata_writes",
        "document_automation_ready":"guarded_layer_metadata_only",
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"add canonical bounded source completion summary, checkpoint recovery handoff, and export preflight planning without arbitrary ExtendScript"
    })
}


fn bounded_text(value:Option<&str>,max:usize)->bool{
    value.is_some_and(|text|text.len()<=max&&!text.chars().any(char::is_control))
}

pub fn validate_context_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator context receipt must explicitly be readOnly=true.".into());
    }
    let has_document=value.get("hasDocument").and_then(Value::as_bool)
        .ok_or("Illustrator context hasDocument is required.")?;
    let signature=value.get("documentSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=2000&&!v.chars().any(char::is_control))
        .ok_or("Illustrator document signature is missing or invalid.")?;
    if !has_document{
        if signature!="no_document"{return Err("Closed Illustrator context must use no_document signature.".into());}
        return Ok(value.clone());
    }
    if !bounded_text(value.get("documentName").and_then(Value::as_str),512){
        return Err("Illustrator documentName is missing or oversized.".into());
    }
    if let Some(path)=value.get("documentPath").and_then(Value::as_str){
        if path.is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
            return Err("Illustrator documentPath is invalid or oversized.".into());
        }
    }
    let artboard_count=value.get("artboardCount").and_then(Value::as_u64)
        .filter(|v|*v<=100_000).ok_or("Illustrator artboardCount is invalid.")?;
    let active=value.get("activeArtboardIndex").and_then(Value::as_i64)
        .filter(|v|*v>=0).ok_or("Illustrator activeArtboardIndex is invalid.")?;
    if artboard_count>0 && active as u64>=artboard_count{
        return Err("Illustrator active artboard is outside the artboard inventory.".into());
    }
    for key in ["layerCount","pageItemCount","selectionCount"]{
        value.get(key).and_then(Value::as_u64)
            .filter(|v|*v<=10_000_000).ok_or_else(||format!("Illustrator {key} is invalid."))?;
    }
    Ok(json!({
        "validated":true,
        "readOnly":true,
        "hasDocument":true,
        "hostVersion":value.get("hostVersion"),
        "documentName":value.get("documentName"),
        "documentPath":value.get("documentPath").cloned().unwrap_or(Value::Null),
        "saved":value.get("saved"),
        "artboardCount":artboard_count,
        "activeArtboardIndex":active,
        "layerCount":value.get("layerCount"),
        "pageItemCount":value.get("pageItemCount"),
        "selectionCount":value.get("selectionCount"),
        "documentSignature":signature,
        "documentSignatureScope":value.get("documentSignatureScope"),
        "runtimeVerified":false
    }))
}

pub fn validate_artboard_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator artboard receipt must explicitly be readOnly=true.".into());
    }
    let signature=value.get("documentSignature").and_then(Value::as_str)
        .filter(|v|!v.is_empty()&&v.len()<=2000&&!v.chars().any(char::is_control))
        .ok_or("Illustrator artboard document signature is missing or invalid.")?;
    let artboards=value.get("artboards").and_then(Value::as_array)
        .ok_or("Illustrator artboards are required.")?;
    if artboards.len()>256{return Err("Illustrator artboard receipt exceeds 256 entries.".into());}
    for row in artboards{
        row.get("index").and_then(Value::as_u64)
            .filter(|v|*v<=100_000).ok_or("Illustrator artboard index is invalid.")?;
        if !bounded_text(row.get("name").and_then(Value::as_str),512){
            return Err("Illustrator artboard name is missing or oversized.".into());
        }
        let rect=row.get("rect").and_then(Value::as_array).ok_or("Illustrator artboard rect is missing.")?;
        if rect.len()!=4||rect.iter().any(|v|v.as_f64().is_none_or(|n|!n.is_finite()||n.abs()>1.0e9)){
            return Err("Illustrator artboard rect is invalid.".into());
        }
    }
    Ok(json!({
        "validated":true,
        "readOnly":true,
        "documentSignature":signature,
        "sourceArtboardCount":value.get("sourceArtboardCount"),
        "returnedArtboardCount":artboards.len(),
        "activeArtboardIndex":value.get("activeArtboardIndex"),
        "truncated":value.get("truncated"),
        "artboards":artboards,
        "runtimeVerified":false
    }))
}


pub fn validate_identity_signature(value:&str)->Result<&str,String>{
    let trimmed=value.trim();
    if trimmed.is_empty()||trimmed.len()>2000||trimmed.chars().any(char::is_control){
        return Err("Illustrator document signature must be 1..2000 characters without control characters.".into());
    }
    Ok(trimmed)
}

fn validate_rect(value:&Value,label:&str)->Result<(),String>{
    let rect=value.as_array().ok_or_else(||format!("Illustrator {label} bounds are missing."))?;
    if rect.len()!=4||rect.iter().any(|v|v.as_f64().is_none_or(|n|!n.is_finite()||n.abs()>1.0e9)){
        return Err(format!("Illustrator {label} bounds are invalid."));
    }
    Ok(())
}

pub fn validate_layer_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator layer receipt must explicitly be readOnly=true.".into());
    }
    validate_identity_signature(value.get("documentSignature").and_then(Value::as_str).unwrap_or(""))?;
    let layers=value.get("layers").and_then(Value::as_array).ok_or("Illustrator layers are required.")?;
    if layers.len()>256{return Err("Illustrator layer receipt exceeds 256 entries.".into());}
    for row in layers{
        row.get("index").and_then(Value::as_u64).filter(|v|*v<=100_000)
            .ok_or("Illustrator layer index is invalid.")?;
        if !bounded_text(row.get("name").and_then(Value::as_str),512){
            return Err("Illustrator layer name is missing or oversized.".into());
        }
        for key in ["visible","locked"]{
            if row.get(key).and_then(Value::as_bool).is_none(){return Err(format!("Illustrator layer {key} is invalid."));}
        }
        let opacity=row.get("opacity").and_then(Value::as_f64).filter(|v|v.is_finite()&&*v>=0.0&&*v<=100.0)
            .ok_or("Illustrator layer opacity is invalid.")?;
        let _=opacity;
        for key in ["nestedLayerCount","pageItemCount"]{
            row.get(key).and_then(Value::as_u64).filter(|v|*v<=10_000_000)
                .ok_or_else(||format!("Illustrator layer {key} is invalid."))?;
        }
        validate_identity_signature(row.get("layerSignature").and_then(Value::as_str).unwrap_or(""))?;
    }
    Ok(value.clone())
}

pub fn validate_page_item_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator page-item receipt must explicitly be readOnly=true.".into());
    }
    validate_identity_signature(value.get("documentSignature").and_then(Value::as_str).unwrap_or(""))?;
    let items=value.get("items").and_then(Value::as_array).ok_or("Illustrator page items are required.")?;
    if items.len()>256{return Err("Illustrator page-item receipt exceeds 256 entries.".into());}
    for row in items{
        row.get("index").and_then(Value::as_u64).filter(|v|*v<=10_000_000)
            .ok_or("Illustrator page-item index is invalid.")?;
        if !bounded_text(row.get("typename").and_then(Value::as_str),160){
            return Err("Illustrator page-item typename is missing or oversized.".into());
        }
        for key in ["name","layerName"]{
            if let Some(text)=row.get(key).and_then(Value::as_str){
                if text.len()>1024||text.chars().any(char::is_control){
                    return Err(format!("Illustrator page-item {key} is invalid."));
                }
            }
        }
        for key in ["locked","hidden"]{
            if row.get(key).and_then(Value::as_bool).is_none(){return Err(format!("Illustrator page-item {key} is invalid."));}
        }
        row.get("opacity").and_then(Value::as_f64).filter(|v|v.is_finite()&&*v>=0.0&&*v<=100.0)
            .ok_or("Illustrator page-item opacity is invalid.")?;
        validate_rect(row.get("geometricBounds").unwrap_or(&Value::Null),"page-item geometric")?;
        validate_identity_signature(row.get("itemSignature").and_then(Value::as_str).unwrap_or(""))?;
    }
    Ok(value.clone())
}

pub fn validate_selection_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator selection receipt must explicitly be readOnly=true.".into());
    }
    validate_identity_signature(value.get("documentSignature").and_then(Value::as_str).unwrap_or(""))?;
    validate_identity_signature(value.get("selectionSignature").and_then(Value::as_str).unwrap_or(""))?;
    let items=value.get("items").and_then(Value::as_array).ok_or("Illustrator selection items are required.")?;
    if items.len()>64{return Err("Illustrator selection receipt exceeds 64 entries.".into());}
    for row in items{
        row.get("index").and_then(Value::as_u64).filter(|v|*v<=100_000)
            .ok_or("Illustrator selected item index is invalid.")?;
        if !bounded_text(row.get("typename").and_then(Value::as_str),160){
            return Err("Illustrator selected item typename is missing or oversized.".into());
        }
        validate_identity_signature(row.get("itemSignature").and_then(Value::as_str).unwrap_or(""))?;
    }
    Ok(value.clone())
}

pub fn validate_identity_receipt(value:&Value)->Result<Value,String>{
    if value.get("readOnly").and_then(Value::as_bool)!=Some(true)
        ||value.get("mutationAuthorized").and_then(Value::as_bool)!=Some(false){
        return Err("Illustrator identity receipt must be read-only and must not authorize mutation.".into());
    }
    if value.get("documentIdentityMatched").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator identity recheck did not confirm the expected document.".into());
    }
    validate_identity_signature(value.get("observedDocumentSignature").and_then(Value::as_str).unwrap_or(""))?;
    Ok(value.clone())
}


#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerWriteRequest{
    pub expected_document_signature:String,
    pub expected_document_path:String,
    pub layer_index:u32,
    pub expected_layer_name:String,
    pub expected_layer_signature:String,
    pub operation:String,
    pub expected_value:Value,
    pub value:Value,
    pub acknowledge_last_saved_disk_checkpoint:bool,
}

impl LayerWriteRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_identity_signature(&self.expected_document_signature)?;
        validate_identity_signature(&self.expected_layer_signature)?;
        if self.expected_document_path.trim().is_empty()||self.expected_document_path.len()>MAX_PATH_BYTES
            ||self.expected_document_path.chars().any(char::is_control)||!Path::new(&self.expected_document_path).is_absolute(){
            return Err("Illustrator guarded write requires an exact absolute saved AI path.".into());
        }
        if Path::new(&self.expected_document_path).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase()!="ai"{
            return Err("Illustrator guarded write is currently limited to existing local .ai documents.".into());
        }
        if self.layer_index>100_000{return Err("Illustrator layer index exceeds supported bounds.".into());}
        if !bounded_text(Some(&self.expected_layer_name),512){
            return Err("Illustrator expected layer name is missing, oversized, or invalid.".into());
        }
        if !self.acknowledge_last_saved_disk_checkpoint{
            return Err("Illustrator guarded write requires acknowledge_last_saved_disk_checkpoint=true.".into());
        }
        match self.operation.as_str(){
            "rename"=>{
                let before=self.expected_value.as_str().ok_or("Illustrator rename expected_value must be a string.")?;
                let after=self.value.as_str().ok_or("Illustrator rename value must be a string.")?;
                if before!=self.expected_layer_name{
                    return Err("Illustrator rename expected_value must equal the inspected layer name.".into());
                }
                if after.trim().is_empty()||after.len()>512||after.chars().any(char::is_control){
                    return Err("Illustrator layer name must be 1..512 characters without control characters.".into());
                }
                if before==after{return Err("Illustrator guarded write refuses a no-op rename.".into());}
            }
            "visible"|"locked"=>{
                let before=self.expected_value.as_bool().ok_or("Illustrator visible/locked expected_value must be boolean.")?;
                let after=self.value.as_bool().ok_or("Illustrator visible/locked value must be boolean.")?;
                if before==after{return Err("Illustrator guarded write refuses a no-op boolean change.".into());}
            }
            _=>return Err("Illustrator layer operation must be rename, visible, or locked.".into())
        }
        Ok(())
    }

    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "expectedDocumentSignature":self.expected_document_signature,
            "expectedDocumentPath":self.expected_document_path,
            "layerIndex":self.layer_index,
            "expectedLayerName":self.expected_layer_name,
            "expectedLayerSignature":self.expected_layer_signature,
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

pub fn validate_layer_write_precondition(request:&LayerWriteRequest,context:&Value,layers:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("hasDocument").and_then(Value::as_bool)!=Some(true)
        ||context.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||context.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str())
        ||context.get("saved").and_then(Value::as_bool)!=Some(true){
        return Err("Illustrator guarded write requires the exact freshly inspected saved local document.".into());
    }
    if layers.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||layers.get("truncated").and_then(Value::as_bool)==Some(true){
        return Err("Illustrator guarded write requires a complete fresh top-level layer inventory with matching document identity.".into());
    }
    let rows=layers.get("layers").and_then(Value::as_array).ok_or("Illustrator layer inventory is missing.")?;
    let row=rows.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(request.layer_index as u64))
        .ok_or("Illustrator target layer index is not present in the fresh layer inventory.")?;
    if row.get("name").and_then(Value::as_str)!=Some(request.expected_layer_name.as_str())
        ||row.get("layerSignature").and_then(Value::as_str)!=Some(request.expected_layer_signature.as_str()){
        return Err("Illustrator target layer identity changed; inspect layers again.".into());
    }
    let observed=layer_property(row,&request.operation).ok_or("Illustrator target layer property is unavailable.")?;
    if !exact_json_value(&observed,&request.expected_value){
        return Err("Illustrator target layer property changed; inspect layers again before writing.".into());
    }
    Ok(json!({
        "fresh_identity_verified":true,
        "saved_document_verified":true,
        "layer_index":request.layer_index,
        "operation":request.operation,
        "checkpoint_scope":"last_saved_disk_ai_only"
    }))
}

pub fn validate_layer_write_receipt(request:&LayerWriteRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutationPerformed").and_then(Value::as_bool)!=Some(true)
        ||value.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||value.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str())
        ||value.get("layerIndex").and_then(Value::as_u64)!=Some(request.layer_index as u64)
        ||value.get("expectedLayerSignature").and_then(Value::as_str)!=Some(request.expected_layer_signature.as_str())
        ||value.get("operation").and_then(Value::as_str)!=Some(request.operation.as_str()){
        return Err("Illustrator host mutation receipt does not match the approved target.".into());
    }
    let before=value.get("before").ok_or("Illustrator host mutation receipt is missing before state.")?;
    let after=value.get("after").ok_or("Illustrator host mutation receipt is missing after state.")?;
    if !exact_json_value(before,&request.expected_value)||!exact_json_value(after,&request.value){
        return Err("Illustrator host mutation receipt values do not match the approved request.".into());
    }
    if value.get("retrySafe").and_then(Value::as_bool)!=Some(false){
        return Err("Illustrator mutation receipt must explicitly disable blind retry.".into());
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

pub fn validate_layer_write_post_readback(request:&LayerWriteRequest,context:&Value,layers:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("hasDocument").and_then(Value::as_bool)!=Some(true)
        ||context.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||context.get("documentPath").and_then(Value::as_str)!=Some(request.expected_document_path.as_str()){
        return Err("Illustrator post-write document identity changed or is unavailable.".into());
    }
    if layers.get("documentSignature").and_then(Value::as_str)!=Some(request.expected_document_signature.as_str())
        ||layers.get("truncated").and_then(Value::as_bool)==Some(true){
        return Err("Illustrator post-write layer readback is incomplete or stale.".into());
    }
    let rows=layers.get("layers").and_then(Value::as_array).ok_or("Illustrator post-write layer inventory is missing.")?;
    let row=rows.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(request.layer_index as u64))
        .ok_or("Illustrator post-write target layer is missing.")?;
    if request.operation!="rename" && row.get("name").and_then(Value::as_str)!=Some(request.expected_layer_name.as_str()){
        return Err("Illustrator post-write layer identity changed unexpectedly.".into());
    }
    if request.operation=="rename" && row.get("name").and_then(Value::as_str)!=request.value.as_str(){
        return Err("Illustrator post-write rename readback does not match the approved value.".into());
    }
    let observed=layer_property(row,&request.operation).ok_or("Illustrator post-write property is unavailable.")?;
    if !exact_json_value(&observed,&request.value){
        return Err("Illustrator post-write readback does not match the approved value.".into());
    }
    Ok(json!({
        "post_state_verified":true,
        "layer_index":request.layer_index,
        "operation":request.operation,
        "observed":observed,
        "document_identity_stable":true
    }))
}

#[cfg(test)]
mod tests{
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-illustrator-test-{}",uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    #[test]
    fn detects_only_bounded_illustrator_candidates(){
        let fixture=Fixture::new();
        let illustrator=fixture.0.join("Adobe").join("Adobe Illustrator 2026");
        let executable_dir=illustrator.join("Support Files").join("Contents").join("Windows");
        fs::create_dir_all(&executable_dir).unwrap();
        fs::write(executable_dir.join("Illustrator.exe"),b"fixture").unwrap();
        let other=fixture.0.join("Adobe").join("Adobe Photoshop 2026");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("Illustrator.exe"),b"wrong-folder").unwrap();
        let value=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(value["candidate_count"],1);
        assert_eq!(value["source_runtime_verified"],false);
        assert_eq!(value["candidates"][0]["name"],"Adobe Illustrator 2026");
    }

    #[test]
    fn requested_executable_requires_exact_fresh_candidate(){
        let fixture=Fixture::new();
        let dir=fixture.0.join("Adobe").join("Adobe Illustrator 2026").join("Support Files").join("Contents").join("Windows");
        fs::create_dir_all(&dir).unwrap();
        let exe=dir.join("Illustrator.exe");
        fs::write(&exe,b"fixture").unwrap();
        let report=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(exact_detected_executable(&report,exe.to_str().unwrap()).unwrap(),fs::canonicalize(exe).unwrap());
        let other=fixture.0.join("Illustrator.exe");
        fs::write(&other,b"other").unwrap();
        assert!(exact_detected_executable(&report,other.to_str().unwrap()).is_err());
    }

    #[test]
    fn reports_never_promote_unimplemented_host_or_runtime(){
        let capability=capability_report();
        assert_eq!(capability["source_milestone_percent"],80);
        assert_eq!(capability["planned_transport"]["illustrator_cep_host_id"],"ILST");
        assert_eq!(capability["planned_transport"]["implemented"],true);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"cep_plus_extendscript");
        assert_eq!(readiness["document_automation_ready"],"guarded_layer_metadata_only");
    }

    #[test]
    fn identity_receipt_never_authorizes_mutation(){
        assert_eq!(validate_identity_signature("doc|1").unwrap(),"doc|1");
        assert!(validate_identity_signature("").is_err());
        let receipt=json!({
            "readOnly":true,
            "mutationAuthorized":false,
            "documentIdentityMatched":true,
            "observedDocumentSignature":"doc|1"
        });
        assert_eq!(validate_identity_receipt(&receipt).unwrap()["mutationAuthorized"],false);
    }

    #[test]
    fn guarded_layer_write_requires_saved_exact_document_and_target_state(){
        let path=std::env::temp_dir().join("illustrator-test.ai").to_string_lossy().into_owned();
        let request=LayerWriteRequest{
            expected_document_signature:"doc|1".into(),
            expected_document_path:path.clone(),
            layer_index:0,
            expected_layer_name:"Artwork".into(),
            expected_layer_signature:"layer|1".into(),
            operation:"visible".into(),
            expected_value:json!(true),
            value:json!(false),
            acknowledge_last_saved_disk_checkpoint:true,
        };
        request.validate().unwrap();
        let context=json!({"hasDocument":true,"documentSignature":"doc|1","documentPath":path,"saved":true});
        let layers=json!({"documentSignature":"doc|1","truncated":false,
            "layers":[{"index":0,"name":"Artwork","visible":true,"locked":false,"layerSignature":"layer|1"}]});
        assert_eq!(validate_layer_write_precondition(&request,&context,&layers).unwrap()["fresh_identity_verified"],true);
        let receipt=json!({"mutationPerformed":true,"documentSignature":"doc|1","documentPath":context["documentPath"],
            "layerIndex":0,"expectedLayerSignature":"layer|1","operation":"visible","before":true,"after":false,"retrySafe":false});
        assert_eq!(validate_layer_write_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
        let post=json!({"documentSignature":"doc|1","truncated":false,
            "layers":[{"index":0,"name":"Artwork","visible":false,"locked":false,"layerSignature":"layer|2"}]});
        assert_eq!(validate_layer_write_post_readback(&request,&context,&post).unwrap()["post_state_verified"],true);
    }
}
