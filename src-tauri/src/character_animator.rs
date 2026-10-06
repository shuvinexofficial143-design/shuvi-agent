use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::{Path,PathBuf},process::Command};

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
            "future_host_transport":"no_public_host_api_claimed",
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
        "source_milestone_percent":80,
        "source_scope_complete":false,
        "implemented":{
            "bounded_windows_detection":true,
            "support_files_executable_detection":true,
            "exact_detected_executable_launch":true,
            "managed_process_tracking":true,
            "capability_report":true,
            "readiness_report":true,
            "control_catalog":true,
            "bounded_control_planning":true,
            "bounded_interchange_planning":true,
            "runtime_control_preflight":true,
            "foreground_focus_verification":true,
            "explicit_user_approval_guard":true,
            "documented_application_shortcut_execution":true,
            "immediate_pre_send_focus_recheck":true
        },
        "automation_transport":{
            "status":"no_public_host_api_claimed",
            "implemented":false,
            "supported_control_surfaces":["keyboard_shortcuts","project_trigger_keys","midi_notes","dynamic_link","media_encoder_handoff"],
            "execution_adapter":"bounded_application_shortcuts",
            "input_delivery_implemented":true,
            "application_shortcut_execution":true,
            "project_trigger_execution":false,
            "midi_execution":false
        },
        "not_implemented":{
            "host_bridge":true,
            "project_inspection":true,
            "scene_inspection":true,
            "puppet_inspection":true,
            "timeline_take_inspection":true,
            "recording_effect_verification":true,
            "project_trigger_input_delivery":true,
            "midi_input_execution":true,
            "project_mutation":true,
            "export_execution":true,
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
        "source_milestone_percent":80,
        "source_coding_status":"bounded_application_shortcut_delivery_complete",
        "desktop_detection":true,
        "exact_detected_launch":true,
        "host_transport":"not_implemented",
        "future_host_transport":"no_public_host_api_claimed",
        "host_ready_verified":false,
        "project_automation_ready":"documented_application_shortcuts_only",
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"finalize the bounded source scope with a canonical acceptance summary and explicit runtime acceptance handoff; keep project trigger delivery, MIDI delivery and project/scene/puppet host inspection blocked unless separately verified"
    })
}


#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlPlanRequest{
    pub control_kind:String,
    pub command:Option<String>,
    pub key:Option<String>,
    pub midi_note:Option<u8>,
    pub acknowledge_project_mapping:bool,
}

impl ControlPlanRequest{
    pub fn validate(&self)->Result<(),String>{
        match self.control_kind.as_str(){
            "application_shortcut"=>{
                let command=self.command.as_deref().ok_or("Character Animator application_shortcut requires command.")?;
                if !matches!(command,"record_take_work_area"|"export_png_wav"|"export_frame"){
                    return Err("Character Animator application shortcut command is unsupported.".into());
                }
                if self.key.is_some()||self.midi_note.is_some(){
                    return Err("Character Animator application shortcut must not include trigger key or MIDI note.".into());
                }
            }
            "trigger_key"=>{
                let key=self.key.as_deref().ok_or("Character Animator trigger_key requires key.")?;
                if key.len()!=1||!key.as_bytes()[0].is_ascii_graphic(){
                    return Err("Character Animator trigger key must be one printable ASCII character.".into());
                }
                if self.command.is_some()||self.midi_note.is_some(){
                    return Err("Character Animator trigger_key must not include command or MIDI note.".into());
                }
                if !self.acknowledge_project_mapping{
                    return Err("Character Animator trigger_key planning requires acknowledge_project_mapping=true.".into());
                }
            }
            "midi_note"=>{
                if self.midi_note.is_none(){
                    return Err("Character Animator midi_note requires midi_note.".into());
                }
                if self.command.is_some()||self.key.is_some(){
                    return Err("Character Animator midi_note must not include command or trigger key.".into());
                }
                if !self.acknowledge_project_mapping{
                    return Err("Character Animator MIDI planning requires acknowledge_project_mapping=true.".into());
                }
            }
            _=>return Err("Character Animator control_kind must be application_shortcut, trigger_key, or midi_note.".into())
        }
        Ok(())
    }
}

