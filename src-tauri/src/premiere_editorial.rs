use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const PRESETS: &[&str] = &[
    "social_reel", "cinematic_reel", "talking_head", "product_ad",
    "wedding_highlight", "long_form_youtube", "story_explainer", "clean_corporate",
];
const MAX_BYTES: usize = 32 * 1024;
const MAX_STAGES: usize = 32;
const STATES: &[&str] = &["pending", "blocked", "awaiting_approval", "applied", "skipped", "failed", "review_required", "completed"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stage {
    pub id: String,
    pub stage_type: String,
    pub dependencies: Vec<String>,
    pub required_capability: String,
    pub targets: Value,
    pub parameters: Value,
    pub review_required: bool,
    pub state: String,
    pub unsupported_behavior: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    pub schema_version: u8,
    pub name: String,
    pub category: String,
    pub stages: Vec<Stage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub preset: String,
    #[serde(default)]
    pub targets: HashMap<String, Value>,
    #[serde(default)]
    pub inputs: HashMap<String, Value>,
    #[serde(default)]
    pub options: HashMap<String, Value>,
}

fn code_keys(value: &Value, depth: u8) -> bool {
    if depth > 6 { return true; }
    match value {
        Value::Object(m) => m.iter().any(|(k,v)| {
            matches!(k.to_ascii_lowercase().as_str(), "js" | "javascript" | "script" | "shell" | "command" | "uxp_action" | "eval" | "code")
                || code_keys(v,depth+1)
        }),
        Value::Array(v) => v.iter().any(|x| code_keys(x,depth+1)),
        _ => false,
    }
}

impl Recipe {
    pub fn validate(&self) -> Result<(), String> {
        let encoded = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if encoded.len() > MAX_BYTES || self.schema_version != 1 || self.stages.is_empty()
            || self.stages.len() > MAX_STAGES || self.name.len() > 120 || self.category.len() > 80 {
            return Err("Invalid version or oversized editorial recipe.".into());
        }
        let mut ids = HashSet::new();
        for stage in &self.stages {
            if stage.id.is_empty() || stage.id.len() > 80 || !ids.insert(stage.id.as_str())
                || stage.dependencies.len() > 16 || !STATES.contains(&stage.state.as_str())
                || stage.description.len() > 300 || stage.unsupported_behavior.len() > 300
                || !matches!(stage.stage_type.as_str(),"inspect"|"cut"|"motion"|"color"|"audio"|"graphics"|"native_caption"|"review"|"export"|"input_dependency"|"unsupported")
                || stage.required_capability.len() > 80
                || !matches!(stage.stage_type.as_str(),"native_caption"|"input_dependency"|"unsupported")
                    && stage.required_capability != capability(&stage.stage_type)
                || matches!(stage.stage_type.as_str(),"native_caption"|"input_dependency"|"unsupported")
                    && !matches!(stage.required_capability.as_str(),"unsupported"|"unsupported_native_caption_write"|"unsupported_automatic_detection")
                || code_keys(&stage.parameters,0) || code_keys(&stage.targets,0) {
                return Err("Invalid editorial stage or executable-code field.".into());
            }
        }
        let map: HashMap<_,_> = self.stages.iter().enumerate().map(|(i,s)|(s.id.as_str(),i)).collect();
        for (index,stage) in self.stages.iter().enumerate() {
            let mut unique=HashSet::new();
            for dependency in &stage.dependencies {
                let Some(&parent)=map.get(dependency.as_str()) else { return Err("Missing editorial stage dependency.".into()); };
                if parent>=index || !unique.insert(dependency) { return Err("Editorial recipe dependency cycle or invalid ordering.".into()); }
            }
        }
        Ok(())
    }
}

pub fn transition(stage: &mut Stage, next: &str) -> Result<(), String> {
    let valid=match (stage.state.as_str(),next) {
        ("pending","blocked"|"awaiting_approval"|"review_required"|"skipped"|"completed")
        | ("awaiting_approval","applied"|"failed"|"skipped")
        | ("applied","review_required"|"completed")
        | ("review_required","completed"|"failed"|"skipped")
        | ("blocked","skipped") => true,
        _ => false,
    };
    if !valid { return Err("Invalid editorial stage transition or retry.".into()); }
    stage.state=next.into();
    Ok(())
}

fn spec(preset: &str) -> &'static [(&'static str,&'static str,&'static str)] {
    match preset {
        "social_reel" => &[("pace","hook and supplied fast cut regions","cut"),("motion","controlled punch motion","motion"),("grade","punch color","color"),("audio","dialogue ducking","audio"),("graphics","supplied title or CTA","graphics")],
        "cinematic_reel" => &[("pace","deliberate supplied cut regions","cut"),("motion","restrained push or pull","motion"),("grade","cinematic contrast and continuity","color"),("audio","music and dialogue balance","audio"),("graphics","restrained title","graphics")],
        "talking_head" => &[("pace","supplied dead-space boundaries","cut"),("motion","clean punch-in","motion"),("grade","consistent neutral color","color"),("audio","dialogue priority and ducking","audio"),("graphics","lower third","graphics")],
        "product_ad" => &[("pace","product visibility pacing","cut"),("motion","product-focused motion","motion"),("grade","premium clean grade","color"),("audio","music and dialogue balance","audio"),("graphics","supplied product text and CTA","graphics")],
        "wedding_highlight" => &[("pace","emotional pacing intent with supplied regions","cut"),("motion","restrained Ken Burns motion","motion"),("grade","soft color and skin tone review","color"),("audio","music balance","audio"),("graphics","restrained supplied titles","graphics")],
        "long_form_youtube" => &[("pace","supplied section and B-roll boundaries","cut"),("motion","restrained talking-head corrections","motion"),("grade","consistent color","color"),("audio","audio continuity","audio"),("graphics","supplied lower thirds","graphics")],
        "story_explainer" => &[("pace","supplied narration scene timing","cut"),("motion","controlled motion on stills","motion"),("grade","visual continuity","color"),("audio","narration music ducking","audio"),("graphics","supplied titles","graphics")],
        "clean_corporate" => &[("pace","restrained supplied cuts","cut"),("motion","minimal controlled motion","motion"),("grade","neutral professional grade","color"),("audio","dialogue-first mix","audio"),("graphics","clean supplied lower thirds","graphics")],
        _ => &[],
    }
}

