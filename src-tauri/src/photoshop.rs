use serde::Deserialize;
use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;

fn valid_candidate_name(name:&str)->bool{
    name.starts_with("Adobe Photoshop")
        && !name.chars().any(char::is_control)
        && name.len()<=240
}

fn inspect_adobe_dir(adobe:&Path,source:&str)->Result<Vec<Value>,String>{
    if !adobe.is_dir(){return Ok(Vec::new());}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(MAX_ADOBE_ENTRIES){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !valid_candidate_name(&name){continue;}
        let exe=entry.path().join("Photoshop.exe");
        if !exe.is_file(){continue;}
        let canonical=fs::canonicalize(&exe).unwrap_or(exe);
        candidates.push(json!({
            "name":name,
            "photoshop_exe":canonical,
            "source":source,
            "launch_supported":true,
            "host_bridge_available":false,
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
            let Some(path)=candidate.get("photoshop_exe").and_then(Value::as_str) else {continue};
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
        "host_bridge_available":false,
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
            "launch_supported":false,"host_bridge_available":false,
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
        "launch_supported":false,"host_bridge_available":false,
        "runtime_verified":false,"production_ready":false,
        "reason":"Photoshop desktop detection is Windows-targeted in Shuvi."
    }))
}

pub fn validate_requested_executable(path:&str)->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Photoshop executable path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute() || p.file_name().and_then(|v|v.to_str()).is_none_or(|v|!v.eq_ignore_ascii_case("Photoshop.exe")){
        return Err("Photoshop executable must be an absolute path ending in Photoshop.exe.".into());
    }
    Ok(())
}

pub fn exact_detected_executable(report:&Value,requested:&str)->Result<PathBuf,String>{
    validate_requested_executable(requested)?;
    let requested=fs::canonicalize(requested).map_err(|e|format!("Requested Photoshop executable is unavailable: {e}"))?;
    let candidates=report.get("candidates").and_then(Value::as_array).ok_or("Photoshop detection report has no candidate inventory.")?;
    for candidate in candidates{
        let Some(value)=candidate.get("photoshop_exe").and_then(Value::as_str) else {continue};
        let Ok(path)=fs::canonicalize(value) else {continue};
        if path==requested{return Ok(path);}
    }
    Err("Requested Photoshop executable is not one of Shuvi's freshly detected Program Files candidates.".into())
}

fn bounded_text(value:Option<&str>,max:usize)->bool{
    value.is_some_and(|text|text.len()<=max&&!text.chars().any(char::is_control))
}

pub fn validate_context_receipt(value:&Value)->Result<Value,String>{
    let open=value.get("document_open").and_then(Value::as_bool).ok_or("Photoshop context document_open is required.")?;
    if value.get("read_only").and_then(Value::as_bool)!=Some(true){
        return Err("Photoshop 40% context receipt must explicitly be read_only=true.".into());
    }
    if !open{
        if !value.get("active_layer_ids").and_then(Value::as_array).is_some_and(|items|items.is_empty()){
            return Err("Closed Photoshop context must have no active layer IDs.".into());
        }
        return Ok(json!({"validated":true,"document_open":false,"read_only":true}));
    }
    let document_id=value.get("document_id").and_then(Value::as_u64)
        .filter(|id|*id>0&&*id<=u32::MAX as u64).ok_or("Photoshop context document_id is invalid.")?;
    if !bounded_text(value.get("title").and_then(Value::as_str),512){
        return Err("Photoshop context title is missing, oversized, or contains control characters.".into());
    }
    let active=value.get("active_layer_ids").and_then(Value::as_array).ok_or("Photoshop active_layer_ids are required.")?;
    if active.len()>32||active.iter().any(|id|id.as_u64().is_none_or(|v|v==0||v>u32::MAX as u64)){
        return Err("Photoshop active layer identity list is invalid or oversized.".into());
    }
    let saved=value.get("saved").and_then(Value::as_bool).ok_or("Photoshop context saved flag is required.")?;
    let cloud_document=value.get("cloud_document").and_then(Value::as_bool).ok_or("Photoshop context cloud_document flag is required.")?;
    let document_path=value.get("document_path").cloned().unwrap_or(Value::Null);
    if !document_path.is_null(){
        let path=document_path.as_str().ok_or("Photoshop document_path must be string or null.")?;
        if path.is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
            return Err("Photoshop document_path is invalid or oversized.".into());
        }
    }
    if saved&&!cloud_document&&document_path.as_str().is_none_or(|path|!Path::new(path).is_absolute()){
        return Err("Saved local Photoshop document requires an absolute document_path.".into());
    }
    Ok(json!({
        "validated":true,
        "document_open":true,
        "document_id":document_id,
        "title":value.get("title"),
        "width":value.get("width"),
        "height":value.get("height"),
        "resolution":value.get("resolution"),
        "mode":value.get("mode"),
        "active_layer_ids":active,
        "saved":saved,
        "cloud_document":cloud_document,
        "document_path":document_path,
        "read_only":true
    }))
}