pub fn control_catalog()->Value{
    json!({
        "schema_version":1,
        "integration":"adobe_character_animator",
        "source_milestone_percent":80,
        "execution_supported":true,
        "application_shortcut_execution_supported":true,
        "project_trigger_execution_supported":false,
        "midi_execution_supported":false,
        "supported_control_surfaces":{
            "application_shortcuts":[
                {"command":"record_take_work_area","windows_sequence":["CTRL","3"],"effect":"creates a take for the enabled work area"},
                {"command":"export_png_wav","windows_sequence":["CTRL","ALT","M"],"effect":"opens PNG sequence + WAV export flow"},
                {"command":"export_frame","windows_sequence":["CTRL","ALT","S"],"effect":"opens current-frame PNG export flow"}
            ],
            "project_trigger_key":{"mapping":"user_project_defined","requires_project_mapping_acknowledgement":true},
            "midi_note":{"range":[0,127],"mapping":"user_project_defined","requires_project_mapping_acknowledgement":true}
        },
        "host_api_claimed":false,
        "runtime_input_adapter":"bounded_application_shortcuts",
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn plan_control(request:&ControlPlanRequest)->Result<Value,String>{
    request.validate()?;
    let details=match request.control_kind.as_str(){
        "application_shortcut"=>{
            let command=request.command.as_deref().unwrap_or("");
            let sequence=match command{
                "record_take_work_area"=>json!(["CTRL","3"]),
                "export_png_wav"=>json!(["CTRL","ALT","M"]),
                "export_frame"=>json!(["CTRL","ALT","S"]),
                _=>return Err("Unsupported Character Animator application shortcut.".into())
            };
            json!({"command":command,"windows_sequence":sequence,"requires_focused_window":true})
        }
        "trigger_key"=>json!({
            "trigger_key":request.key,
            "mapping_scope":"current_user_project",
            "requires_focused_window":true,
            "project_mapping_verified":false
        }),
        "midi_note"=>json!({
            "midi_note":request.midi_note,
            "mapping_scope":"current_user_project",
            "requires_midi_route":true,
            "project_mapping_verified":false
        }),
        _=>return Err("Unsupported Character Animator control kind.".into())
    };
    Ok(json!({
        "plan_type":"character_animator_control_plan",
        "control_kind":request.control_kind,
        "details":details,
        "execution_supported":false,
        "runtime_adapter_required":true,
        "mutation_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}


#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeControlPreflightRequest{
    pub control:ControlPlanRequest,
    pub character_animator_exe:String,
    pub expected_pid:u32,
    pub explicit_user_approval:bool,
}

impl RuntimeControlPreflightRequest{
    pub fn validate(&self)->Result<(),String>{
        self.control.validate()?;
        validate_requested_executable(&self.character_animator_exe)?;
        if self.expected_pid==0{
            return Err("Character Animator runtime preflight requires a non-zero expected_pid.".into());
        }
        if !self.explicit_user_approval{
            return Err("Character Animator runtime preflight requires explicit_user_approval=true.".into());
        }
        Ok(())
    }
}

#[cfg(target_os="windows")]
const FOREGROUND_PROBE_SCRIPT:&str=r#"
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShuviForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle=[ShuviForegroundWindow]::GetForegroundWindow()
if($handle -eq [IntPtr]::Zero){ throw 'No foreground window is available.' }
[uint32]$foregroundPid=0
[void][ShuviForegroundWindow]::GetWindowThreadProcessId($handle,[ref]$foregroundPid)
$process=Get-Process -Id $foregroundPid -ErrorAction Stop
[pscustomobject]@{pid=[uint32]$foregroundPid;path=[string]$process.Path} | ConvertTo-Json -Compress
"#;

pub fn runtime_control_preflight(
    request:&RuntimeControlPreflightRequest,
    managed_process_identity_verified:bool,
)->Result<Value,String>{
    request.validate()?;
    if !managed_process_identity_verified{
        return Err("Character Animator runtime preflight requires the exact live Shuvi-managed process identity.".into());
    }

    #[cfg(target_os="windows")]
    {
        let expected_exe=fs::canonicalize(&request.character_animator_exe)
            .map_err(|e|format!("Expected Character Animator executable is unavailable: {e}"))?;
        let output=Command::new("powershell.exe")
            .args(["-NoLogo","-NoProfile","-NonInteractive","-Command",FOREGROUND_PROBE_SCRIPT])
            .output()
            .map_err(|e|format!("Could not inspect the Windows foreground process: {e}"))?;
        if !output.status.success(){
            return Err(format!(
                "Character Animator foreground verification failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let observed:Value=serde_json::from_slice(&output.stdout)
            .map_err(|e|format!("Could not parse Character Animator foreground verification: {e}"))?;
        let observed_pid=observed.get("pid").and_then(Value::as_u64)
            .and_then(|v|u32::try_from(v).ok())
            .ok_or("Foreground verification did not return a valid PID.")?;
        let observed_path=observed.get("path").and_then(Value::as_str)
            .ok_or("Foreground verification did not return an executable path.")?;
        let observed_exe=fs::canonicalize(observed_path)
            .map_err(|e|format!("Foreground executable path could not be verified: {e}"))?;
        if observed_pid!=request.expected_pid || observed_exe!=expected_exe{
            return Err("Character Animator is not the exact approved Shuvi-managed foreground process; input delivery remains blocked.".into());
        }
        Ok(json!({
            "preflight_type":"character_animator_runtime_control",
            "control_kind":request.control.control_kind,
            "expected_pid":request.expected_pid,
            "character_animator_exe":expected_exe,
            "managed_process_identity_verified":true,
            "foreground_process_verified":true,
            "explicit_user_approval":true,
            "input_delivery_implemented":false,
            "execution_supported":false,
            "mutation_performed":false,
            "source_runtime_verified":false,
            "production_ready":false
        }))
    }

    #[cfg(not(target_os="windows"))]
    {
        Err("Character Animator runtime preflight is Windows-only.".into())
    }
}


fn application_shortcut_send_keys(command:&str)->Result<&'static str,String>{
    match command{
        "record_take_work_area"=>Ok("^3"),
        "export_png_wav"=>Ok("^%m"),
        "export_frame"=>Ok("^%s"),
        _=>Err("Character Animator application shortcut command is unsupported for runtime delivery.".into())
    }
}

#[cfg(target_os="windows")]
const APPLICATION_SHORTCUT_SEND_SCRIPT:&str=r#"
$ErrorActionPreference='Stop'
$expectedPid=[uint32]$env:SHUVI_CHARACTER_ANIMATOR_PID
$expectedExe=[string]$env:SHUVI_CHARACTER_ANIMATOR_EXE
$keys=[string]$env:SHUVI_CHARACTER_ANIMATOR_KEYS
if($expectedPid -eq 0 -or [string]::IsNullOrWhiteSpace($expectedExe) -or [string]::IsNullOrWhiteSpace($keys)){
    throw 'Character Animator shortcut delivery environment is incomplete.'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShuviCharacterAnimatorInputTarget {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
function Get-ShuviCharacterAnimatorForeground {
    $handle=[ShuviCharacterAnimatorInputTarget]::GetForegroundWindow()
    if($handle -eq [IntPtr]::Zero){ throw 'No foreground window is available.' }
    [uint32]$foregroundPid=0
    [void][ShuviCharacterAnimatorInputTarget]::GetWindowThreadProcessId($handle,[ref]$foregroundPid)
    $process=Get-Process -Id $foregroundPid -ErrorAction Stop
    if($foregroundPid -ne $expectedPid){
        throw 'Foreground PID changed before Character Animator shortcut delivery.'
    }
    if(-not [string]::Equals([string]$process.Path,$expectedExe,[System.StringComparison]::OrdinalIgnoreCase)){
        throw 'Foreground executable changed before Character Animator shortcut delivery.'
    }
    return $process
}
[void](Get-ShuviCharacterAnimatorForeground)
$final=Get-ShuviCharacterAnimatorForeground
[System.Windows.Forms.SendKeys]::SendWait($keys)
[pscustomobject]@{
    pid=[uint32]$final.Id
    path=[string]$final.Path
    input_dispatch_completed=$true
    effect_verified=$false
} | ConvertTo-Json -Compress
"#;

pub fn execute_application_shortcut(
    request:&RuntimeControlPreflightRequest,
    managed_process_identity_verified:bool,
)->Result<Value,String>{
    request.validate()?;
    if request.control.control_kind!="application_shortcut"{
        return Err("Character Animator 80% runtime delivery is limited to documented application_shortcut controls.".into());
    }
    if !managed_process_identity_verified{
        return Err("Character Animator shortcut delivery requires the exact live Shuvi-managed process identity.".into());
    }
    let command=request.control.command.as_deref()
        .ok_or("Character Animator application shortcut delivery requires command.")?;
    let send_keys=application_shortcut_send_keys(command)?;
    let preflight=runtime_control_preflight(request,true)?;

    #[cfg(target_os="windows")]
    {
        let expected_exe=fs::canonicalize(&request.character_animator_exe)
            .map_err(|e|format!("Expected Character Animator executable is unavailable: {e}"))?;
        let output=Command::new("powershell.exe")
            .env("SHUVI_CHARACTER_ANIMATOR_PID",request.expected_pid.to_string())
            .env("SHUVI_CHARACTER_ANIMATOR_EXE",expected_exe.as_os_str())
            .env("SHUVI_CHARACTER_ANIMATOR_KEYS",send_keys)
            .args(["-NoLogo","-NoProfile","-NonInteractive","-Command",APPLICATION_SHORTCUT_SEND_SCRIPT])
            .output()
            .map_err(|e|format!("Could not dispatch Character Animator application shortcut: {e}"))?;
        if !output.status.success(){
            return Err(format!(
                "Character Animator application shortcut delivery failed closed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let receipt:Value=serde_json::from_slice(&output.stdout)
            .map_err(|e|format!("Could not parse Character Animator shortcut delivery receipt: {e}"))?;
        if receipt.get("input_dispatch_completed").and_then(Value::as_bool)!=Some(true){
            return Err("Character Animator shortcut delivery did not return a positive dispatch receipt.".into());
        }
        Ok(json!({
            "execution_type":"character_animator_application_shortcut",
            "command":command,
            "windows_sequence":match command{
                "record_take_work_area"=>json!(["CTRL","3"]),
                "export_png_wav"=>json!(["CTRL","ALT","M"]),
                "export_frame"=>json!(["CTRL","ALT","S"]),
                _=>json!([])
            },
            "preflight":preflight,
            "expected_pid":request.expected_pid,
            "character_animator_exe":expected_exe,
            "managed_process_identity_verified":true,
            "foreground_rechecked_immediately_before_send":true,
            "input_dispatch_completed":true,
            "effect_verified":false,
            "project_trigger_execution":false,
            "midi_execution":false,
            "source_runtime_verified":false,
            "production_ready":false
        }))
    }

    #[cfg(not(target_os="windows"))]
    {
        Err("Character Animator application shortcut delivery is Windows-only.".into())
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterchangePlanRequest{
    pub route:String,
    pub project_path:String,
    pub scene_name:String,
}

impl InterchangePlanRequest{
    pub fn validate(&self)->Result<(),String>{
        if !matches!(self.route.as_str(),"dynamic_link_after_effects"|"dynamic_link_premiere"|"media_encoder_export"){
            return Err("Character Animator interchange route is unsupported.".into());
        }
        if self.project_path.trim().is_empty()||self.project_path.len()>MAX_PATH_BYTES
            ||self.project_path.chars().any(char::is_control)||!Path::new(&self.project_path).is_absolute(){
            return Err("Character Animator interchange plan requires an absolute project path.".into());
        }
        if Path::new(&self.project_path).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase()!="chproj"{
            return Err("Character Animator interchange project path must end in .chproj.".into());
        }
        if self.scene_name.trim().is_empty()||self.scene_name.len()>512||self.scene_name.chars().any(char::is_control){
            return Err("Character Animator interchange plan requires a bounded scene name.".into());
        }
        Ok(())
    }
}

pub fn plan_interchange(request:&InterchangePlanRequest)->Result<Value,String>{
    request.validate()?;
    let workflow=match request.route.as_str(){
        "dynamic_link_after_effects"=>json!({
            "destination":"After Effects",
            "method":"import Character Animator .chproj then select scene through Dynamic Link",
            "character_animator_must_remain_running":false
        }),
        "dynamic_link_premiere"=>json!({
            "destination":"Premiere Pro",
            "method":"import Character Animator .chproj then select scene through Dynamic Link",
            "character_animator_must_remain_running":false
        }),
        "media_encoder_export"=>json!({
            "destination":"Adobe Media Encoder",
            "method":"Character Animator File > Export > Video via Adobe Media Encoder",
            "requires_character_animator_ui":true
        }),
        _=>return Err("Unsupported Character Animator interchange route.".into())
    };
    Ok(json!({
        "plan_type":"character_animator_interchange_plan",
        "route":request.route,
        "project_path":request.project_path,
        "scene_name":request.scene_name,
        "workflow":workflow,
        "execution_supported":false,
        "mutation_performed":false,
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
        assert_eq!(capability["source_milestone_percent"],80);
        assert_eq!(capability["automation_transport"]["status"],"no_public_host_api_claimed");
        assert_eq!(capability["automation_transport"]["implemented"],false);
        assert_eq!(capability["source_runtime_verified"],false);
        assert_eq!(capability["production_ready"],false);

        let readiness=readiness_report();
        assert_eq!(readiness["host_transport"],"not_implemented");
        assert_eq!(readiness["future_host_transport"],"no_public_host_api_claimed");
        assert_eq!(readiness["source_milestone_percent"],80);
        assert_eq!(readiness["project_automation_ready"],"documented_application_shortcuts_only");
    }

    #[test]
    fn control_planner_is_bounded_and_execution_free(){
        let request=ControlPlanRequest{
            control_kind:"application_shortcut".into(),
            command:Some("record_take_work_area".into()),
            key:None,
            midi_note:None,
            acknowledge_project_mapping:false,
        };
        let plan=plan_control(&request).unwrap();
        assert_eq!(plan["execution_supported"],false);
        assert_eq!(plan["mutation_performed"],false);

        let trigger=ControlPlanRequest{
            control_kind:"trigger_key".into(),
            command:None,
            key:Some("H".into()),
            midi_note:None,
            acknowledge_project_mapping:true,
        };
        assert_eq!(plan_control(&trigger).unwrap()["execution_supported"],false);
    }


    #[test]
    fn runtime_preflight_requires_explicit_approval_and_managed_identity(){
        let exe=std::env::temp_dir().join("Character Animator.exe");
        let request=RuntimeControlPreflightRequest{
            control:ControlPlanRequest{
                control_kind:"application_shortcut".into(),
                command:Some("record_take_work_area".into()),
                key:None,
                midi_note:None,
                acknowledge_project_mapping:false,
            },
            character_animator_exe:exe.to_string_lossy().into_owned(),
            expected_pid:42,
            explicit_user_approval:false,
        };
        assert!(request.validate().is_err());

        let approved=RuntimeControlPreflightRequest{
            explicit_user_approval:true,
            ..request
        };
        assert!(approved.validate().is_ok());
        assert!(runtime_control_preflight(&approved,false).is_err());
    }


    #[test]
    fn application_shortcut_runtime_mapping_is_fixed_and_bounded(){
        assert_eq!(application_shortcut_send_keys("record_take_work_area").unwrap(),"^3");
        assert_eq!(application_shortcut_send_keys("export_png_wav").unwrap(),"^%m");
        assert_eq!(application_shortcut_send_keys("export_frame").unwrap(),"^%s");
        assert!(application_shortcut_send_keys("trigger_key").is_err());
    }

    #[test]
    fn interchange_planner_is_execution_free(){
        let path=std::env::temp_dir().join("character.chproj").to_string_lossy().into_owned();
        let request=InterchangePlanRequest{
            route:"dynamic_link_premiere".into(),
            project_path:path,
            scene_name:"Scene 1".into(),
        };
        let plan=plan_interchange(&request).unwrap();
        assert_eq!(plan["execution_supported"],false);
        assert_eq!(plan["workflow"]["character_animator_must_remain_running"],false);
    }
}
