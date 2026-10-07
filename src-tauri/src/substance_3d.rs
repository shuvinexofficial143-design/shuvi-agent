use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;

const APPS:&[(&str,&str,&str)]=&[
    ("painter","Adobe Substance 3D Painter","Adobe Substance 3D Painter.exe"),
    ("designer","Adobe Substance 3D Designer","Adobe Substance 3D Designer.exe"),
    ("sampler","Adobe Substance 3D Sampler","Adobe Substance 3D Sampler.exe"),
    ("stager","Adobe Substance 3D Stager","Adobe Substance 3D Stager.exe"),
    ("modeler","Adobe Substance 3D Modeler","Adobe Substance 3D Modeler.exe"),
];

fn app_definition_from_folder(name:&str)->Option<(&'static str,&'static str,&'static str)>{
    APPS.iter().copied().find(|(_,folder,_)|name.eq_ignore_ascii_case(folder))
}

fn app_definition_from_id(app_id:&str)->Option<(&'static str,&'static str,&'static str)>{
    APPS.iter().copied().find(|(id,_,_)|app_id.eq_ignore_ascii_case(id))
}

fn candidate_executable(dir:&Path,exe_name:&str)->Option<PathBuf>{
    let flat=dir.join(exe_name);
    if flat.is_file(){return Some(flat);}
    let bin=dir.join("bin").join(exe_name);
    if bin.is_file(){return Some(bin);}
    None
}

fn inspect_adobe_dir(adobe:&Path,source:&str)->Result<Vec<Value>,String>{
    if !adobe.is_dir(){return Ok(Vec::new());}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(MAX_ADOBE_ENTRIES){
        let entry=entry.map_err(|e|e.to_string())?;
        let folder_name=entry.file_name().to_string_lossy().into_owned();
        if folder_name.len()>240||folder_name.chars().any(char::is_control){continue;}
        let Some((app_id,product_name,exe_name))=app_definition_from_folder(&folder_name) else{continue;};
        let Some(exe)=candidate_executable(&entry.path(),exe_name) else{continue;};
        let canonical=fs::canonicalize(&exe).unwrap_or(exe);
        candidates.push(json!({
            "app_id":app_id,
            "name":product_name,
            "substance_exe":canonical,
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
            let Some(path)=candidate.get("substance_exe").and_then(Value::as_str) else{continue;};
            let key=path.to_ascii_lowercase();
            if seen.insert(key){candidates.push(candidate);}
            if candidates.len()>=16{break;}
        }
        if candidates.len()>=16{break;}
    }
    candidates.sort_by(|a,b|{
        a.get("app_id").and_then(Value::as_str).unwrap_or("")
            .cmp(b.get("app_id").and_then(Value::as_str).unwrap_or(""))
    });
    Ok(json!({
        "schema_version":1,
        "integration":"adobe_substance_3d",
        "candidates":candidates,
        "candidate_count":candidates.len(),
        "supported_app_ids":["painter","designer","sampler","stager","modeler"],
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
            "schema_version":1,"integration":"adobe_substance_3d","candidates":[],"candidate_count":0,
            "supported_app_ids":["painter","designer","sampler","stager","modeler"],
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
        "schema_version":1,"integration":"adobe_substance_3d","candidates":[],"candidate_count":0,
        "supported_app_ids":["painter","designer","sampler","stager","modeler"],
        "detection_scope":"windows_only",
        "launch_supported":false,"host_transport":"not_implemented",
        "future_host_transport":"research_required",
        "source_runtime_verified":false,"production_ready":false,
        "reason":"Adobe Substance 3D desktop detection is Windows-targeted in Shuvi."
    }))
}

pub fn validate_requested_executable(app_id:&str,path:&str)->Result<(),String>{
    let Some((_,_,expected_exe))=app_definition_from_id(app_id) else{
        return Err("Substance 3D app_id must be painter, designer, sampler, stager, or modeler.".into());
    };
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Adobe Substance 3D executable path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    let valid_name=p.file_name().and_then(|v|v.to_str())
        .is_some_and(|v|v.eq_ignore_ascii_case(expected_exe));
    if !p.is_absolute()||!valid_name{
        return Err(format!("Adobe Substance 3D {app_id} executable must be an absolute path ending in {expected_exe}."));
    }
    Ok(())
}

pub fn exact_detected_executable(report:&Value,app_id:&str,requested:&str)->Result<PathBuf,String>{
    validate_requested_executable(app_id,requested)?;
    let requested=fs::canonicalize(requested)
        .map_err(|e|format!("Requested Adobe Substance 3D executable is unavailable: {e}"))?;
    let candidates=report.get("candidates").and_then(Value::as_array)
        .ok_or("Adobe Substance 3D detection report has no candidate inventory.")?;
    for candidate in candidates{
        if candidate.get("app_id").and_then(Value::as_str)!=Some(app_id){continue;}
        let Some(value)=candidate.get("substance_exe").and_then(Value::as_str) else{continue;};
        let Ok(path)=fs::canonicalize(value) else{continue;};
        if path==requested{return Ok(path);}
    }
    Err("Requested Adobe Substance 3D executable is not the exact freshly detected candidate for the requested app_id.".into())
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_substance_3d",
        "source_milestone_percent":20,
        "source_scope_complete":false,
        "suite_apps":["painter","designer","sampler","stager","modeler"],
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true
        },
        "not_implemented":{
            "host_transport":true,
            "project_or_scene_inspection":true,
            "material_graph_inspection":true,
            "texture_set_inspection":true,
            "model_inspection":true,
            "asset_import_export":true,
            "project_mutation":true,
            "render_execution":true,
            "runtime_acceptance":true
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_substance_3d",
        "source_milestone_percent":20,
        "source_coding_status":"desktop_foundation_complete",
        "suite_apps":["painter","designer","sampler","stager","modeler"],
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"not_implemented",
        "future_host_transport":"research_required",
        "host_ready_verified":false,
        "project_automation_ready":false,
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"research authoritative supported automation surfaces per Substance 3D app before adding any project/material/model inspection or mutation contract"
    })
}