fn required(stage_type:&str) -> &'static [&'static str] {
    match stage_type {
        "cut" => &["start_seconds","end_seconds"],
        "motion"|"color" => &["settings"],
        "audio" => &["regions","baseline"],
        "graphics" => &["fields"],
        "transition" => &["match_name","duration_seconds","position"],
        "review" => &["sample_times"],
        _ => &[],
    }
}

fn capability(stage_type:&str) -> &'static str {
    match stage_type {
        "inspect"=>"premiere_timeline",
        "cut"=>"premiere_trim_clip",
        "motion"|"color"=>"premiere_apply_video_recipe",
        "audio"=>"premiere_plan_audio_automation",
        "graphics"=>"premiere_plan_mogrt_recipe",
        "transition"=>"premiere_add_video_transition",
        "review"=>"premiere_review_session_start",
        "export"=>"premiere_export_sequence",
        _ => "unsupported",
    }
}

fn exact_target(target: &Value) -> bool {
    target.get("project_guid").and_then(Value::as_str).is_some_and(|s|!s.is_empty() && s.len()<=240)
        && target.get("sequence_guid").and_then(Value::as_str).is_some_and(|s|!s.is_empty() && s.len()<=240)
        && target.get("expected_signature").and_then(Value::as_str).is_some_and(|s|!s.is_empty() && s.len()<=4096)
        && target.get("kind").and_then(Value::as_str).is_some_and(|s|matches!(s,"video"|"audio"))
        && target.get("track").and_then(Value::as_u64).is_some_and(|n|n<=128)
        && target.get("clip_index").and_then(Value::as_u64).is_some_and(|n|n<=10_000)
}

