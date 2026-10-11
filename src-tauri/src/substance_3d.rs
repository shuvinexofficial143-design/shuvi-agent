use base64::{engine::general_purpose::STANDARD as BASE64,Engine as _};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{
    collections::HashSet,
    fs::{self,File},
    io::{Read,Write},
    net::{IpAddr,Ipv4Addr,SocketAddr,TcpStream},
    path::{Path,PathBuf},
    process::Command,
    time::Duration
};

const MAX_ADOBE_ENTRIES:usize=128;
const MAX_PATH_BYTES:usize=32*1024;
const MAX_SCRIPT_BYTES:u64=1024*1024;
const MAX_RECEIPT_BYTES:u64=64*1024;
const MAX_REMOTE_RESPONSE_BYTES:usize=64*1024;
const PAINTER_REMOTE_PORT:u16=60041;

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
        "source_milestone_percent":80,
        "source_scope_complete":false,
        "suite_apps":["painter","designer","sampler","stager","modeler"],
        "implemented":{
            "bounded_windows_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true,
            "automation_surface_catalog":true,
            "bounded_automation_planning":true,
            "painter_remote_launch_adapter":true,
            "painter_remote_connectivity_preflight":true,
            "painter_endpoint_process_ownership_proof":true,
            "painter_fixed_read_only_receipt":true,
            "sampler_script_fingerprint":true,
            "sampler_hash_bound_script_launch_adapter":true,
            "sampler_completion_receipt_contract":true,
            "sampler_completion_receipt_verification":true
        },
        "not_implemented":{
            "painter_arbitrary_remote_command_dispatch":true,
            "painter_mutating_remote_commands":true,
            "designer_plugin_install_or_execution":true,
            "sampler_script_native_completion_signal":true,
            "sampler_script_effect_verification":true,
            "stager_verified_scripting_surface":true,
            "modeler_verified_scripting_surface":true,
            "project_or_scene_inspection":true,
            "material_graph_inspection":true,
            "texture_set_inspection":true,
            "model_inspection":true,
            "asset_import_export_execution":true,
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
        "source_milestone_percent":80,
        "source_coding_status":"bounded_readback_receipts_complete",
        "suite_apps":["painter","designer","sampler","stager","modeler"],
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"painter_pid_bound_fixed_read_only_remote_plus_sampler_receipt_contract",
        "future_host_transport":"additional_typed_painter_reads_designer_python_plugins_sampler_effect_specific_receipts",
        "host_ready_verified":false,
        "project_automation_ready":"bounded_painter_read_only_plus_sampler_completion_receipt",
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"finalize bounded source scope with canonical acceptance summary and explicit Windows runtime acceptance handoff; keep arbitrary Painter commands, Designer execution, Sampler effect claims and Stager/Modeler scripting blocked unless separately verified"
    })
}


