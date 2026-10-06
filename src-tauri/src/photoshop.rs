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

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":20,
        "source_foundation_complete":true,
        "source_runtime_verified":false,
        "production_ready":false,
        "transport":{
            "planned":"uxp_plugin_bridge",
            "implemented":false,
            "note":"No Photoshop host bridge or mutation route is claimed in the 20% foundation milestone."
        },
        "features":{
            "detect_install":"source_supported_bounded_program_files_scan",
            "launch_detected_install":"source_supported_permission_gated_exact_detected_executable",
            "capability_report":"source_supported",
            "readiness_report":"source_supported",
            "document_inspection":"planned_next_milestone",
            "layer_inspection":"planned_next_milestone",
            "pixel_or_layer_mutation":"not_implemented",
            "generative_fill":"not_implemented",
            "export":"not_implemented"
        },
        "safety":[
            "launch accepts only a freshly detected Photoshop.exe candidate",
            "no arbitrary Photoshop command line arguments",
            "no document mutation in this milestone",
            "no runtime acceptance claim without a real Windows Photoshop host"
        ]
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_photoshop",
        "milestone_percent":20,
        "source_foundation_complete":true,
        "runtime_acceptance":{
            "windows_photoshop_detected":false,
            "photoshop_launch_verified":false,
            "uxp_bridge_verified":false,
            "document_readback_verified":false,
            "mutation_readback_verified":false
        },
        "next_milestone":{
            "target_percent":40,
            "scope":[
                "bounded UXP bridge foundation",
                "active document identity/read-only context",
                "bounded layer inventory",
                "fresh host receipt identity"
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
    fn reports_do_not_claim_runtime_or_mutation(){
        let capability=capability_report();
        assert_eq!(capability["milestone_percent"],20);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["features"]["pixel_or_layer_mutation"],"not_implemented");
        let readiness=readiness_report();
        assert_eq!(readiness["production_ready"],false);
        assert_eq!(readiness["next_milestone"]["target_percent"],40);
    }
}