fn parameters_valid(stage_type: &str, parameters: &Value) -> bool {
    match stage_type {
        "cut" => {
            let a=parameters.get("start_seconds").and_then(Value::as_f64);
            let b=parameters.get("end_seconds").and_then(Value::as_f64);
            matches!((a,b),(Some(a),Some(b)) if a.is_finite() && b.is_finite() && a>=0.0 && b>a && b<=86_400.0)
        },
        "motion"|"color" => parameters.get("settings").and_then(Value::as_array)
            .is_some_and(|v|!v.is_empty() && v.len()<=24 && v.iter().all(|s|
                s.get("component_match_name").or_else(||s.get("component_display_name")).and_then(Value::as_str).is_some_and(|n|!n.is_empty())
                && s.get("param_display_name").and_then(Value::as_str).is_some_and(|n|!n.is_empty())
                && s.get("value").is_some())),
        "audio" => parameters.get("regions").and_then(Value::as_array)
            .is_some_and(|v|!v.is_empty() && v.len()<=32 && v.iter().all(|r| {
                let a=r.get("start").and_then(Value::as_f64);let b=r.get("end").and_then(Value::as_f64);
                matches!((a,b),(Some(a),Some(b)) if a.is_finite() && b.is_finite() && a>=0.0 && b>a)
            })) && parameters.get("baseline").and_then(Value::as_f64).is_some_and(|v|v.is_finite() && v>=0.0),
        "graphics" => parameters.get("fields").and_then(Value::as_array)
            .is_some_and(|v|!v.is_empty() && v.len()<=16 && v.iter().all(|f|f.get("param_display_name").and_then(Value::as_str).is_some_and(|s|!s.is_empty()))),
        "review" => parameters.get("sample_times").and_then(Value::as_array)
            .is_some_and(|v|!v.is_empty() && v.len()<=4 && v.iter().all(|t|t.as_f64().is_some_and(|n|n.is_finite() && (0.0..=86_400.0).contains(&n)))),
        _ => false,
    }
}

