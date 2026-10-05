use serde::{Deserialize,Serialize};
use serde_json::json;
use std::{fs,path::Path};

const MAX_COMMAND:usize=240;

pub fn readiness_report()->serde_json::Value{
    json!({
        "schema_version":1,
        "source_coding_status":"foundation_in_progress",
        "source_runtime_verified":false,
        "production_ready":false,
        "transport":{
            "current":"cep_plus_extendscript",
            "host":"AUDT",
            "uxp_host_api":"not_currently_documented_for_audition"
        },
        "implemented_scope":{
            "desktop_detection":true,
            "cep_bridge_scaffold":true,
            "wave_document_context":true,
            "wave_playhead_readback":true,
            "wave_playhead_write":true,
            "application_command_inventory":true,
            "live_command_search":true,
            "live_script_dictionary_inspection":true,
            "stale_document_signature_guard":true,
            "feature_discovery_planner":true,
            "command_enabled_probe":true,
            "inspected_command_invoke":true,
            "effect_parameter_dom":"not_claimed",
            "noise_reduction_effect_write":"not_claimed",
            "multitrack_mix_write":"not_claimed",
            "real_host_acceptance":"not_verified"
        },
        "boundaries":[
            "Audition automation uses CEP plus ExtendScript because Adobe documents CEP support for Audition",
            "application commands are discovered from the live host rather than guessed",
            "generic command invocation requires a prior inspected command identity and enabled-state recheck",
            "host acceptance does not prove persisted audio output",
            "no effect parameter API is claimed until observed from the live Audition Script Dictionary"
        ]
    })
}

#[cfg(target_os="windows")]
pub fn detect_installs()->Result<serde_json::Value,String>{
    let program_files=std::env::var_os("ProgramFiles").ok_or("ProgramFiles environment variable unavailable.")?;
    let adobe=Path::new(&program_files).join("Adobe");
    if !adobe.is_dir(){return Ok(json!({"candidates":[],"runtime_verified":false}));}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(&adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(128){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("Adobe Audition"){continue;}
        let exe=entry.path().join("Adobe Audition.exe");
        if exe.is_file(){
            candidates.push(json!({
                "name":name,
                "audition_exe":exe,
                "source":"ProgramFiles/Adobe",
                "runtime_verified":false
            }));
        }
    }
    Ok(json!({"candidates":candidates,"runtime_verified":false}))
}

#[cfg(target_os="windows")]
pub fn latest_executable()->Result<std::path::PathBuf,String>{
    let program_files=std::env::var_os("ProgramFiles").ok_or("ProgramFiles environment variable unavailable.")?;
    let adobe=Path::new(&program_files).join("Adobe");
    if !adobe.is_dir(){return Err("Adobe Audition was not found in Program Files/Adobe.".into());}
    let mut candidates=Vec::new();
    for entry in fs::read_dir(&adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(128){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("Adobe Audition"){continue;}
        let exe=entry.path().join("Adobe Audition.exe");
        if exe.is_file(){candidates.push((name,exe));}
    }
    candidates.sort_by(|a,b|a.0.cmp(&b.0));
    candidates.pop().map(|(_,path)|path).ok_or_else(||"Adobe Audition was not found in the standard Adobe Program Files folders.".into())
}

#[cfg(not(target_os="windows"))]
pub fn latest_executable()->Result<std::path::PathBuf,String>{
    Err("Adobe Audition desktop launch is Windows-targeted in Shuvi.".into())
}

#[cfg(not(target_os="windows"))]
pub fn detect_installs()->Result<serde_json::Value,String>{
    Ok(json!({
        "candidates":[],
        "runtime_verified":false,
        "reason":"Adobe Audition desktop detection is Windows-targeted in Shuvi."
    }))
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct InspectedCommand {
    pub property:String,
    pub value:String,
}

impl InspectedCommand{
    pub fn validate(&self)->Result<(),String>{
        for (label,value) in [("property",self.property.as_str()),("value",self.value.as_str())]{
            let trimmed=value.trim();
            if trimmed.is_empty()||trimmed.len()>MAX_COMMAND||trimmed.chars().any(char::is_control){
                return Err(format!("Audition command {label} is empty, oversized, or contains control characters."));
            }
        }
        if !self.property.starts_with("COMMAND_"){
            return Err("Audition command property must come from the inspected COMMAND_ inventory.".into());
        }
        Ok(())
    }
}

pub fn feature_queries(feature:&str)->Result<&'static [&'static str],String>{
    match feature {
        "noise_reduction" => Ok(&["noise","denoise","reduction"]),
        "eq" => Ok(&["equalizer","parametric","eq"]),
        "compressor" => Ok(&["compressor","compression","dynamics"]),
        "loudness" => Ok(&["loudness","normalize","amplitude"]),
        "export" => Ok(&["export","save","mixdown"]),
        "multitrack" => Ok(&["multitrack","mix","track"]),
        "voice_cleanup" => Ok(&["speech","voice","noise","dynamics"]),
        _ => Err("Audition feature must be noise_reduction, eq, compressor, loudness, export, multitrack, or voice_cleanup.".into()),
    }
}

pub fn validate_document_signature(value:&str)->Result<&str,String>{
    let trimmed=value.trim();
    if trimmed.is_empty()||trimmed.len()>1200||trimmed.chars().any(char::is_control){
        return Err("Audition expected document signature must be 1..1200 characters without control characters.".into());
    }
    Ok(trimmed)
}

pub fn validate_playhead_percent(value:f64)->Result<f64,String>{
    if !value.is_finite()||!(0.0..=1.0).contains(&value){
        return Err("Audition playhead percent must be between 0 and 1.".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn command_identity_is_bounded_and_inspected(){
        let good=InspectedCommand{property:"COMMAND_transport_play".into(),value:"transport.play".into()};
        good.validate().unwrap();
        assert!(InspectedCommand{property:"transport_play".into(),value:"transport.play".into()}.validate().is_err());
        assert!(InspectedCommand{property:"COMMAND_x".into(),value:"".into()}.validate().is_err());
    }
    #[test]fn playhead_is_bounded(){
        assert_eq!(validate_playhead_percent(0.5).unwrap(),0.5);
        assert!(validate_playhead_percent(-0.1).is_err());
        assert!(validate_playhead_percent(1.1).is_err());
    }
    #[test]fn discovery_features_are_bounded(){
        assert_eq!(feature_queries("noise_reduction").unwrap()[0],"noise");
        assert!(feature_queries("unknown").is_err());
        assert_eq!(validate_document_signature("WaveDocument|voice.wav|48000|1000").unwrap(),"WaveDocument|voice.wav|48000|1000");
        assert!(validate_document_signature("").is_err());
    }
}
