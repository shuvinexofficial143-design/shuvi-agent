use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};

const MAX_BYTES: usize = 8192;
const MAX_ACTIONS: usize = 12;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub schema_version: u8,
    pub project_guid: String,
    pub project_path: String,
    pub sequence_guid: Option<String>,
    pub registered_at_ms: u64,
    pub explicitly_authorized: bool,
}

fn bounded(s: &str, limit: usize) -> bool { !s.trim().is_empty() && s.len() <= limit && !s.contains('\0') }

impl Registration {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1 || !self.explicitly_authorized || !bounded(&self.project_guid,240)
            || !bounded(&self.project_path,1024) || !Path::new(&self.project_path).is_absolute()
            || !self.project_path.to_ascii_lowercase().ends_with(".prproj")
            || self.sequence_guid.as_ref().is_some_and(|s|!bounded(s,240)) || self.registered_at_ms==0 {
            return Err("Invalid disposable project registration.".into());
        }Ok(())
    }
    pub fn new(project: &str, path: &str, sequence: Option<&str>, authorized: bool) -> Result<Self,String> {
        if !authorized || !bounded(project,240) || !bounded(path,1024)
            || sequence.is_some_and(|s| !bounded(s,240))
            || !Path::new(path).is_absolute() || !Path::new(path).is_file()
            || !path.to_ascii_lowercase().ends_with(".prproj") {
            return Err("Disposable registration requires explicit authorization, exact GUID and existing absolute .prproj file.".into());
        }
        Ok(Self { schema_version:1, project_guid:project.into(),project_path:path.into(),
            sequence_guid:sequence.map(str::to_owned), registered_at_ms:SystemTime::now().duration_since(UNIX_EPOCH)
                .unwrap_or_default().as_millis() as u64, explicitly_authorized:true })
    }
    pub fn check(&self, context: &Value) -> Result<(),String> {
        self.validate()?;
        if self.schema_version!=1 || !self.explicitly_authorized || !bounded(&self.project_guid,240)
            || !bounded(&self.project_path,1024) || !Path::new(&self.project_path).is_absolute()
            || !Path::new(&self.project_path).is_file()
            || self.sequence_guid.as_ref().is_some_and(|s| !bounded(s,240)) {
            return Err("Disposable registration is invalid or project file is missing.".into());
        }
        if context.get("projectGuid").and_then(Value::as_str)!=Some(self.project_guid.as_str())
            || context.get("projectPath").and_then(Value::as_str)!=Some(self.project_path.as_str())
            || self.sequence_guid.as_ref().is_some_and(|s|
                context.pointer("/activeSequence/guid").and_then(Value::as_str)!=Some(s.as_str())) {
            return Err("Disposable registration is stale: project path, GUID or sequence changed.".into());
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Result<Option<Registration>,String> {
    let read=|p:&Path| -> Result<Registration,String> {
        let bytes=crate::read_file_bytes_bounded(p, MAX_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_BYTES { return Err("Disposable registration exceeds limit.".into()); }
        let r:Registration=serde_json::from_slice(&bytes).map_err(|_|"Corrupt disposable registration.")?;
        r.validate()?;
        Ok(r)
    };
    if !path.exists() && !path.with_extension("json.bak").exists(){return Ok(None);}
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){read(&path.with_extension("json.bak"))}else{Err(e)}).map(Some)
}

pub fn save(path:&Path, registration:&Registration) -> Result<(),String> {
    registration.validate()?;
    let bytes=serde_json::to_vec(registration).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_BYTES {return Err("Disposable registration exceeds limit.".into());}
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,|data|{
        let registration:Registration=serde_json::from_slice(data).map_err(|e|e.to_string())?;registration.validate()
    })
}

fn has_dedicated_execution_adapter(step:&str,tool:&str)->bool{
    matches!((step,tool),
        ("trim","premiere_trim_clip")|("move","premiere_move_clip")|
        ("clone","premiere_clone_clip")|("delete_ripple","premiere_delete_clip")|
        ("scene_markers","premiere_detect_scene_markers"))
}