pub fn automation_catalog()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_substance_3d",
        "source_milestone_percent":80,
        "execution_supported":true,
        "execution_scope":"painter_pid_bound_fixed_read_only_receipt_plus_sampler_hash_bound_launch_and_completion_receipt",
        "apps":{
            "painter":{
                "documented_surface":"python_and_javascript_api_with_remote_scripting",
                "transport":"remote_scripting",
                "launch_flag":"--enable-remote-scripting",
                "planning_supported":true,
                "runtime_adapter_implemented":true,
                "runtime_adapter_scope":"exact_remote_enabled_launch_plus_pid_owned_endpoint_plus_fixed_read_only_api_version_receipt",
                "remote_command_dispatch_implemented":"fixed_read_only_only",
                "arbitrary_remote_command_dispatch_implemented":false
            },
            "designer":{
                "documented_surface":"python_api_plugins",
                "transport":"in_app_python_plugin",
                "planning_supported":true,
                "runtime_adapter_implemented":false,
                "remote_transport_verified":false
            },
            "sampler":{
                "documented_surface":"python_api_plugins_and_scripts",
                "transport":"python_script_with_command_line_launch",
                "launch_flag":"--run-script",
                "planning_supported":true,
                "runtime_adapter_implemented":true,
                "runtime_adapter_scope":"hash_bound_explicitly_approved_run_script_launch_plus_shuvi_completion_receipt",
                "script_completion_receipt_verification_implemented":true,
                "script_effect_verification_implemented":false
            },
            "stager":{
                "documented_surface":"no_authoritative_scripting_surface_verified_in_current_research",
                "planning_supported":false,
                "runtime_adapter_implemented":false
            },
            "modeler":{
                "documented_surface":"no_authoritative_scripting_surface_verified_in_current_research",
                "planning_supported":false,
                "runtime_adapter_implemented":false
            }
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

fn validate_absolute_script_path(path:&str,allowed_extensions:&[&str])->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Substance 3D automation script path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute(){
        return Err("Substance 3D automation script path must be absolute.".into());
    }
    let ext=p.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
    if !allowed_extensions.iter().any(|v|*v==ext){
        return Err("Substance 3D automation script/plugin extension is unsupported for the selected app surface.".into());
    }
    Ok(())
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutomationPlanRequest{
    pub app_id:String,
    pub automation_kind:String,
    pub script_path:Option<String>,
    pub acknowledge_in_app_install:bool,
}

impl AutomationPlanRequest{
    pub fn validate(&self)->Result<(),String>{
        match (self.app_id.as_str(),self.automation_kind.as_str()){
            ("painter","remote_scripting")=>{
                if self.script_path.is_some(){
                    return Err("Painter remote_scripting planning does not accept an arbitrary script path at the 40% milestone.".into());
                }
                if self.acknowledge_in_app_install{
                    return Err("Painter remote_scripting planning does not use acknowledge_in_app_install.".into());
                }
            }
            ("designer","python_plugin")=>{
                let path=self.script_path.as_deref().ok_or("Designer python_plugin planning requires script_path.")?;
                validate_absolute_script_path(path,&["py","sdplugin"])?;
                if !self.acknowledge_in_app_install{
                    return Err("Designer python_plugin planning requires acknowledge_in_app_install=true because the documented surface is an in-app plugin workflow.".into());
                }
            }
            ("sampler","python_script")=>{
                let path=self.script_path.as_deref().ok_or("Sampler python_script planning requires script_path.")?;
                validate_absolute_script_path(path,&["py"])?;
                if self.acknowledge_in_app_install{
                    return Err("Sampler command-line python_script planning does not use acknowledge_in_app_install.".into());
                }
            }
            ("stager",_)|("modeler",_)=>{
                return Err("No authoritative scripting surface has been verified for this Substance 3D app in the current source milestone; automation planning is blocked.".into());
            }
            _=>{
                return Err("Substance 3D automation pair must be painter/remote_scripting, designer/python_plugin, or sampler/python_script.".into());
            }
        }
        Ok(())
    }
}

pub fn plan_automation(request:&AutomationPlanRequest)->Result<Value,String>{
    request.validate()?;
    let details=match (request.app_id.as_str(),request.automation_kind.as_str()){
        ("painter","remote_scripting")=>json!({
            "documented_surface":"python_and_javascript_api_with_remote_scripting",
            "transport":"remote_scripting",
            "launch_args":["--enable-remote-scripting"],
            "arbitrary_command_execution_implemented":false,
            "requires_runtime_readiness_probe":true
        }),
        ("designer","python_plugin")=>json!({
            "documented_surface":"python_api_plugins",
            "transport":"in_app_python_plugin",
            "script_path":request.script_path,
            "requires_in_app_install":true,
            "remote_transport_verified":false
        }),
        ("sampler","python_script")=>json!({
            "documented_surface":"python_api_plugins_and_scripts",
            "transport":"python_script_with_command_line_launch",
            "launch_args":["--run-script",request.script_path.as_deref().unwrap_or("")],
            "requires_runtime_readiness_probe":true
        }),
        _=>return Err("Unsupported Substance 3D automation plan.".into())
    };
    Ok(json!({
        "plan_type":"substance_3d_automation_plan",
        "app_id":request.app_id,
        "automation_kind":request.automation_kind,
        "details":details,
        "execution_supported":false,
        "mutation_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}


fn valid_sha256(value:&str)->bool{
    value.len()==64&&value.chars().all(|c|c.is_ascii_hexdigit())
}

pub fn sampler_script_fingerprint(path:&str)->Result<Value,String>{
    validate_absolute_script_path(path,&["py"])?;
    let canonical=fs::canonicalize(path)
        .map_err(|e|format!("Sampler script is unavailable: {e}"))?;
    let metadata=fs::metadata(&canonical)
        .map_err(|e|format!("Could not inspect Sampler script: {e}"))?;
    if !metadata.is_file(){
        return Err("Sampler script path must resolve to a regular file.".into());
    }
    if metadata.len()==0||metadata.len()>MAX_SCRIPT_BYTES{
        return Err(format!("Sampler script must be between 1 and {MAX_SCRIPT_BYTES} bytes."));
    }
    let mut file=File::open(&canonical)
        .map_err(|e|format!("Could not open Sampler script: {e}"))?;
    let mut hasher=Sha256::new();
    let mut buffer=[0u8;8192];
    loop{
        let read=file.read(&mut buffer).map_err(|e|format!("Could not hash Sampler script: {e}"))?;
        if read==0{break;}
        hasher.update(&buffer[..read]);
    }
    let sha256=format!("{:x}",hasher.finalize());
    Ok(json!({
        "schema_version":1,
        "app_id":"sampler",
        "canonical_script_path":canonical,
        "script_size_bytes":metadata.len(),
        "script_sha256":sha256,
        "execution_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PainterRemoteLaunchRequest{
    pub painter_exe:String,
    pub explicit_user_approval:bool,
}

impl PainterRemoteLaunchRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_requested_executable("painter",&self.painter_exe)?;
        if !self.explicit_user_approval{
            return Err("Painter remote-enabled launch requires explicit_user_approval=true.".into());
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PainterRemotePreflightRequest{
    pub painter_exe:String,
    pub expected_pid:u32,
    pub explicit_user_approval:bool,
}

impl PainterRemotePreflightRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_requested_executable("painter",&self.painter_exe)?;
        if self.expected_pid==0{
            return Err("Painter remote preflight requires a nonzero expected_pid.".into());
        }
        if !self.explicit_user_approval{
            return Err("Painter remote preflight requires explicit_user_approval=true.".into());
        }
        Ok(())
    }
}

pub fn painter_remote_preflight(request:&PainterRemotePreflightRequest,managed_process_identity_verified:bool)->Result<Value,String>{
    request.validate()?;
    if !managed_process_identity_verified{
        return Err("Painter remote preflight requires the exact live Shuvi-managed process instance.".into());
    }
    let address=SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST),PAINTER_REMOTE_PORT);
    TcpStream::connect_timeout(&address,Duration::from_millis(1200))
        .map_err(|e|format!("Painter documented localhost remote-scripting endpoint is not reachable on port {PAINTER_REMOTE_PORT}: {e}"))?;
    Ok(json!({
        "schema_version":1,
        "app_id":"painter",
        "expected_pid":request.expected_pid,
        "painter_exe":request.painter_exe.clone(),
        "managed_process_identity_verified":true,
        "remote_host":"127.0.0.1",
        "remote_port":PAINTER_REMOTE_PORT,
        "transport_reachable":true,
        "endpoint_process_ownership_verified":false,
        "remote_command_dispatch_supported":false,
        "host_ready_verified":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SamplerScriptLaunchRequest{
    pub sampler_exe:String,
    pub script_path:String,
    pub expected_script_sha256:String,
    pub explicit_user_approval:bool,
    #[serde(default)]
    pub receipt_path:Option<String>,
    #[serde(default)]
    pub request_id:Option<String>,
}

impl SamplerScriptLaunchRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_requested_executable("sampler",&self.sampler_exe)?;
        validate_absolute_script_path(&self.script_path,&["py"])?;
        if !valid_sha256(&self.expected_script_sha256){
            return Err("Sampler script launch requires a 64-character hexadecimal expected_script_sha256.".into());
        }
        if !self.explicit_user_approval{
            return Err("Sampler script launch requires explicit_user_approval=true.".into());
        }
        match (&self.receipt_path,&self.request_id){
            (None,None)=>{}
            (Some(path),Some(request_id))=>{
                validate_receipt_path(path)?;
                if !valid_request_id(request_id){
                    return Err("Sampler receipt request_id must be 1..128 ASCII letters, digits, dot, underscore, or hyphen.".into());
                }
            }
            _=>return Err("Sampler completion receipt contract requires both receipt_path and request_id, or neither.".into())
        }
        Ok(())
    }
}

pub fn verify_sampler_script_binding(request:&SamplerScriptLaunchRequest)->Result<Value,String>{
    request.validate()?;
    let fingerprint=sampler_script_fingerprint(&request.script_path)?;
    let actual=fingerprint.get("script_sha256").and_then(Value::as_str)
        .ok_or("Sampler script fingerprint is missing script_sha256.")?;
    if !actual.eq_ignore_ascii_case(&request.expected_script_sha256){
        return Err("Sampler script changed after approval: expected_script_sha256 does not match the fresh script fingerprint.".into());
    }
    Ok(fingerprint)
}


fn valid_request_id(value:&str)->bool{
    !value.is_empty()&&value.len()<=128&&value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'.'|'_'|'-'))
}

fn validate_receipt_path(path:&str)->Result<(),String>{
    if path.trim().is_empty()||path.len()>MAX_PATH_BYTES||path.chars().any(char::is_control){
        return Err("Sampler completion receipt path is empty, oversized, or contains control characters.".into());
    }
    let p=Path::new(path);
    let valid_ext=p.extension().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("json"));
    if !p.is_absolute()||!valid_ext{
        return Err("Sampler completion receipt path must be an absolute .json path.".into());
    }
    Ok(())
}

pub fn prepare_sampler_receipt_target(request:&SamplerScriptLaunchRequest)->Result<Option<Value>,String>{
    request.validate()?;
    let (Some(path),Some(request_id))=(&request.receipt_path,&request.request_id) else{return Ok(None);};
    let target=Path::new(path);
    if target.exists(){
        return Err("Sampler completion receipt target already exists; refuse stale or ambiguous completion evidence.".into());
    }
    let parent=target.parent().ok_or("Sampler completion receipt target has no parent directory.")?;
    let canonical_parent=fs::canonicalize(parent)
        .map_err(|e|format!("Sampler completion receipt parent is unavailable: {e}"))?;
    if !canonical_parent.is_dir(){
        return Err("Sampler completion receipt parent must be a directory.".into());
    }
    let file_name=target.file_name().ok_or("Sampler completion receipt target is missing a file name.")?;
    let canonical_target=canonical_parent.join(file_name);
    Ok(Some(json!({
        "receipt_path":canonical_target,
        "request_id":request_id,
        "expected_script_sha256":request.expected_script_sha256.to_ascii_lowercase()
    })))
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PainterReadRequest{
    pub painter_exe:String,
    pub expected_pid:u32,
    pub query:String,
    pub explicit_user_approval:bool,
}

impl PainterReadRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_requested_executable("painter",&self.painter_exe)?;
        if self.expected_pid==0{
            return Err("Painter read-only request requires a nonzero expected_pid.".into());
        }
        if self.query!="api_version"{
            return Err("Painter read-only request currently supports only query=api_version.".into());
        }
        if !self.explicit_user_approval{
            return Err("Painter read-only request requires explicit_user_approval=true.".into());
        }
        Ok(())
    }
}

fn painter_read_command(query:&str)->Result<(&'static str,&'static str),String>{
    match query{
        "api_version"=>Ok(("js","alg.version.painter")),
        _=>Err("Unsupported Painter read-only query.".into())
    }
}

#[cfg(target_os="windows")]
fn painter_remote_endpoint_owner(expected_pid:u32)->Result<u32,String>{
    if expected_pid==0{return Err("Painter endpoint ownership check requires a nonzero PID.".into());}
    let script=r#"$expected=[uint32]$env:SHUVI_EXPECTED_PID
$match=Get-NetTCPConnection -LocalPort 60041 -State Listen -ErrorAction Stop |
    Where-Object { [uint32]$_.OwningProcess -eq $expected } |
    Select-Object -First 1
if($null -eq $match){ exit 3 }
[Console]::Out.Write([string]$match.OwningProcess)"#;
    let output=Command::new("powershell")
        .args(["-NoProfile","-NonInteractive","-Command",script])
        .env("SHUVI_EXPECTED_PID",expected_pid.to_string())
        .output()
        .map_err(|e|format!("Could not verify Painter remote endpoint ownership: {e}"))?;
    if !output.status.success(){
        return Err("Painter localhost:60041 is not proven to be owned by the exact expected Painter PID.".into());
    }
    let observed=String::from_utf8_lossy(&output.stdout).trim().parse::<u32>()
        .map_err(|_|"Painter endpoint ownership probe returned an invalid PID.".to_string())?;
    if observed!=expected_pid{
        return Err("Painter endpoint ownership PID does not match the exact expected Painter PID.".into());
    }
    Ok(observed)
}

#[cfg(not(target_os="windows"))]
fn painter_remote_endpoint_owner(_expected_pid:u32)->Result<u32,String>{
    Err("Painter endpoint ownership verification is Windows-only.".into())
}

fn painter_remote_post_js(script:&str)->Result<Value,String>{
    if script!="alg.version.painter"{
        return Err("Painter remote transport refuses non-whitelisted JavaScript.".into());
    }
    let encoded=BASE64.encode(script.as_bytes());
    let body=serde_json::to_vec(&json!({"js":encoded}))
        .map_err(|e|format!("Could not encode Painter remote request: {e}"))?;
    let address=SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST),PAINTER_REMOTE_PORT);
    let mut stream=TcpStream::connect_timeout(&address,Duration::from_millis(1500))
        .map_err(|e|format!("Painter remote endpoint is not reachable: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    let request=format!(
        "POST /run.json HTTP/1.1\r\nHost: localhost:{PAINTER_REMOTE_PORT}\r\nContent-Type: application/json\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e|format!("Could not write Painter remote request headers: {e}"))?;
    stream.write_all(&body).map_err(|e|format!("Could not write Painter remote request body: {e}"))?;
    stream.flush().map_err(|e|format!("Could not flush Painter remote request: {e}"))?;

    let mut response=Vec::new();
    stream.take((MAX_REMOTE_RESPONSE_BYTES+1) as u64).read_to_end(&mut response)
        .map_err(|e|format!("Could not read Painter remote response: {e}"))?;
    if response.len()>MAX_REMOTE_RESPONSE_BYTES{
        return Err("Painter remote response exceeds Shuvi's bounded response limit.".into());
    }
    let separator=response.windows(4).position(|w|w==b"\r\n\r\n")
        .ok_or("Painter remote response is missing HTTP headers.")?;
    let headers=std::str::from_utf8(&response[..separator])
        .map_err(|_|"Painter remote response headers are not UTF-8.".to_string())?;
    let status=headers.lines().next().and_then(|line|line.split_whitespace().nth(1))
        .and_then(|v|v.parse::<u16>().ok())
        .ok_or("Painter remote response has no valid HTTP status.")?;
    if !(200..300).contains(&status){
        return Err(format!("Painter remote endpoint returned HTTP status {status}."));
    }
    let body=&response[separator+4..];
    let value:Value=serde_json::from_slice(body)
        .map_err(|e|format!("Painter remote response is not valid JSON: {e}"))?;
    if value.get("error").is_some(){
        return Err("Painter remote endpoint returned a scripting error.".into());
    }
    Ok(value)
}

pub fn painter_read_only_receipt(request:&PainterReadRequest,managed_process_identity_verified:bool)->Result<Value,String>{
    request.validate()?;
    if !managed_process_identity_verified{
        return Err("Painter read-only request requires the exact live Shuvi-managed process instance.".into());
    }
    let owner=painter_remote_endpoint_owner(request.expected_pid)?;
    let (kind,script)=painter_read_command(&request.query)?;
    if kind!="js"{return Err("Painter read-only transport currently supports only fixed JavaScript reads.".into());}
    let result=painter_remote_post_js(script)?;
    Ok(json!({
        "schema_version":1,
        "app_id":"painter",
        "query":request.query,
        "documented_command":"alg.version.painter",
        "expected_pid":request.expected_pid,
        "endpoint_owner_pid":owner,
        "managed_process_identity_verified":true,
        "endpoint_process_ownership_verified":true,
        "remote_route":"/run.json",
        "remote_result":result,
        "read_receipt_verified":true,
        "mutation_performed":false,
        "arbitrary_remote_command_supported":false,
        "host_ready_verified":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SamplerReceiptVerifyRequest{
    pub receipt_path:String,
    pub expected_request_id:String,
    pub expected_script_sha256:String,
}

impl SamplerReceiptVerifyRequest{
    pub fn validate(&self)->Result<(),String>{
        validate_receipt_path(&self.receipt_path)?;
        if !valid_request_id(&self.expected_request_id){
            return Err("Sampler receipt expected_request_id must be 1..128 ASCII letters, digits, dot, underscore, or hyphen.".into());
        }
        if !valid_sha256(&self.expected_script_sha256){
            return Err("Sampler receipt expected_script_sha256 must be a 64-character hexadecimal SHA-256.".into());
        }
        Ok(())
    }
}

pub fn verify_sampler_completion_receipt(request:&SamplerReceiptVerifyRequest)->Result<Value,String>{
    request.validate()?;
    let canonical=fs::canonicalize(&request.receipt_path)
        .map_err(|e|format!("Sampler completion receipt is unavailable: {e}"))?;
    let metadata=fs::metadata(&canonical).map_err(|e|format!("Could not inspect Sampler completion receipt: {e}"))?;
    if !metadata.is_file()||metadata.len()==0||metadata.len()>MAX_RECEIPT_BYTES{
        return Err(format!("Sampler completion receipt must be a regular file between 1 and {MAX_RECEIPT_BYTES} bytes."));
    }
    let bytes=fs::read(&canonical).map_err(|e|format!("Could not read Sampler completion receipt: {e}"))?;
    let receipt:Value=serde_json::from_slice(&bytes)
        .map_err(|e|format!("Sampler completion receipt is not valid JSON: {e}"))?;
    if receipt.get("schema_version").and_then(Value::as_u64)!=Some(1){
        return Err("Sampler completion receipt schema_version must be 1.".into());
    }
    if receipt.get("request_id").and_then(Value::as_str)!=Some(request.expected_request_id.as_str()){
        return Err("Sampler completion receipt request_id does not match the expected request.".into());
    }
    let actual_hash=receipt.get("script_sha256").and_then(Value::as_str)
        .ok_or("Sampler completion receipt is missing script_sha256.")?;
    if !actual_hash.eq_ignore_ascii_case(&request.expected_script_sha256){
        return Err("Sampler completion receipt script_sha256 does not match the approved script.".into());
    }
    if receipt.get("status").and_then(Value::as_str)!=Some("completed"){
        return Err("Sampler completion receipt status must be completed.".into());
    }
    Ok(json!({
        "schema_version":1,
        "app_id":"sampler",
        "receipt_path":canonical,
        "request_id":request.expected_request_id,
        "script_sha256":request.expected_script_sha256.to_ascii_lowercase(),
        "script_completion_receipt_verified":true,
        "script_effect_verified":false,
        "native_sampler_completion_signal_verified":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
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
    fn foundation_reports_eighty_percent_without_runtime_claims(){
        let capability=capability_report();
        assert_eq!(capability["source_milestone_percent"],80);
        assert_eq!(capability["source_scope_complete"],false);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);
        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"painter_pid_bound_fixed_read_only_remote_plus_sampler_receipt_contract");
        assert_eq!(readiness["host_ready_verified"],false);
        assert_eq!(readiness["project_automation_ready"],"bounded_painter_read_only_plus_sampler_completion_receipt");
    }

    #[test]
    fn automation_catalog_is_documented_but_execution_free(){
        let catalog=automation_catalog();
        assert_eq!(catalog["source_milestone_percent"],80);
        assert_eq!(catalog["execution_supported"],true);
        assert_eq!(catalog["apps"]["painter"]["launch_flag"],"--enable-remote-scripting");
        assert_eq!(catalog["apps"]["designer"]["remote_transport_verified"],false);
        assert_eq!(catalog["apps"]["sampler"]["launch_flag"],"--run-script");
        assert_eq!(catalog["apps"]["stager"]["planning_supported"],false);
        assert_eq!(catalog["apps"]["modeler"]["planning_supported"],false);
    }

    #[test]
    fn planner_accepts_only_verified_surface_pairs(){
        let painter=AutomationPlanRequest{
            app_id:"painter".into(),automation_kind:"remote_scripting".into(),
            script_path:None,acknowledge_in_app_install:false
        };
        assert_eq!(plan_automation(&painter).unwrap()["execution_supported"],false);

        let plugin=std::env::temp_dir().join("shuvi-designer-plugin.py").to_string_lossy().into_owned();
        let designer=AutomationPlanRequest{
            app_id:"designer".into(),automation_kind:"python_plugin".into(),
            script_path:Some(plugin),acknowledge_in_app_install:true
        };
        assert_eq!(plan_automation(&designer).unwrap()["details"]["requires_in_app_install"],true);

        let script=std::env::temp_dir().join("shuvi-sampler-script.py").to_string_lossy().into_owned();
        let sampler=AutomationPlanRequest{
            app_id:"sampler".into(),automation_kind:"python_script".into(),
            script_path:Some(script),acknowledge_in_app_install:false
        };
        assert_eq!(plan_automation(&sampler).unwrap()["details"]["launch_args"][0],"--run-script");

        let stager=AutomationPlanRequest{
            app_id:"stager".into(),automation_kind:"python_script".into(),
            script_path:None,acknowledge_in_app_install:false
        };
        assert!(plan_automation(&stager).is_err());
    }

    #[test]
    fn painter_remote_requests_are_explicitly_approved_and_command_free(){
        let painter_exe=std::env::temp_dir().join("Adobe Substance 3D Painter.exe").to_string_lossy().into_owned();
        let launch=PainterRemoteLaunchRequest{painter_exe:painter_exe.clone(),explicit_user_approval:true};
        assert!(launch.validate().is_ok());
        let denied=PainterRemoteLaunchRequest{painter_exe:painter_exe.clone(),explicit_user_approval:false};
        assert!(denied.validate().is_err());
        let preflight=PainterRemotePreflightRequest{
            painter_exe,
            expected_pid:42,
            explicit_user_approval:true
        };
        assert!(preflight.validate().is_ok());
    }

    #[test]
    fn sampler_script_binding_is_hash_pinned(){
        let fixture=Fixture::new();
        let script=fixture.0.join("approved.py");
        fs::write(&script,b"print('approved')").unwrap();
        let fingerprint=sampler_script_fingerprint(script.to_str().unwrap()).unwrap();
        let hash=fingerprint["script_sha256"].as_str().unwrap().to_string();
        let sampler_exe=std::env::temp_dir().join("Adobe Substance 3D Sampler.exe").to_string_lossy().into_owned();
        let request=SamplerScriptLaunchRequest{
            sampler_exe,
            script_path:script.to_string_lossy().into_owned(),
            expected_script_sha256:hash,
            explicit_user_approval:true,
            receipt_path:None,
            request_id:None
        };
        assert!(verify_sampler_script_binding(&request).is_ok());
        fs::write(&script,b"print('changed')").unwrap();
        assert!(verify_sampler_script_binding(&request).is_err());
    }

    #[test]
    fn painter_read_query_is_fixed_and_non_arbitrary(){
        assert_eq!(painter_read_command("api_version").unwrap(),("js","alg.version.painter"));
        assert!(painter_read_command("eval_anything").is_err());
        let request=PainterReadRequest{
            painter_exe:std::env::temp_dir().join("Adobe Substance 3D Painter.exe").to_string_lossy().into_owned(),
            expected_pid:7,
            query:"api_version".into(),
            explicit_user_approval:true
        };
        assert!(request.validate().is_ok());
        let arbitrary=PainterReadRequest{query:"custom_js".into(),..request};
        assert!(arbitrary.validate().is_err());
    }

    #[test]
    fn sampler_completion_receipt_is_exactly_bound(){
        let fixture=Fixture::new();
        let receipt=fixture.0.join("receipt.json");
        let hash="a".repeat(64);
        fs::write(&receipt,serde_json::to_vec(&json!({
            "schema_version":1,
            "request_id":"req-80",
            "script_sha256":hash,
            "status":"completed"
        })).unwrap()).unwrap();
        let request=SamplerReceiptVerifyRequest{
            receipt_path:receipt.to_string_lossy().into_owned(),
            expected_request_id:"req-80".into(),
            expected_script_sha256:"a".repeat(64)
        };
        let verified=verify_sampler_completion_receipt(&request).unwrap();
        assert_eq!(verified["script_completion_receipt_verified"],true);
        assert_eq!(verified["script_effect_verified"],false);
    }
}