pub fn validate_layer_inventory(value:&Value)->Result<Value,String>{
    if value.get("read_only").and_then(Value::as_bool)!=Some(true){
        return Err("Photoshop 40% layer receipt must explicitly be read_only=true.".into());
    }
    let open=value.get("document_open").and_then(Value::as_bool).ok_or("Photoshop layer receipt document_open is required.")?;
    let layers=value.get("layers").and_then(Value::as_array).ok_or("Photoshop layer inventory is missing.")?;
    if layers.len()>256{return Err("Photoshop layer inventory exceeds 256 entries.".into());}
    if !open{
        if !layers.is_empty(){return Err("Closed Photoshop document cannot return layers.".into());}
        return Ok(json!({"validated":true,"document_open":false,"layers":[],"layer_count":0,"truncated":false,"read_only":true}));
    }
    let document_id=value.get("document_id").and_then(Value::as_u64)
        .filter(|id|*id>0&&*id<=u32::MAX as u64).ok_or("Photoshop layer receipt document_id is invalid.")?;
    let mut ids=HashSet::new();
    for layer in layers{
        let id=layer.get("id").and_then(Value::as_u64)
            .filter(|id|*id>0&&*id<=u32::MAX as u64).ok_or("Photoshop layer ID is invalid.")?;
        if !ids.insert(id){return Err("Photoshop layer inventory contains duplicate IDs.".into());}
        if !bounded_text(layer.get("name").and_then(Value::as_str),512){
            return Err("Photoshop layer name is missing, oversized, or contains control characters.".into());
        }
        if layer.get("depth").and_then(Value::as_u64).is_none_or(|depth|depth>8){
            return Err("Photoshop layer depth exceeds the 40% inventory bound.".into());
        }
        if layer.get("parent_id").is_some_and(|parent|!parent.is_null()&&parent.as_u64().is_none_or(|id|id==0||id>u32::MAX as u64)){
            return Err("Photoshop layer parent ID is invalid.".into());
        }
        if layer.get("visible").and_then(Value::as_bool).is_none()||layer.get("has_children").and_then(Value::as_bool).is_none()
            ||layer.get("locked").and_then(Value::as_bool).is_none()||layer.get("position_locked").and_then(Value::as_bool).is_none(){
            return Err("Photoshop layer boolean metadata is incomplete.".into());
        }
        if let Some(bounds)=layer.get("bounds").filter(|value|!value.is_null()){
            let bounds=bounds.as_object().ok_or("Photoshop layer bounds must be object or null.")?;
            for key in ["left","top","right","bottom"]{
                if bounds.get(key).and_then(Value::as_f64).is_none_or(|v|!v.is_finite()||v.abs()>1.0e8){
                    return Err("Photoshop layer bounds are invalid or unbounded.".into());
                }
            }
        }
        if let Some(text)=layer.get("text").filter(|v|!v.is_null()){
            let object=text.as_object().ok_or("Photoshop text metadata must be object or null.")?;
            let contents=object.get("contents").and_then(Value::as_str).ok_or("Photoshop text contents are missing.")?;
            if contents.len()>16_384||contents.chars().any(|ch|ch=='\0'){
                return Err("Photoshop text contents exceed the 16 KiB source bound.".into());
            }
            let size=object.get("size").and_then(Value::as_f64)
                .filter(|v|v.is_finite()&&*v>0.0&&*v<=20_000.0)
                .ok_or("Photoshop text size is invalid.")?;
            let _=size;
        }
        for key in ["layer_mask_density","layer_mask_feather"]{
            if let Some(value)=layer.get(key).filter(|v|!v.is_null()){
                let number=value.as_f64().filter(|v|v.is_finite()).ok_or("Photoshop layer mask metadata is invalid.")?;
                if (key=="layer_mask_density"&&!(0.0..=100.0).contains(&number))
                    ||(key=="layer_mask_feather"&&!(0.0..=1000.0).contains(&number)){
                    return Err("Photoshop layer mask metadata is outside documented bounds.".into());
                }
            }
        }
    }
    let reported=value.get("layer_count").and_then(Value::as_u64).ok_or("Photoshop layer_count is missing.")? as usize;
    if reported!=layers.len(){return Err("Photoshop layer_count does not match its bounded inventory.".into());}
    let truncated=value.get("truncated").and_then(Value::as_bool).ok_or("Photoshop truncated flag is missing.")?;
    Ok(json!({
        "validated":true,
        "document_open":true,
        "document_id":document_id,
        "layers":layers,
        "layer_count":layers.len(),
        "truncated":truncated,
        "max_layers":256,
        "max_depth":8,
        "read_only":true
    }))
}

#[derive(Debug,Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerWriteRequest{
    pub expected_document_id:u32,
    pub layer_id:u32,
    pub operation:String,
    pub expected_value:Value,
    pub value:Value,
}

impl LayerWriteRequest{
    pub fn validate(&self)->Result<(),String>{
        if self.expected_document_id==0||self.layer_id==0{
            return Err("Photoshop write requires non-zero document and layer IDs.".into());
        }
        match self.operation.as_str(){
            "rename"=>{
                let expected=self.expected_value.as_str().ok_or("Photoshop rename expected_value must be the exact current layer name.")?;
                let value=self.value.as_str().ok_or("Photoshop rename value must be a string.")?;
                if !bounded_text(Some(expected),512)||!bounded_text(Some(value),512)||value.trim().is_empty(){
                    return Err("Photoshop layer names must be 1..512 bounded characters without control characters.".into());
                }
                if expected==value{return Err("Photoshop rename value already matches the expected current name.".into());}
            }
            "visible"=>{
                let expected=self.expected_value.as_bool().ok_or("Photoshop visible expected_value must be boolean.")?;
                let value=self.value.as_bool().ok_or("Photoshop visible value must be boolean.")?;
                if expected==value{return Err("Photoshop visibility already matches the requested value.".into());}
            }
            "opacity"=>{
                let expected=self.expected_value.as_f64().filter(|v|v.is_finite()&&(0.0..=100.0).contains(v))
                    .ok_or("Photoshop opacity expected_value must be a finite number from 0 to 100.")?;
                let value=self.value.as_f64().filter(|v|v.is_finite()&&(0.0..=100.0).contains(v))
                    .ok_or("Photoshop opacity value must be a finite number from 0 to 100.")?;
                if (expected-value).abs()<0.0001{return Err("Photoshop opacity already matches the requested value.".into());}
            }
            _=>return Err("Photoshop 60% write operation must be rename, visible, or opacity.".into()),
        }
        Ok(())
    }

    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "expected_document_id":self.expected_document_id,
            "layer_id":self.layer_id,
            "operation":self.operation,
            "expected_value":self.expected_value,
            "value":self.value
        }))
    }
}

fn layer_by_id<'a>(inventory:&'a Value,layer_id:u32)->Result<&'a Value,String>{
    inventory.get("layers").and_then(Value::as_array)
        .and_then(|layers|layers.iter().find(|layer|layer.get("id").and_then(Value::as_u64)==Some(layer_id as u64)))
        .ok_or("Photoshop layer ID is not present in the fresh bounded inventory.".into())
}