pub fn plan(group:u8, registration:Option<&Registration>, context:Option<&Value>) -> Result<Value,String> {
    let actions: &[(&str,&str,bool)] = match group {
        1 => &[("context","premiere_context",false),("timeline","premiere_timeline",false),("diagnostics","premiere_project_diagnostics",false)],
        2 => &[("timeline","premiere_timeline",false),("trim","premiere_trim_clip",true),("move","premiere_move_clip",true),("clone","premiere_clone_clip",true),("delete_ripple","premiere_delete_clip",true),("transition","premiere_add_video_transition",true),("scene_markers","premiere_detect_scene_markers",true),("tracks","premiere_organize_tracks",true),("relink","premiere_relink_media",true),("proxy","premiere_attach_proxy",true)],
        3 => &[("inspect_effects","premiere_inspect_clip_effects",false),("effect","premiere_add_video_effect",true),("parameter","premiere_set_video_param_named",true),("keyframe","premiere_add_video_keyframe_named",true),("remove","premiere_remove_effect",true),("inspect_keys","premiere_inspect_keyframes",false),("edit_key","premiere_edit_keyframe",true),("remove_keys","premiere_remove_keyframe_range",true),("finishing_batch","premiere_batch_finish",true)],
        4 => &[("inspect_audio","premiere_inspect_audio_clip_effects",false),("parameter","premiere_set_audio_param_named",true),("automation","premiere_apply_audio_recipe",true),("audio_effect","premiere_add_audio_effect",true),("audio_remove","premiere_remove_effect",true)],
        5 => &[("inspect_graphics","premiere_inspect_mogrt_properties",false),("insert","premiere_insert_mogrt_path",true),("property","premiere_apply_video_recipe",true),("graphics_batch","premiere_batch_graphics",true)],
        6 => &[("transcript","premiere_export_transcript",false),("caption_adapter","premiere_caption_tracks",false),("import_transcript","premiere_import_transcript",true),("rebuild","premiere_apply_transcript_rebuild",true)],
        7 => &[("timeline","premiere_timeline",false),("frame","premiere_inspect_frame",false),("review","premiere_review_session_start",false)],
        8 => &[("preflight","premiere_plan_export",false),("immediate","premiere_export_sequence",true),("ame","premiere_export_sequence",true),("frame","premiere_export_frame",true),("review_frames","premiere_export_review_frames",true),("fcpxml","premiere_export_fcpxml",true),("otio","premiere_export_otio",true),("aaf","premiere_export_aaf",true),("srt","premiere_transcript_to_srt",true)],
        _ => return Err("Acceptance group must be 1–8.".into()),
    };
    if actions.len()>MAX_ACTIONS {return Err("Acceptance action budget exceeded.".into());}
    let ready=registration.zip(context).is_some_and(|(r,c)|r.check(c).is_ok());
    Ok(json!({"group":group,"estimated_action_count":actions.len(),"action_limit":MAX_ACTIONS,
        "read_only_steps":actions.iter().filter(|a|!a.2).map(|a|json!({"id":a.0,"tool":a.1})).collect::<Vec<_>>(),
        "mutating_steps":actions.iter().filter(|a|a.2).map(|a|{
            let adapter=has_dedicated_execution_adapter(a.0,a.1);
            json!({"id":a.0,"tool":a.1,
                "requires_permission":true,"requires_prproj_checkpoint":true,"requires_exact_expectation":true,
                "requires_audit_receipt":true,"acceptance_execution_adapter":adapter,
                "runtime_promotion_supported":adapter,
                "manual_typed_execution_only":!adapter,
                "recovery":"Inspect checkpoint; rollback is not automatic."})
        }).collect::<Vec<_>>(),
        "dedicated_execution_steps":actions.iter().filter(|a|a.2&&has_dedicated_execution_adapter(a.0,a.1))
            .map(|a|a.0).collect::<Vec<_>>(),
        "planned_only_mutation_steps":actions.iter().filter(|a|a.2&&!has_dedicated_execution_adapter(a.0,a.1))
            .map(|a|a.0).collect::<Vec<_>>(),
        "evidence_promoted":false,"runtime_verified":false,
        "adversarial_cases":["cancel_after_completion","stale_cancel_after_restart","timeout_after_dispatch_no_retry",
            "wrong_action_response","checkpoint_failure_no_mutation","stale_clip_or_effect_chain","partial_export_not_complete"],
        "evidence_levels":["CODE_PRESENT","MOCK_VERIFIED","RUST_TESTED","WINDOWS_RUNTIME_VERIFIED","PREMIERE_HOST_ACCEPTED","RECOVERY_VERIFIED","EXPORT_COMPLETION_VERIFIED"],
        "disposable_project_verified":ready,"blocked_reasons":if actions.iter().any(|a|a.2) && !ready {
            vec!["requires_disposable_project: explicitly register the current saved project and revalidate its identity"]
        } else {vec![]},"execution":"One typed tool at a time via normal approval; planning never edits or promotes runtime evidence."}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn groups_bounded_and_read_only_plan(){for g in 1..=8 {let p=plan(g,None,None).unwrap();assert!(p["estimated_action_count"].as_u64().unwrap()<=12);}assert!(plan(9,None,None).is_err());}
    #[test] fn registration_requires_explicit_existing_project(){assert!(Registration::new("p","/missing.prproj",None,true).is_err());assert!(Registration::new("p","relative.prproj",None,false).is_err());}
    #[test] fn mismatch_refuses_mutating_plan(){let p=plan(2,None,Some(&json!({"projectGuid":"p"}))).unwrap();assert_eq!(p["disposable_project_verified"],false);assert_eq!(p["mutating_steps"][0]["requires_prproj_checkpoint"],true);}
    #[test] fn plan_distinguishes_dedicated_acceptance_adapters_from_manual_typed_steps(){
        let p=plan(2,None,None).unwrap();
        let trim=p["mutating_steps"].as_array().unwrap().iter().find(|v|v["id"]=="trim").unwrap();
        let transition=p["mutating_steps"].as_array().unwrap().iter().find(|v|v["id"]=="transition").unwrap();
        assert_eq!(trim["acceptance_execution_adapter"],true);assert_eq!(trim["runtime_promotion_supported"],true);
        assert_eq!(transition["acceptance_execution_adapter"],false);assert_eq!(transition["manual_typed_execution_only"],true);
        let p3=plan(3,None,None).unwrap();assert!(p3["dedicated_execution_steps"].as_array().unwrap().is_empty());
    }
}