#[cfg(test)]
mod tests{
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-substance-3d-test-{}",uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    fn add_app(root:&Path,folder:&str,exe:&str)->PathBuf{
        let dir=root.join("Adobe").join(folder);
        fs::create_dir_all(&dir).unwrap();
        let path=dir.join(exe);
        fs::write(&path,b"fixture").unwrap();
        path
    }

    #[test]
    fn detects_only_recognized_substance_suite_apps(){
        let fixture=Fixture::new();
        add_app(&fixture.0,"Adobe Substance 3D Painter","Adobe Substance 3D Painter.exe");
        add_app(&fixture.0,"Adobe Substance 3D Designer","Adobe Substance 3D Designer.exe");
        add_app(&fixture.0,"Adobe Photoshop 2026","Adobe Substance 3D Painter.exe");
        let value=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(value["candidate_count"],2);
        assert_eq!(value["source_runtime_verified"],false);
        assert_eq!(value["production_ready"],false);
    }

    #[test]
    fn exact_launch_requires_matching_app_and_fresh_candidate(){
        let fixture=Fixture::new();
        let painter=add_app(&fixture.0,"Adobe Substance 3D Painter","Adobe Substance 3D Painter.exe");
        let report=detect_from_roots(&[(fixture.0.clone(),"fixture")]).unwrap();
        assert_eq!(
            exact_detected_executable(&report,"painter",painter.to_str().unwrap()).unwrap(),
            fs::canonicalize(&painter).unwrap()
        );
        assert!(exact_detected_executable(&report,"designer",painter.to_str().unwrap()).is_err());
    }

    #[test]
    fn foundation_reports_twenty_percent_without_runtime_claims(){
        let capability=capability_report();
        assert_eq!(capability["source_milestone_percent"],20);
        assert_eq!(capability["source_scope_complete"],false);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"not_implemented");
        assert_eq!(readiness["host_ready_verified"],false);
        assert_eq!(readiness["project_automation_ready"],false);
    }
}
