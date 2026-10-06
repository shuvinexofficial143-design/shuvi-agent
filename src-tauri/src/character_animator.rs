use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;

fn valid_candidate_name(name:&str)->bool{
    name.starts_with("Adobe Character Animator")
        && !name.chars().any(char::is_control)
        && name.len()<=240
}

fn candidate_executable(dir:&Path)->Option<PathBuf>{
    let support_files=dir.join("Support Files").join("Character Animator.exe");
    if support_files.is_file(){return Some(support_files);}
    let flat=dir.join("Character Animator.exe");
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
            "character_animator_exe":canonical,
            "source":source,
            "launch_supported":true,
            "host_transport":"not_implemented",
            "future_host_transport":"research_required",
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
            let Some(path)=candidate.get("character_animator_exe").and_then(Value::as_str) else{continue;};
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
        "future_host_transport":"research_required",
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
            "launch_supported":false,"host_transport":"not_implemented",
            "future_host_transport":"research_required",
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
        "launch_supported":false,"host_transport":"not_implemented",
        "future_host_transport":"research_required",
        "source_runtime_verified":false,"production_ready":false,
        "reason":"Adobe Character Animator desktop detection is Windows-targeted in Shuvi."
    }))
}

pub fn validate_requested_executable(path:&str)->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Adobe Character Animator executable path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    let valid_name=p.file_name().and_then(|v|v.to_str())
        .is_some_and(|v|v.eq_ignore_ascii_case("Character Animator.exe"));
    if !p.is_absolute()||!valid_name{
        return Err("Adobe Character Animator executable must be an absolute path ending in Character Animator.exe.".into());
    }
    Ok(())
}

pub fn exact_detected_executable(report:&Value,requested:&str)->Result<PathBuf,String>{
    validate_requested_executable(requested)?;
    let requested=fs::canonicalize(requested)
        .map_err(|e|format!("Requested Adobe Character Animator executable is unavailable: {e}"))?;
    let candidates=report.get("candidates").and_then(Value::as_array)
        .ok_or("Adobe Character Animator detection report has no candidate inventory.")?;
    for candidate in candidates{
        let Some(value)=candidate.get("character_animator_exe").and_then(Value::as_str) else{continue;};
        let Ok(path)=fs::canonicalize(value) else{continue;};
        if path==requested{return Ok(path);}
    }
    Err("Requested Adobe Character Animator executable is not one of Shuvi's freshly detected Program Files candidates.".into())
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_character_animator",
        "source_milestone_percent":20,
        "source_scope_complete":false,
        "implemented":{
            "bounded_windows_detection":true,
            "support_files_executable_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true
        },
        "automation_transport":{
            "status":"research_required",
            "implemented":false,
            "reason":"No current public Character Animator host automation surface is claimed without authoritative validation."
        },
        "not_implemented":{
            "host_bridge":true,
            "project_inspection":true,
            "scene_inspection":true,
            "puppet_inspection":true,
            "timeline_take_inspection":true,
            "recording_control":true,
            "project_mutation":true,
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
        "integration":"adobe_character_animator",
        "source_milestone_percent":20,
        "source_coding_status":"desktop_foundation_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"not_implemented",
        "future_host_transport":"research_required",
        "host_ready_verified":false,
        "project_automation_ready":false,
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"verify an authoritative bounded Character Animator automation surface before adding any project/scene/puppet inspection; if no supported host API is available, keep automation fail-closed"
    })
}

#[cfg(test)]
mod tests{
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-character-animator-test-{}",uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    #[test]
    fn detects_only_bounded_character_animator_candidates(){
        let fixture=Fixture::new();
        let app=fixture.0.join("Adobe").join("Adobe Character Animator 2026");
        let support=app.join("Support Files");
        fs::create_dir_all(&support).unwrap();
        fs::write(support.join("Character Animator.exe"),b"fixture").unwrap();

        let unrelated=fixture.0.join("Adobe").join("Adobe After Effects 2026");
        fs::create_dir_all(unrelated.join("Support Files")).unwrap();
        fs::write(unrelated.join("Support Files").join("Character Animator.exe"),b"wrong-folder").unwrap();

        let value=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(value["candidate_count"],1);
        assert_eq!(value["candidates"][0]["name"],"Adobe Character Animator 2026");
        assert_eq!(value["source_runtime_verified"],false);
    }

    #[test]
    fn requested_executable_requires_exact_fresh_candidate(){
        let fixture=Fixture::new();
        let support=fixture.0.join("Adobe").join("Adobe Character Animator 2026").join("Support Files");
        fs::create_dir_all(&support).unwrap();
        let exe=support.join("Character Animator.exe");
        fs::write(&exe,b"fixture").unwrap();
        let report=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(exact_detected_executable(&report,exe.to_str().unwrap()).unwrap(),fs::canonicalize(exe).unwrap());

        let other=fixture.0.join("Character Animator.exe");
        fs::write(&other,b"other").unwrap();
        assert!(exact_detected_executable(&report,other.to_str().unwrap()).is_err());
    }

    #[test]
    fn foundation_does_not_invent_host_transport_or_runtime(){
        let capability=capability_report();
        assert_eq!(capability["source_milestone_percent"],20);
        assert_eq!(capability["automation_transport"]["status"],"research_required");
        assert_eq!(capability["automation_transport"]["implemented"],false);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);

        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"not_implemented");
        assert_eq!(readiness["future_host_transport"],"research_required");
        assert_eq!(readiness["project_automation_ready"],false);
    }
}
