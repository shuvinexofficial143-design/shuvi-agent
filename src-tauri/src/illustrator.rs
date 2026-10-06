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
        "source_milestone_percent":40,
        "source_scope_complete":false,
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true,
            "authenticated_cep_extendscript_bridge":true,
            "document_inspection":true,
            "artboard_inspection":true
        },
        "planned_transport":{
            "kind":"cep_plus_extendscript",
            "illustrator_cep_host_id":"ILST",
            "implemented":true
        },
        "not_implemented":{
            "layer_pageitem_inspection":true,
            "selection_inspection":true,
            "document_mutation":true,
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
        "source_milestone_percent":40,
        "source_coding_status":"read_only_bridge_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"cep_plus_extendscript",
        "planned_host_transport":"bounded_cep_plus_extendscript",
        "planned_cep_host_id":"ILST",
        "host_ready_verified":false,
        "bridge_scope":"read_only_document_and_artboards",
        "document_automation_ready":"read_only_only",
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"add bounded layer/page-item/selection inspection and stronger document identity guards before any mutation"
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
        assert_eq!(capability["source_milestone_percent"],40);
        assert_eq!(capability["planned_transport"]["illustrator_cep_host_id"],"ILST");
        assert_eq!(capability["planned_transport"]["implemented"],true);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"cep_plus_extendscript");
        assert_eq!(readiness["document_automation_ready"],"read_only_only");
    }
}
