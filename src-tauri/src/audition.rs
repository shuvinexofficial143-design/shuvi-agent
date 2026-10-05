use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::BTreeMap,fs,path::Path};

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
            "ranked_feature_command_candidates":true,
            "guarded_feature_command_invoke":true,
            "read_only_runtime_probe":true,
            "disposable_acceptance_registration":true,
            "acceptance_read_only_plan":true,
            "acceptance_destructive_execution":"not_implemented",
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
            "ranked command candidates are keyword evidence only and do not establish semantic effect behavior",
            "disposable acceptance registration never enables mutation automatically",
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

pub fn rank_feature_commands(feature:&str,inventories:&[Value])->Result<Vec<Value>,String>{
    let allowed_queries=feature_queries(feature)?;
    let mut by_identity:BTreeMap<(String,String),(u32,Vec<String>,String)>=BTreeMap::new();

    for inventory in inventories.iter().take(8){
        let query=inventory.get("query").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        if !allowed_queries.iter().any(|allowed|*allowed==query){continue;}
        let Some(rows)=inventory.get("commands").and_then(Value::as_array) else{continue;};

        for row in rows.iter().take(100){
            let Some(property)=row.get("property").and_then(Value::as_str) else{continue;};
            let Some(value)=row.get("value").and_then(Value::as_str) else{continue;};
            if property.is_empty()||value.is_empty()||property.len()>MAX_COMMAND||value.len()>MAX_COMMAND{continue;}
            let help=row.get("help").and_then(Value::as_str).unwrap_or("");
            let property_l=property.to_ascii_lowercase();
            let value_l=value.to_ascii_lowercase();
            let help_l=help.to_ascii_lowercase();

            let mut score=1_u32;
            if property_l.contains(&query){score=score.saturating_add(4);}
            if value_l.contains(&query){score=score.saturating_add(4);}
            if help_l.contains(&query){score=score.saturating_add(2);}

            let entry=by_identity.entry((property.to_string(),value.to_string()))
                .or_insert_with(||(0,Vec::new(),help.chars().take(500).collect()));
            entry.0=entry.0.saturating_add(score);
            if !entry.1.iter().any(|existing|existing==&query){entry.1.push(query.clone());}
        }
    }

    let mut ranked=by_identity.into_iter().map(|((property,value),(score,query_hits,help))|
        json!({"property":property,"value":value,"help":help,"score":score,"query_hits":query_hits})
    ).collect::<Vec<_>>();
    ranked.sort_by(|a,b|{
        let a_score=a.get("score").and_then(Value::as_u64).unwrap_or(0);
        let b_score=b.get("score").and_then(Value::as_u64).unwrap_or(0);
        b_score.cmp(&a_score).then_with(||
            a.get("property").and_then(Value::as_str).unwrap_or("")
                .cmp(b.get("property").and_then(Value::as_str).unwrap_or("")))
    });
    ranked.truncate(32);
    Ok(ranked)
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
    #[test]fn feature_command_ranking_deduplicates_and_scores_live_matches(){
        let inventories=vec![
            json!({"query":"noise","commands":[
                {"property":"COMMAND_effect_noise","value":"effect.noise","help":"Noise Reduction"},
                {"property":"COMMAND_other","value":"other","help":"Noise helper"}]}),
            json!({"query":"reduction","commands":[
                {"property":"COMMAND_effect_noise","value":"effect.noise","help":"Noise Reduction"}]})
        ];
        let ranked=rank_feature_commands("noise_reduction",&inventories).unwrap();
        assert_eq!(ranked.len(),2);
        assert_eq!(ranked[0]["property"],"COMMAND_effect_noise");
        assert!(ranked[0]["score"].as_u64().unwrap()>ranked[1]["score"].as_u64().unwrap());
        assert!(rank_feature_commands("unknown",&inventories).is_err());
    }
}