fn property_value(layer:&Value,operation:&str)->Result<Value,String>{
    match operation{
        "rename"=>layer.get("name").cloned().ok_or("Photoshop layer name is unavailable.".into()),
        "visible"=>layer.get("visible").cloned().ok_or("Photoshop layer visibility is unavailable.".into()),
        "opacity"=>layer.get("opacity").cloned().ok_or("Photoshop layer opacity is unavailable.".into()),
        _=>Err("Unsupported Photoshop layer property.".into()),
    }
}

fn primitive_matches(a:&Value,b:&Value,operation:&str)->bool{
    if operation=="opacity"{
        return a.as_f64().zip(b.as_f64()).is_some_and(|(left,right)|(left-right).abs()<=0.01);
    }
    a==b
}

pub fn validate_write_precondition(request:&LayerWriteRequest,context:&Value,inventory:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("document_open").and_then(Value::as_bool)!=Some(true)
        || context.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64){
        return Err("Photoshop active document does not match expected_document_id.".into());
    }
    if inventory.get("document_open").and_then(Value::as_bool)!=Some(true)
        || inventory.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64){
        return Err("Photoshop layer inventory is stale or belongs to another document.".into());
    }
    if inventory.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop layer inventory is truncated; exact write targeting is unsafe.".into());
    }
    let layer=layer_by_id(inventory,request.layer_id)?;
    let current=property_value(layer,&request.operation)?;
    if !primitive_matches(&current,&request.expected_value,&request.operation){
        return Err("Photoshop layer property changed since inspection; refresh before editing.".into());
    }
    Ok(json!({
        "document_id":request.expected_document_id,
        "layer_id":request.layer_id,
        "operation":request.operation,
        "expected_value":request.expected_value,
        "current_value":current,
        "fresh_identity_verified":true
    }))
}

pub fn validate_write_receipt(request:&LayerWriteRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutation_performed").and_then(Value::as_bool)!=Some(true)
        || value.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        || value.get("layer_id").and_then(Value::as_u64)!=Some(request.layer_id as u64)
        || value.get("operation").and_then(Value::as_str)!=Some(request.operation.as_str()){
        return Err("Photoshop mutation receipt identity does not match the approved request.".into());
    }
    let before=value.get("before").ok_or("Photoshop mutation receipt is missing before value.")?;
    let after=value.get("after").ok_or("Photoshop mutation receipt is missing after value.")?;
    if !primitive_matches(before,&request.expected_value,&request.operation){
        return Err("Photoshop mutation receipt before value does not match the approved expectation.".into());
    }
    if !primitive_matches(after,&request.value,&request.operation){
        return Err("Photoshop mutation receipt did not report the approved final value.".into());
    }
    if value.get("history_guard").and_then(Value::as_str)!=Some("suspend_resume_commit"){
        return Err("Photoshop mutation receipt is missing the expected history guard evidence.".into());
    }
    Ok(json!({
        "document_id":request.expected_document_id,
        "layer_id":request.layer_id,
        "operation":request.operation,
        "before":before,
        "after":after,
        "history_guard":"suspend_resume_commit",
        "host_receipt_validated":true
    }))
}

pub fn validate_post_write_readback(request:&LayerWriteRequest,inventory:&Value)->Result<Value,String>{
    if inventory.get("document_open").and_then(Value::as_bool)!=Some(true)
        || inventory.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        || inventory.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop post-write inventory is stale, truncated, or belongs to another document.".into());
    }
    let layer=layer_by_id(inventory,request.layer_id)?;
    let current=property_value(layer,&request.operation)?;
    if !primitive_matches(&current,&request.value,&request.operation){
        return Err("Photoshop post-write readback does not match the approved value.".into());
    }
    Ok(json!({
        "document_id":request.expected_document_id,
        "layer_id":request.layer_id,
        "operation":request.operation,
        "value":current,
        "post_state_verified":true
    }))
}

fn bounds_value(layer:&Value)->Result<Value,String>{
    layer.get("bounds").cloned().ok_or("Photoshop layer bounds are unavailable.".into())
}

fn bounds_match(a:&Value,b:&Value)->bool{
    ["left","top","right","bottom"].iter().all(|key|{
        a.get(*key).and_then(Value::as_f64).zip(b.get(*key).and_then(Value::as_f64))
            .is_some_and(|(left,right)|(left-right).abs()<=0.05)
    })
}

#[derive(Debug,Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextWriteRequest{
    pub expected_document_id:u32,
    pub layer_id:u32,
    pub expected_contents:String,
    pub expected_size:f64,
    pub contents:Option<String>,
    pub size:Option<f64>,
}

impl TextWriteRequest{
    pub fn validate(&self)->Result<(),String>{
        if self.expected_document_id==0||self.layer_id==0{return Err("Photoshop text edit requires non-zero document and layer IDs.".into());}
        if self.expected_contents.len()>16_384||self.expected_contents.chars().any(|ch|ch=='\0'){
            return Err("Photoshop expected text exceeds 16 KiB or contains NUL.".into());
        }
        if !self.expected_size.is_finite()||self.expected_size<=0.0||self.expected_size>20_000.0{
            return Err("Photoshop expected font size is invalid.".into());
        }
        if self.contents.is_none()&&self.size.is_none(){return Err("Photoshop text edit requires contents and/or size.".into());}
        if let Some(contents)=&self.contents{
            if contents.is_empty()||contents.len()>16_384||contents.chars().any(|ch|ch=='\0'){
                return Err("Photoshop text contents must be 1..16384 bytes and contain no NUL.".into());
            }
            if contents==&self.expected_contents&&self.size.is_none(){return Err("Photoshop text contents already match the requested value.".into());}
        }
        if let Some(size)=self.size{
            if !size.is_finite()||size<=0.0||size>20_000.0{return Err("Photoshop font size is outside the bounded source range.".into());}
            if (size-self.expected_size).abs()<0.001&&self.contents.is_none(){return Err("Photoshop font size already matches the requested value.".into());}
        }
        Ok(())
    }
    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "expected_document_id":self.expected_document_id,
            "layer_id":self.layer_id,
            "expected_contents":self.expected_contents,
            "expected_size":self.expected_size,
            "contents":self.contents,
            "size":self.size
        }))
    }
}