pub fn plan(request: Request) -> Result<Value,String> {
    let raw=serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if raw.len()>MAX_BYTES || !PRESETS.contains(&request.preset.as_str()) || code_keys(&serde_json::to_value(&request).unwrap_or_default(),0) {
        return Err("Unknown, oversized or executable editorial recipe request.".into());
    }
    if request.targets.len()>MAX_STAGES || request.inputs.len()>MAX_STAGES || request.options.len()>16 {
        return Err("Editorial recipe inputs exceed limits.".into());
    }
    let mut stages=vec![Stage { id:"inspect".into(),stage_type:"inspect".into(),dependencies:vec![],required_capability:capability("inspect").into(),
        targets:json!({}),parameters:json!({}),review_required:false,state:"pending".into(),unsupported_behavior:"Stop if project or sequence unavailable.".into(),
        description:"Inspect project, sequence, timeline and exact targets.".into() }];
    for &(id,description,stage_type) in spec(&request.preset) {
        stages.push(Stage {id:id.into(),stage_type:stage_type.into(),dependencies:vec!["inspect".into()],
            required_capability:capability(stage_type).into(),targets:request.targets.get(id).cloned().unwrap_or(json!({})),
            parameters:request.inputs.get(id).cloned().unwrap_or(json!({})),review_required:stage_type!="cut",
            state:"pending".into(),unsupported_behavior:"Block until exact inspected target, parameters and normal approval/checkpoint are available.".into(),
            description:description.into()});
    }
    if let Some((id,description,required_input))=match request.preset.as_str() {
        "social_reel" => Some(("beat_sync","Beat alignment needs user-supplied timestamps; no beat detector.","beat_seconds")),
        "long_form_youtube" => Some(("b_roll","B-roll placement needs user-supplied asset paths and exact boundaries.","b_roll_assets")),
        "story_explainer" => Some(("narration_sync","Scene synchronization needs supplied narration timing.","narration_regions")),
        _ => None,
    } {
        stages.push(Stage {id:id.into(),stage_type:"input_dependency".into(),dependencies:vec!["inspect".into()],
            required_capability:"unsupported_automatic_detection".into(),targets:json!({}),
            parameters:request.inputs.get(id).cloned().unwrap_or(json!({})),review_required:true,state:"blocked".into(),
            unsupported_behavior:format!("Missing or unverified {required_input}; no inferred timing/assets."),
            description:description.into()});
    }
    for (key,description) in [("speed","Native speed/time-remapping writes are unsupported."),
        ("masks","Native mask writes are unsupported."),("multicam","Reliable multicam is unsupported."),
        ("vertical_track_moves","Vertical track moves are unsupported.")] {
        if request.options.get(key).and_then(Value::as_bool)==Some(true) {
            stages.push(Stage {id:key.into(),stage_type:"unsupported".into(),dependencies:vec!["inspect".into()],
                required_capability:"unsupported".into(),targets:json!({}),parameters:json!({}),review_required:false,
                state:"blocked".into(),unsupported_behavior:description.into(),description:description.into()});
        }
    }
    stages.push(Stage {id:"captions".into(),stage_type:"native_caption".into(),dependencies:vec!["inspect".into()],required_capability:"unsupported_native_caption_write".into(),
        targets:json!({}),parameters:json!({}),review_required:true,state:"blocked".into(),unsupported_behavior:"Native caption creation/import is unverified; SRT preview is available separately.".into(),
        description:"Readable captions when supplied; no native write claim.".into()});
    stages.push(Stage {id:"review".into(),stage_type:"review".into(),dependencies:vec!["inspect".into()],required_capability:capability("review").into(),
        targets:json!({}),parameters:request.inputs.get("review").cloned().unwrap_or(json!({})),review_required:true,state:"review_required".into(),
        unsupported_behavior:"Review requires active Premiere, vision provider and explicit sample positions.".into(),
        description:"Bounded multi-frame continuity and quality review.".into()});
    stages.push(Stage {id:"export".into(),stage_type:"export".into(),dependencies:vec!["review".into()],required_capability:capability("export").into(),
        targets:json!({}),parameters:request.inputs.get("export").cloned().unwrap_or(json!({})),review_required:false,state:"blocked".into(),
        unsupported_behavior:"Export intent only; separately inspect destination and approve native export.".into(),
        description:"Final platform and aspect-ratio export intent.".into()});
    let mut missing=Vec::new();
    let mut supported=Vec::new();
    let mut blocked=Vec::new();
    for stage in &mut stages {
        if stage.id=="inspect" { supported.push(stage.id.clone()); continue; }
        if stage.stage_type=="input_dependency" {
            let field=match stage.id.as_str() {"beat_sync"=>"beat_seconds","b_roll"=>"b_roll_assets",_=>"narration_regions"};
            if stage.parameters.get(field).is_none_or(Value::is_null) { missing.push(format!("{}.{}",stage.id,field)); }
        }
        if matches!(stage.stage_type.as_str(),"native_caption"|"export"|"unsupported"|"input_dependency") {
            blocked.push(stage.id.clone()); continue;
        }
        for key in required(&stage.stage_type) {
            if stage.parameters.get(*key).is_none_or(Value::is_null) {
                missing.push(format!("{}.{}",stage.id,key));
            }
        }
        let kind=stage.targets.get("kind").and_then(Value::as_str).unwrap_or("");
        let has_target=stage.stage_type=="review" || (exact_target(&stage.targets)
            && match stage.stage_type.as_str() {
                "color"|"motion"|"graphics"|"transition" => kind=="video",
                "audio" => kind=="audio",
                _ => true,
            });
        let missing_here=required(&stage.stage_type).iter().any(|key|stage.parameters.get(*key).is_none_or(Value::is_null));
        if !has_target { missing.push(format!("{}.exact_inspected_target",stage.id)); }
        if !missing_here && !parameters_valid(&stage.stage_type,&stage.parameters) { missing.push(format!("{}.valid_typed_parameters",stage.id)); }
        if missing_here || !has_target || !parameters_valid(&stage.stage_type,&stage.parameters) {
            stage.state="blocked".into();blocked.push(stage.id.clone());
        }
        else { supported.push(stage.id.clone()); }
    }
    let recipe=Recipe {schema_version:1,name:format!("{} editorial foundation",request.preset.replace('_'," ")),
        category:request.preset,stages};
    recipe.validate()?;
    Ok(json!({"applied":false,"recipe":recipe,"supported_stages":supported,"blocked_stages":blocked,
        "missing_inputs":missing,"warnings":["Read-only plan; every mutating stage uses the existing typed permission, checkpoint, target expectation and audit flow.","No beat detection, silence detection, invented B-roll, native captions, masks or speed writes."]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn all_packs_and_missing_inputs() {
        for preset in PRESETS {
            let result=plan(Request {preset:(*preset).into(),targets:HashMap::new(),inputs:HashMap::new(),options:HashMap::new()}).unwrap();
            assert_eq!(result["applied"],false);
            assert!((9..=10).contains(&result["recipe"]["stages"].as_array().unwrap().len()));
            assert!(result["blocked_stages"].as_array().unwrap().len()>4);
        }
    }
    #[test] fn unsupported_and_cycles() {
        assert!(plan(Request {preset:"wrong".into(),targets:HashMap::new(),inputs:HashMap::new(),options:HashMap::new()}).is_err());
        let mut r:Recipe=serde_json::from_value(plan(Request {preset:"social_reel".into(),targets:HashMap::new(),inputs:HashMap::new(),options:HashMap::new()}).unwrap()["recipe"].clone()).unwrap();
        r.stages[0].dependencies.push("review".into());assert!(r.validate().is_err());
        r.stages[0].dependencies=vec!["missing".into()];assert!(r.validate().is_err());
        r.stages[0].dependencies.clear();
        for i in 0..33 {let mut s=r.stages[0].clone();s.id=format!("extra{i}");r.stages.push(s);}
        assert!(r.validate().is_err());
    }
    #[test] fn stage_state_is_bounded() {
        let mut s=Stage {id:"x".into(),stage_type:"cut".into(),dependencies:vec![],required_capability:"premiere_trim_clip".into(),targets:json!({}),parameters:json!({}),review_required:false,state:"pending".into(),unsupported_behavior:"".into(),description:"".into()};
        transition(&mut s,"awaiting_approval").unwrap();transition(&mut s,"applied").unwrap();
        transition(&mut s,"review_required").unwrap();transition(&mut s,"completed").unwrap();
        assert!(transition(&mut s,"pending").is_err());
    }
    #[test] fn exact_typed_stage_and_input_guards() {
        let mut targets=HashMap::new();targets.insert("pace".into(),json!({
            "project_guid":"p","sequence_guid":"s","expected_signature":"inspected",
            "kind":"video","track":0,"clip_index":0
        }));
        let mut inputs=HashMap::new();inputs.insert("pace".into(),json!({"start_seconds":1,"end_seconds":3}));
        let r=plan(Request {preset:"social_reel".into(),targets:targets.clone(),inputs:inputs.clone(),options:HashMap::new()}).unwrap();
        assert!(r["supported_stages"].as_array().unwrap().contains(&json!("pace")));
        inputs.insert("pace".into(),json!({"start_seconds":3,"end_seconds":1}));
        let r=plan(Request {preset:"social_reel".into(),targets,inputs,options:HashMap::new()}).unwrap();
        assert!(r["blocked_stages"].as_array().unwrap().contains(&json!("pace")));
    }
    #[test] fn executable_fields_and_old_parameter_recipe_separation() {
        let request=json!({"preset":"talking_head","inputs":{"grade":{"script":"alert(1)"}}});
        let parsed:Request=serde_json::from_value(request).unwrap();
        assert!(plan(parsed).is_err());
        let legacy=json!({"name":"old","kind":"video","settings":[{"value":1}]});
        assert!(serde_json::from_value::<Recipe>(legacy).is_err());
    }
    #[test] fn bounds_and_unsupported_options() {
        let mut options=HashMap::new();options.insert("speed".into(),json!(true));options.insert("masks".into(),json!(true));
        let r=plan(Request {preset:"cinematic_reel".into(),targets:HashMap::new(),inputs:HashMap::new(),options}).unwrap();
        assert!(r["blocked_stages"].as_array().unwrap().contains(&json!("speed")));
        assert!(r["blocked_stages"].as_array().unwrap().contains(&json!("masks")));
        let mut inputs=HashMap::new();inputs.insert("huge".into(),json!("x".repeat(35_000)));
        assert!(plan(Request {preset:"social_reel".into(),targets:HashMap::new(),inputs,options:HashMap::new()}).is_err());
    }
}
