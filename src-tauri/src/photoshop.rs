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
        if layer.get("visible").and_then(Value::as_bool).is_none()||layer.get("has_children").and_then(Value::as_bool).is_none(){
            return Err("Photoshop layer boolean metadata is incomplete.".into());
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

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":40,
        "source_foundation_complete":true,
        "read_only_bridge_source_complete":true,
        "source_runtime_verified":false,
        "production_ready":false,
        "transport":{
            "kind":"uxp_localhost_poll_bridge",
            "implemented":true,
            "localhost":"127.0.0.1:17363",
            "token_paired":true,
            "read_only_actions":["inspect_context","list_layers"],
            "note":"40% milestone implements only authenticated read-only document/layer inspection."
        },
        "features":{
            "detect_install":"source_supported_bounded_program_files_scan",
            "launch_detected_install":"source_supported_permission_gated_exact_detected_executable",
            "capability_report":"source_supported",
            "readiness_report":"source_supported",
            "document_inspection":"source_supported_read_only_bounded_receipt_validated",
            "layer_inspection":"source_supported_read_only_256_layers_depth_8_receipt_validated",
            "pixel_or_layer_mutation":"not_implemented",
            "generative_fill":"not_implemented",
            "export":"not_implemented"
        },
        "safety":[
            "launch accepts only a freshly detected Photoshop.exe candidate",
            "UXP network permission is limited to Shuvi localhost bridge",
            "bridge action allowlist contains read-only inspection only",
            "host receipts are validated again in Rust",
            "no document mutation in this milestone",
            "no runtime acceptance claim without a real Windows Photoshop host"
        ]
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":40,
        "source_foundation_complete":true,
        "read_only_bridge_source_complete":true,
        "runtime_acceptance":{
            "windows_photoshop_detected":false,
            "photoshop_launch_verified":false,
            "uxp_bridge_verified":false,
            "document_readback_verified":false,
            "layer_inventory_verified":false,
            "mutation_readback_verified":false
        },
        "next_milestone":{
            "target_percent":60,
            "scope":[
                "permission-gated document and layer mutations",
                "exact expected document identity",
                "post-write readback",
                "checkpoint or duplicate-document safety boundary before destructive operations"
            ]
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
            "height":800,"resolution":72,"mode":"RGB","active_layer_ids":[3],"read_only":true});
        assert_eq!(validate_context_receipt(&context).unwrap()["document_id"],7);
        let inventory=json!({"document_open":true,"document_id":7,"layers":[
            {"id":3,"name":"Title","kind":"text","visible":true,"opacity":100,"depth":0,"parent_id":null,"has_children":false}
        ],"layer_count":1,"truncated":false,"read_only":true});
        assert_eq!(validate_layer_inventory(&inventory).unwrap()["layer_count"],1);
        let mut bad=inventory.clone();
        bad["layers"][0]["depth"]=json!(9);
        assert!(validate_layer_inventory(&bad).is_err());
    }

    #[test]
    fn reports_do_not_claim_runtime_or_mutation(){
        let capability=capability_report();
        assert_eq!(capability["milestone_percent"],40);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["features"]["pixel_or_layer_mutation"],"not_implemented");
        let readiness=readiness_report();
        assert_eq!(readiness["production_ready"],false);
        assert_eq!(readiness["next_milestone"]["target_percent"],60);
    }
}