pub fn validate_text_precondition(request:&TextWriteRequest,context:&Value,inventory:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop text edit identity is stale or inventory is truncated.".into());
    }
    let layer=layer_by_id(inventory,request.layer_id)?;
    if layer.get("locked").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop text layer is locked.".into());
    }
    let text=layer.get("text").and_then(Value::as_object).ok_or("Target Photoshop layer is not an inspected text layer.")?;
    if text.get("contents").and_then(Value::as_str)!=Some(request.expected_contents.as_str()){
        return Err("Photoshop text contents changed since inspection.".into());
    }
    let current_size=text.get("size").and_then(Value::as_f64).ok_or("Photoshop text size is unavailable.")?;
    if (current_size-request.expected_size).abs()>0.01{return Err("Photoshop text size changed since inspection.".into());}
    Ok(json!({"document_id":request.expected_document_id,"layer_id":request.layer_id,"text_identity_verified":true}))
}

pub fn validate_text_receipt(request:&TextWriteRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutation_performed").and_then(Value::as_bool)!=Some(true)
        ||value.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||value.get("layer_id").and_then(Value::as_u64)!=Some(request.layer_id as u64)
        ||value.get("history_guard").and_then(Value::as_str)!=Some("suspend_resume_commit"){
        return Err("Photoshop text mutation receipt identity/history evidence is invalid.".into());
    }
    let before=value.get("before").and_then(Value::as_object).ok_or("Photoshop text receipt before state is missing.")?;
    let after=value.get("after").and_then(Value::as_object).ok_or("Photoshop text receipt after state is missing.")?;
    if before.get("contents").and_then(Value::as_str)!=Some(request.expected_contents.as_str())
        ||before.get("size").and_then(Value::as_f64).is_none_or(|v|(v-request.expected_size).abs()>0.01){
        return Err("Photoshop text receipt before state does not match approved expectation.".into());
    }
    let expected_contents=request.contents.as_deref().unwrap_or(&request.expected_contents);
    let expected_size=request.size.unwrap_or(request.expected_size);
    if after.get("contents").and_then(Value::as_str)!=Some(expected_contents)
        ||after.get("size").and_then(Value::as_f64).is_none_or(|v|(v-expected_size).abs()>0.01){
        return Err("Photoshop text receipt after state does not match approved values.".into());
    }
    Ok(json!({"host_receipt_validated":true,"before":before,"after":after,"history_guard":"suspend_resume_commit"}))
}

pub fn validate_text_post_readback(request:&TextWriteRequest,inventory:&Value)->Result<Value,String>{
    let layer=layer_by_id(inventory,request.layer_id)?;
    let text=layer.get("text").and_then(Value::as_object).ok_or("Photoshop post-write text metadata is unavailable.")?;
    let expected_contents=request.contents.as_deref().unwrap_or(&request.expected_contents);
    let expected_size=request.size.unwrap_or(request.expected_size);
    if text.get("contents").and_then(Value::as_str)!=Some(expected_contents)
        ||text.get("size").and_then(Value::as_f64).is_none_or(|v|(v-expected_size).abs()>0.01){
        return Err("Photoshop post-write text readback does not match approved values.".into());
    }
    Ok(json!({"post_state_verified":true,"document_id":request.expected_document_id,"layer_id":request.layer_id,
        "contents":expected_contents,"size":expected_size}))
}

#[derive(Debug,Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformRequest{
    pub expected_document_id:u32,
    pub layer_id:u32,
    pub operation:String,
    pub expected_bounds:Value,
    pub x:Option<f64>,
    pub y:Option<f64>,
    pub width_percent:Option<f64>,
    pub height_percent:Option<f64>,
    pub angle_degrees:Option<f64>,
}

impl TransformRequest{
    pub fn validate(&self)->Result<(),String>{
        if self.expected_document_id==0||self.layer_id==0{return Err("Photoshop transform requires non-zero document and layer IDs.".into());}
        for key in ["left","top","right","bottom"]{
            if self.expected_bounds.get(key).and_then(Value::as_f64).is_none_or(|v|!v.is_finite()||v.abs()>1.0e8){
                return Err("Photoshop transform expected_bounds are invalid.".into());
            }
        }
        match self.operation.as_str(){
            "translate"=>{
                let x=self.x.filter(|v|v.is_finite()&&v.abs()<=10_000.0).ok_or("Photoshop translate x must be within ±10000 px.")?;
                let y=self.y.filter(|v|v.is_finite()&&v.abs()<=10_000.0).ok_or("Photoshop translate y must be within ±10000 px.")?;
                if x.abs()<0.0001&&y.abs()<0.0001{return Err("Photoshop translate cannot be a no-op.".into());}
                if self.width_percent.is_some()||self.height_percent.is_some()||self.angle_degrees.is_some(){return Err("Photoshop translate received unrelated transform arguments.".into());}
            }
            "scale"=>{
                let w=self.width_percent.filter(|v|v.is_finite()&&*v>=1.0&&*v<=1000.0).ok_or("Photoshop scale width_percent must be 1..1000.")?;
                let h=self.height_percent.filter(|v|v.is_finite()&&*v>=1.0&&*v<=1000.0).ok_or("Photoshop scale height_percent must be 1..1000.")?;
                if (w-100.0).abs()<0.0001&&(h-100.0).abs()<0.0001{return Err("Photoshop scale cannot be a no-op.".into());}
                if self.x.is_some()||self.y.is_some()||self.angle_degrees.is_some(){return Err("Photoshop scale received unrelated transform arguments.".into());}
            }
            "rotate"=>{
                let angle=self.angle_degrees.filter(|v|v.is_finite()&&v.abs()<=360.0).ok_or("Photoshop rotate angle must be within ±360 degrees.")?;
                if angle.abs()<0.0001{return Err("Photoshop rotate cannot be a no-op.".into());}
                if self.x.is_some()||self.y.is_some()||self.width_percent.is_some()||self.height_percent.is_some(){return Err("Photoshop rotate received unrelated transform arguments.".into());}
            }
            _=>return Err("Photoshop transform operation must be translate, scale, or rotate.".into())
        }
        Ok(())
    }
    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "expected_document_id":self.expected_document_id,"layer_id":self.layer_id,"operation":self.operation,
            "expected_bounds":self.expected_bounds,"x":self.x,"y":self.y,
            "width_percent":self.width_percent,"height_percent":self.height_percent,"angle_degrees":self.angle_degrees
        }))
    }
}

