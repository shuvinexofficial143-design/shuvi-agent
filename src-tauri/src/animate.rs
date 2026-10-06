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
            "host_transport":"not_implemented",
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
        "host_transport":"not_implemented",
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
            "launch_supported":false,"host_transport":"not_implemented",
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
        "launch_supported":false,"host_transport":"not_implemented",
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
        "source_milestone_percent":20,
        "source_scope_complete":false,
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true
        },
        "not_implemented":{
            "host_bridge":true,
            "document_inspection":true,
            "timeline_inspection":true,
            "library_inspection":true,
            "symbol_instance_inspection":true,
            "timeline_mutation":true,
            "drawing_mutation":true,
            "publish_export":true,
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
        "source_milestone_percent":20,
        "source_coding_status":"foundation_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"not_implemented",
        "host_ready_verified":false,
        "document_automation_ready":false,
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"select and implement a bounded host transport with read-only document/timeline context before any mutation"
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
        assert_eq!(capability["source_milestone_percent"],20);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"not_implemented");
        assert_eq!(readiness["document_automation_ready"],false);
    }
}