pub fn validate_transform_precondition(request:&TransformRequest,context:&Value,inventory:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop transform identity is stale or inventory is truncated.".into());
    }
    let layer=layer_by_id(inventory,request.layer_id)?;
    if layer.get("locked").and_then(Value::as_bool)!=Some(false)||layer.get("position_locked").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop target layer is locked for transforms.".into());
    }
    let current=bounds_value(layer)?;
    if !bounds_match(&current,&request.expected_bounds){return Err("Photoshop layer bounds changed since inspection.".into());}
    Ok(json!({"document_id":request.expected_document_id,"layer_id":request.layer_id,"expected_bounds":current,"transform_identity_verified":true}))
}

pub fn validate_transform_receipt(request:&TransformRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutation_performed").and_then(Value::as_bool)!=Some(true)
        ||value.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||value.get("layer_id").and_then(Value::as_u64)!=Some(request.layer_id as u64)
        ||value.get("operation").and_then(Value::as_str)!=Some(request.operation.as_str())
        ||value.get("history_guard").and_then(Value::as_str)!=Some("suspend_resume_commit"){
        return Err("Photoshop transform receipt identity/history evidence is invalid.".into());
    }
    let before=value.get("before_bounds").ok_or("Photoshop transform receipt before_bounds missing.")?;
    let after=value.get("after_bounds").ok_or("Photoshop transform receipt after_bounds missing.")?;
    if !bounds_match(before,&request.expected_bounds){return Err("Photoshop transform receipt before bounds do not match approved expectation.".into());}
    if bounds_match(after,before){return Err("Photoshop transform receipt reports no geometric change.".into());}
    Ok(json!({"host_receipt_validated":true,"before_bounds":before,"after_bounds":after,"history_guard":"suspend_resume_commit"}))
}

pub fn validate_transform_post_readback(request:&TransformRequest,receipt:&Value,inventory:&Value)->Result<Value,String>{
    let layer=layer_by_id(inventory,request.layer_id)?;
    let current=bounds_value(layer)?;
    let after=receipt.get("after_bounds").ok_or("Photoshop transform receipt after_bounds unavailable.")?;
    if !bounds_match(&current,after){return Err("Photoshop independent transform readback does not match mutation receipt.".into());}
    Ok(json!({"post_state_verified":true,"document_id":request.expected_document_id,"layer_id":request.layer_id,"bounds":current}))
}

#[derive(Debug,Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaskWriteRequest{
    pub expected_document_id:u32,
    pub layer_id:u32,
    pub operation:String,
    pub expected_value:f64,
    pub value:f64,
}

impl MaskWriteRequest{
    pub fn validate(&self)->Result<(),String>{
        if self.expected_document_id==0||self.layer_id==0{return Err("Photoshop mask edit requires non-zero document and layer IDs.".into());}
        if !self.expected_value.is_finite()||!self.value.is_finite(){return Err("Photoshop mask values must be finite.".into());}
        let range=match self.operation.as_str(){
            "layer_mask_density"=>0.0..=100.0,
            "layer_mask_feather"=>0.0..=1000.0,
            _=>return Err("Photoshop mask operation must be layer_mask_density or layer_mask_feather.".into()),
        };
        if !range.contains(&self.expected_value)||!range.contains(&self.value){
            return Err("Photoshop mask value is outside its documented bound.".into());
        }
        if (self.expected_value-self.value).abs()<0.0001{return Err("Photoshop mask edit cannot be a no-op.".into());}
        Ok(())
    }
    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({"expected_document_id":self.expected_document_id,"layer_id":self.layer_id,
            "operation":self.operation,"expected_value":self.expected_value,"value":self.value}))
    }
}

fn mask_property(layer:&Value,operation:&str)->Result<f64,String>{
    layer.get(operation).and_then(Value::as_f64).filter(|v|v.is_finite())
        .ok_or("Photoshop target layer has no inspected compatible layer mask property.".into())
}

pub fn validate_mask_precondition(request:&MaskWriteRequest,context:&Value,inventory:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||inventory.get("truncated").and_then(Value::as_bool)!=Some(false){
        return Err("Photoshop mask edit identity is stale or inventory is truncated.".into());
    }
    let layer=layer_by_id(inventory,request.layer_id)?;
    if layer.get("locked").and_then(Value::as_bool)!=Some(false){return Err("Photoshop target layer is locked.".into());}
    let current=mask_property(layer,&request.operation)?;
    if (current-request.expected_value).abs()>0.01{return Err("Photoshop mask property changed since inspection.".into());}
    Ok(json!({"document_id":request.expected_document_id,"layer_id":request.layer_id,
        "operation":request.operation,"current_value":current,"mask_identity_verified":true}))
}

pub fn validate_mask_receipt(request:&MaskWriteRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("mutation_performed").and_then(Value::as_bool)!=Some(true)
        ||value.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||value.get("layer_id").and_then(Value::as_u64)!=Some(request.layer_id as u64)
        ||value.get("operation").and_then(Value::as_str)!=Some(request.operation.as_str())
        ||value.get("history_guard").and_then(Value::as_str)!=Some("suspend_resume_commit"){
        return Err("Photoshop mask receipt identity/history evidence is invalid.".into());
    }
    let before=value.get("before").and_then(Value::as_f64).ok_or("Photoshop mask receipt before value missing.")?;
    let after=value.get("after").and_then(Value::as_f64).ok_or("Photoshop mask receipt after value missing.")?;
    if (before-request.expected_value).abs()>0.01||(after-request.value).abs()>0.01{
        return Err("Photoshop mask receipt does not match approved values.".into());
    }
    Ok(json!({"host_receipt_validated":true,"before":before,"after":after,"history_guard":"suspend_resume_commit"}))
}

pub fn validate_mask_post_readback(request:&MaskWriteRequest,inventory:&Value)->Result<Value,String>{
    let layer=layer_by_id(inventory,request.layer_id)?;
    let current=mask_property(layer,&request.operation)?;
    if (current-request.value).abs()>0.01{return Err("Photoshop mask post-write readback does not match approved value.".into());}
    Ok(json!({"post_state_verified":true,"document_id":request.expected_document_id,"layer_id":request.layer_id,
        "operation":request.operation,"value":current}))
}

#[derive(Debug,Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest{
    pub expected_document_id:u32,
    pub expected_document_path:String,
    pub expected_saved:bool,
}

impl SaveRequest{
    pub fn validate(&self)->Result<(),String>{
        if self.expected_document_id==0{return Err("Photoshop save requires a non-zero document ID.".into());}
        if self.expected_saved{return Err("Photoshop guarded save requires inspected unsaved changes (expected_saved=false).".into());}
        if self.expected_document_path.is_empty()||self.expected_document_path.len()>MAX_PATH_BYTES
            ||self.expected_document_path.chars().any(char::is_control)||!Path::new(&self.expected_document_path).is_absolute(){
            return Err("Photoshop save requires an exact absolute saved document path.".into());
        }
        let ext=Path::new(&self.expected_document_path).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(),"psd"|"psb"){return Err("Photoshop guarded save is limited to existing PSD/PSB documents.".into());}
        Ok(())
    }
    pub fn bridge_arguments(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({"expected_document_id":self.expected_document_id,"expected_document_path":self.expected_document_path,
            "expected_saved":self.expected_saved}))
    }
}

pub fn validate_save_precondition(request:&SaveRequest,context:&Value)->Result<Value,String>{
    request.validate()?;
    if context.get("document_open").and_then(Value::as_bool)!=Some(true)
        ||context.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||context.get("saved").and_then(Value::as_bool)!=Some(request.expected_saved)
        ||context.get("cloud_document").and_then(Value::as_bool)!=Some(false)
        ||context.get("document_path").and_then(Value::as_str)!=Some(request.expected_document_path.as_str()){
        return Err("Photoshop guarded save requires the exact active local document, path and inspected saved state.".into());
    }
    Ok(json!({"document_id":request.expected_document_id,"document_path":request.expected_document_path,
        "save_identity_verified":true}))
}

pub fn validate_save_receipt(request:&SaveRequest,value:&Value)->Result<Value,String>{
    request.validate()?;
    if value.get("saved").and_then(Value::as_bool)!=Some(true)
        ||value.get("document_id").and_then(Value::as_u64)!=Some(request.expected_document_id as u64)
        ||value.get("document_path").and_then(Value::as_str)!=Some(request.expected_document_path.as_str())
        ||value.get("mutation_performed").and_then(Value::as_bool)!=Some(true){
        return Err("Photoshop save receipt does not match the approved document/path.".into());
    }
    Ok(json!({"host_receipt_validated":true,"saved":true,"document_id":request.expected_document_id,
        "document_path":request.expected_document_path}))
}

pub fn completion_summary()->Value{
    json!({
        "integration":"adobe_photoshop",
        "source_milestone_percent":100,
        "source_scope_complete":true,
        "implemented_scope":{
            "detect_launch":true,
            "authenticated_uxp_bridge":true,
            "read_only_document_layer_inspection":true,
            "layer_property_writes":["rename","visible","opacity"],
            "text_layer_writes":["contents","font_size"],
            "bounded_transforms":["translate","scale","rotate"],
            "layer_mask_controls":["density","feather"],
            "saved_psd_psb_checkpoint_integrity":true,
            "guarded_current_document_save":true,
            "independent_post_write_readback":true
        },
        "intentionally_unclaimed":[
            "arbitrary_batchPlay",
            "delete_merge_flatten_rasterize",
            "arbitrary_pixel_mutation",
            "generative_fill",
            "automatic_checkpoint_restore",
            "automatic arbitrary-path saveAs/export without a UXP file-token/user boundary"
        ],
        "safety_gates":[
            "permission-first typed high-risk mutations",
            "exact document and layer identity",
            "fresh expected-state preconditions",
            "bounded values and inventories",
            "executeAsModal history guard for host mutations",
            "checkpoint before advanced/disk-changing edits",
            "execution_status_unknown blocks blind retry",
            "independent post-write readback"
        ],
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":100,
        "source_foundation_complete":true,
        "read_only_bridge_source_complete":true,
        "guarded_layer_write_source_complete":true,
        "advanced_text_transform_source_complete":true,
        "saved_checkpoint_source_complete":true,
        "final_source_scope_complete":true,
        "source_runtime_verified":false,
        "production_ready":false,
        "transport":{
            "kind":"uxp_localhost_poll_bridge",
            "implemented":true,
            "localhost":"127.0.0.1:17363",
            "token_paired":true,
            "read_only_actions":["inspect_context","list_layers"],
            "guarded_mutation_actions":["set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"],
            "note":"100% source milestone includes the declared bounded Photoshop scope; arbitrary pixel/generative operations remain explicitly unclaimed."
        },
        "features":{
            "detect_install":"source_supported_bounded_program_files_scan",
            "launch_detected_install":"source_supported_permission_gated_exact_detected_executable",
            "capability_report":"source_supported",
            "readiness_report":"source_supported",
            "document_inspection":"source_supported_read_only_bounded_receipt_validated",
            "layer_inspection":"source_supported_read_only_256_layers_depth_8_receipt_validated",
            "layer_property_mutation":"source_supported_guarded_rename_visible_opacity",
            "text_layer_editing":"source_supported_checkpointed_contents_font_size",
            "layer_transforms":"source_supported_checkpointed_translate_scale_rotate",
            "checkpoint_recovery_evidence":"source_supported_saved_psd_psb_copy_sidecar_verify",
            "layer_mask_controls":"source_supported_checkpointed_density_feather",
            "guarded_document_save":"source_supported_checkpointed_existing_psd_psb",
            "canonical_source_acceptance_summary":"source_supported",
            "destructive_layer_mutation":"not_implemented",
            "pixel_or_layer_mutation":"limited_non_pixel_metadata_only",
            "generative_fill":"not_implemented",
            "export":"not_implemented"
        },
        "safety":[
            "launch accepts only a freshly detected Photoshop.exe candidate",
            "UXP network permission is limited to Shuvi localhost bridge",
            "mutation allowlist contains only rename, visible and opacity layer properties",
            "fresh document/layer identity and exact expected property are required before mutation",
            "writes use executeAsModal with a Photoshop history suspension and explicit commit",
            "host mutation receipts and an independent post-write layer inventory are validated in Rust",
            "text/transform writes require a saved local PSD/PSB checkpoint before host mutation",
            "delete/merge/rasterize/pixel writes remain unavailable",
            "no runtime acceptance claim without a real Windows Photoshop host"
        ]
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":100,
        "source_foundation_complete":true,
        "read_only_bridge_source_complete":true,
        "runtime_acceptance":{
            "windows_photoshop_detected":false,
            "photoshop_launch_verified":false,
            "uxp_bridge_verified":false,
            "document_readback_verified":false,
            "layer_inventory_verified":false,
            "mutation_readback_verified":false,
            "history_guard_runtime_verified":false
        },
        "source_completion":{
            "declared_scope_complete":true,
            "canonical_summary_tool":"photoshop_acceptance_summary",
            "runtime_acceptance_pending":true
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

#[cfg(test)]
mod tests{
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-photoshop-test-{}",uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    #[test]
    fn detects_only_bounded_photoshop_candidates(){
        let fixture=Fixture::new();
        let photoshop=fixture.0.join("Adobe").join("Adobe Photoshop 2026");
        let illustrator=fixture.0.join("Adobe").join("Adobe Illustrator 2026");
        fs::create_dir_all(&photoshop).unwrap();
        fs::create_dir_all(&illustrator).unwrap();
        fs::write(photoshop.join("Photoshop.exe"),b"fixture").unwrap();
        fs::write(illustrator.join("Illustrator.exe"),b"fixture").unwrap();
        let value=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(value["candidate_count"],1);
        assert_eq!(value["runtime_verified"],false);
        assert_eq!(value["candidates"][0]["name"],"Adobe Photoshop 2026");
    }

    #[test]
    fn requested_executable_requires_exact_fresh_candidate(){
        let fixture=Fixture::new();
        let photoshop=fixture.0.join("Adobe").join("Adobe Photoshop 2026");
        fs::create_dir_all(&photoshop).unwrap();
        let exe=photoshop.join("Photoshop.exe");
        fs::write(&exe,b"fixture").unwrap();
        let report=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(exact_detected_executable(&report,exe.to_str().unwrap()).unwrap(),fs::canonicalize(exe).unwrap());
        let other=fixture.0.join("Photoshop.exe");
        fs::write(&other,b"other").unwrap();
        assert!(exact_detected_executable(&report,other.to_str().unwrap()).is_err());
    }

    #[test]
    fn validates_read_only_context_and_bounded_layer_inventory(){
        let context=json!({"document_open":true,"document_id":7,"title":"demo.psd","width":1000,
            "height":800,"resolution":72,"mode":"RGB","active_layer_ids":[3],
            "saved":true,"cloud_document":false,"document_path":std::env::temp_dir().join("demo.psd"),"read_only":true});
        assert_eq!(validate_context_receipt(&context).unwrap()["document_id"],7);
        let inventory=json!({"document_open":true,"document_id":7,"layers":[
            {"id":3,"name":"Title","kind":"text","visible":true,"opacity":100,"depth":0,"parent_id":null,"has_children":false,
             "locked":false,"position_locked":false,"bounds":{"left":0.0,"top":0.0,"right":200.0,"bottom":50.0},
             "text":{"contents":"Hello","size":24.0}}
        ],"layer_count":1,"truncated":false,"read_only":true});
        assert_eq!(validate_layer_inventory(&inventory).unwrap()["layer_count"],1);
        let mut bad=inventory.clone();
        bad["layers"][0]["depth"]=json!(9);
        assert!(validate_layer_inventory(&bad).is_err());
    }

    #[test]
    fn guarded_layer_write_requires_exact_fresh_precondition(){
        let request=LayerWriteRequest{
            expected_document_id:7,layer_id:3,operation:"rename".into(),
            expected_value:json!("Title"),value:json!("Headline")
        };
        let context=json!({"document_open":true,"document_id":7});
        let inventory=json!({"document_open":true,"document_id":7,"truncated":false,"layers":[
            {"id":3,"name":"Title","visible":true,"opacity":100}
        ]});
        assert_eq!(validate_write_precondition(&request,&context,&inventory).unwrap()["fresh_identity_verified"],true);
        let mut stale=inventory.clone();stale["layers"][0]["name"]=json!("Changed");
        assert!(validate_write_precondition(&request,&context,&stale).is_err());
    }

    #[test]
    fn guarded_layer_write_receipt_and_post_readback_are_exact(){
        let request=LayerWriteRequest{
            expected_document_id:7,layer_id:3,operation:"opacity".into(),
            expected_value:json!(100.0),value:json!(72.5)
        };
        let receipt=json!({"mutation_performed":true,"document_id":7,"layer_id":3,"operation":"opacity",
            "before":100.0,"after":72.5,"history_guard":"suspend_resume_commit"});
        assert_eq!(validate_write_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
        let inventory=json!({"document_open":true,"document_id":7,"truncated":false,"layers":[
            {"id":3,"name":"Title","visible":true,"opacity":72.5}
        ]});
        assert_eq!(validate_post_write_readback(&request,&inventory).unwrap()["post_state_verified"],true);
        let mut wrong=inventory.clone();wrong["layers"][0]["opacity"]=json!(80.0);
        assert!(validate_post_write_readback(&request,&wrong).is_err());
    }

    #[test]
    fn guarded_layer_write_rejects_destructive_or_noop_operations(){
        let base=LayerWriteRequest{expected_document_id:1,layer_id:2,operation:"delete".into(),
            expected_value:json!(true),value:json!(false)};
        assert!(base.validate().is_err());
        let noop=LayerWriteRequest{expected_document_id:1,layer_id:2,operation:"visible".into(),
            expected_value:json!(true),value:json!(true)};
        assert!(noop.validate().is_err());
    }

    #[test]
    fn text_edit_requires_exact_text_identity(){
        let request=TextWriteRequest{expected_document_id:7,layer_id:3,expected_contents:"Hello".into(),expected_size:24.0,
            contents:Some("World".into()),size:Some(30.0)};
        let context=json!({"document_id":7});
        let inventory=json!({"document_id":7,"truncated":false,"layers":[
            {"id":3,"locked":false,"text":{"contents":"Hello","size":24.0}}
        ]});
        assert_eq!(validate_text_precondition(&request,&context,&inventory).unwrap()["text_identity_verified"],true);
        let receipt=json!({"mutation_performed":true,"document_id":7,"layer_id":3,"history_guard":"suspend_resume_commit",
            "before":{"contents":"Hello","size":24.0},"after":{"contents":"World","size":30.0}});
        assert_eq!(validate_text_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
        let post=json!({"layers":[{"id":3,"text":{"contents":"World","size":30.0}}]});
        assert_eq!(validate_text_post_readback(&request,&post).unwrap()["post_state_verified"],true);
    }

    #[test]
    fn transform_requires_exact_unlocked_bounds_and_post_readback(){
        let request=TransformRequest{expected_document_id:7,layer_id:3,operation:"translate".into(),
            expected_bounds:json!({"left":0.0,"top":0.0,"right":100.0,"bottom":100.0}),
            x:Some(10.0),y:Some(20.0),width_percent:None,height_percent:None,angle_degrees:None};
        let context=json!({"document_id":7});
        let inventory=json!({"document_id":7,"truncated":false,"layers":[
            {"id":3,"locked":false,"position_locked":false,"bounds":{"left":0.0,"top":0.0,"right":100.0,"bottom":100.0}}
        ]});
        assert!(validate_transform_precondition(&request,&context,&inventory).is_ok());
        let receipt=json!({"mutation_performed":true,"document_id":7,"layer_id":3,"operation":"translate",
            "history_guard":"suspend_resume_commit","before_bounds":{"left":0.0,"top":0.0,"right":100.0,"bottom":100.0},
            "after_bounds":{"left":10.0,"top":20.0,"right":110.0,"bottom":120.0}});
        let validated=validate_transform_receipt(&request,&receipt).unwrap();
        let post=json!({"layers":[{"id":3,"bounds":{"left":10.0,"top":20.0,"right":110.0,"bottom":120.0}}]});
        assert_eq!(validate_transform_post_readback(&request,&validated, &post).unwrap()["post_state_verified"],true);
    }

    #[test]
    fn mask_edit_requires_exact_inspected_property(){
        let request=MaskWriteRequest{expected_document_id:7,layer_id:3,operation:"layer_mask_density".into(),
            expected_value:100.0,value:75.0};
        let context=json!({"document_id":7});
        let inventory=json!({"document_id":7,"truncated":false,"layers":[
            {"id":3,"locked":false,"layer_mask_density":100.0}
        ]});
        assert_eq!(validate_mask_precondition(&request,&context,&inventory).unwrap()["mask_identity_verified"],true);
        let receipt=json!({"mutation_performed":true,"document_id":7,"layer_id":3,"operation":"layer_mask_density",
            "before":100.0,"after":75.0,"history_guard":"suspend_resume_commit"});
        assert_eq!(validate_mask_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
        let post=json!({"layers":[{"id":3,"layer_mask_density":75.0}]});
        assert_eq!(validate_mask_post_readback(&request,&post).unwrap()["post_state_verified"],true);
    }

    #[test]
    fn guarded_save_requires_exact_saved_local_psd(){
        let path=std::env::temp_dir().join("design.psd").to_string_lossy().into_owned();
        let request=SaveRequest{expected_document_id:7,expected_document_path:path.clone(),expected_saved:false};
        let context=json!({"document_open":true,"document_id":7,"saved":false,"cloud_document":false,
            "document_path":path});
        assert_eq!(validate_save_precondition(&request,&context).unwrap()["save_identity_verified"],true);
        let receipt=json!({"saved":true,"document_id":7,"document_path":request.expected_document_path,"mutation_performed":true});
        assert_eq!(validate_save_receipt(&request,&receipt).unwrap()["host_receipt_validated"],true);
    }

    #[test]
    fn completion_summary_never_claims_runtime_readiness(){
        let summary=completion_summary();
        assert_eq!(summary["source_milestone_percent"],100);
        assert_eq!(summary["source_scope_complete"],true);
        assert_eq!(summary["source_runtime_verified"],false);
        assert_eq!(summary["production_ready"],false);
    }

    #[test]
    fn reports_do_not_claim_runtime_or_mutation(){
        let capability=capability_report();
        assert_eq!(capability["milestone_percent"],100);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["features"]["destructive_layer_mutation"],"not_implemented");
        let readiness=readiness_report();
        assert_eq!(readiness["production_ready"],false);
        assert_eq!(readiness["source_completion"]["declared_scope_complete"],true);
    }
}
