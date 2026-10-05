use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::{BTreeMap,HashSet};

const MAX_OBJECTIVE_CHARS:usize=1_500;
const MAX_SCENES:usize=64;
const MAX_LAYERS_PER_SCENE:usize=128;
const MAX_TRACKS_PER_LAYER:usize=32;
const MAX_KEYFRAMES_PER_TRACK:usize=96;
const MAX_REVIEW_SAMPLES:usize=32;
const MAX_REVIEW_CRITERIA:usize=24;
const MAX_LABEL_CHARS:usize=240;

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Renderer {
    Auto,
    AfterEffects,
    Remotion,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum DeliveryKind {
    StandaloneVideo,
    TransparentOverlay,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum LayerKind {
    Text,
    Shape,
    Image,
    Video,
    Group,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Property {
    X,
    Y,
    ScaleX,
    ScaleY,
    RotationDegrees,
    Opacity,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Hold,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Canvas {
    pub width:u32,
    pub height:u32,
    pub fps:f64,
    pub transparent_background:bool,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub time_seconds:f64,
    pub value:f64,
    pub easing:Easing,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Track {
    pub property:Property,
    pub keyframes:Vec<Keyframe>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layer {
    pub id:String,
    pub kind:LayerKind,
    pub name:String,
    #[serde(default)]
    pub text:Option<String>,
    #[serde(default)]
    pub asset_id:Option<String>,
    #[serde(default)]
    pub tracks:Vec<Track>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub id:String,
    pub start_seconds:f64,
    pub duration_seconds:f64,
    pub layers:Vec<Layer>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewSpec {
    #[serde(default)]
    pub sample_times_seconds:Vec<f64>,
    #[serde(default)]
    pub criteria:Vec<String>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub schema_version:u8,
    pub objective:String,
    pub renderer:Renderer,
    pub duration_seconds:f64,
    pub canvas:Canvas,
    pub delivery:DeliveryKind,
    pub scenes:Vec<Scene>,
    pub review:ReviewSpec,
}

fn validate_label(value:&str,label:&str,max:usize)->Result<(),String>{
    let trimmed=value.trim();
    if trimmed.is_empty() || trimmed.chars().count()>max || trimmed.chars().any(char::is_control) {
        return Err(format!("{label} must be non-empty, control-character free, and at most {max} characters."));
    }
    Ok(())
}

fn validate_id(value:&str,label:&str)->Result<(),String>{
    validate_label(value,label,80)?;
    if !value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'_'|'-')) {
        return Err(format!("{label} may contain only ASCII letters, numbers, underscore, or hyphen."));
    }
    Ok(())
}

fn validate_number(value:f64,label:&str,min:f64,max:f64)->Result<(),String>{
    if !value.is_finite() || value<min || value>max {
        return Err(format!("{label} must be finite and between {min} and {max}."));
    }
    Ok(())
}

impl Plan {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1 {
            return Err("Motion-graphics plan schema_version must be 1.".into());
        }
        validate_label(&self.objective,"Motion-graphics objective",MAX_OBJECTIVE_CHARS)?;
        validate_number(self.duration_seconds,"Motion-graphics duration",0.1,3_600.0)?;
        if !(16..=8192).contains(&self.canvas.width) || !(16..=8192).contains(&self.canvas.height) {
            return Err("Motion-graphics canvas width and height must each be 16..8192 pixels.".into());
        }
        validate_number(self.canvas.fps,"Motion-graphics fps",1.0,240.0)?;
        if self.delivery==DeliveryKind::TransparentOverlay && !self.canvas.transparent_background {
            return Err("Transparent overlay delivery requires transparent_background=true.".into());
        }
        if self.scenes.is_empty() || self.scenes.len()>MAX_SCENES {
            return Err(format!("Motion-graphics plan must contain 1..{MAX_SCENES} scenes."));
        }

        let mut scene_ids=HashSet::new();
        for scene in &self.scenes {
            validate_id(&scene.id,"Scene id")?;
            if !scene_ids.insert(scene.id.as_str()) {
                return Err(format!("Duplicate motion-graphics scene id: {}.",scene.id));
            }
            validate_number(scene.start_seconds,"Scene start_seconds",0.0,self.duration_seconds)?;
            validate_number(scene.duration_seconds,"Scene duration_seconds",0.001,self.duration_seconds)?;
            if scene.start_seconds+scene.duration_seconds>self.duration_seconds+0.000_001 {
                return Err(format!("Scene '{}' extends beyond the plan duration.",scene.id));
            }
            if scene.layers.is_empty() || scene.layers.len()>MAX_LAYERS_PER_SCENE {
                return Err(format!("Scene '{}' must contain 1..{MAX_LAYERS_PER_SCENE} layers.",scene.id));
            }

            let mut layer_ids=HashSet::new();
            for layer in &scene.layers {
                validate_id(&layer.id,"Layer id")?;
                validate_label(&layer.name,"Layer name",MAX_LABEL_CHARS)?;
                if !layer_ids.insert(layer.id.as_str()) {
                    return Err(format!("Duplicate layer id '{}' in scene '{}'.",layer.id,scene.id));
                }
                if let Some(text)=layer.text.as_deref() {
                    if text.chars().count()>4_000 || text.chars().any(char::is_control) {
                        return Err(format!("Layer '{}' text exceeds the bounded text contract.",layer.id));
                    }
                }
                if let Some(asset_id)=layer.asset_id.as_deref() {
                    validate_id(asset_id,"Layer asset_id")?;
                }
                match layer.kind {
                    LayerKind::Text if layer.text.as_deref().unwrap_or("").trim().is_empty() =>
                        return Err(format!("Text layer '{}' requires non-empty text.",layer.id)),
                    LayerKind::Image|LayerKind::Video if layer.asset_id.is_none() =>
                        return Err(format!("{:?} layer '{}' requires asset_id.",layer.kind,layer.id)),
                    _=>{}
                }
                if layer.tracks.len()>MAX_TRACKS_PER_LAYER {
                    return Err(format!("Layer '{}' exceeds {MAX_TRACKS_PER_LAYER} animation tracks.",layer.id));
                }

                let mut properties=HashSet::new();
                for track in &layer.tracks {
                    let property_key=format!("{:?}",track.property);
                    if !properties.insert(property_key) {
                        return Err(format!("Layer '{}' contains duplicate animation tracks for one property.",layer.id));
                    }
                    if track.keyframes.is_empty() || track.keyframes.len()>MAX_KEYFRAMES_PER_TRACK {
                        return Err(format!("Layer '{}' tracks must contain 1..{MAX_KEYFRAMES_PER_TRACK} keyframes.",layer.id));
                    }
                    let mut last_time=-1.0_f64;
                    for keyframe in &track.keyframes {
                        validate_number(keyframe.time_seconds,"Keyframe time_seconds",0.0,scene.duration_seconds)?;
                        if keyframe.time_seconds<=last_time {
                            return Err(format!("Layer '{}' keyframe times must be strictly increasing.",layer.id));
                        }
                        last_time=keyframe.time_seconds;
                        match track.property {
                            Property::Opacity=>validate_number(keyframe.value,"Opacity keyframe value",0.0,1.0)?,
                            Property::ScaleX|Property::ScaleY=>validate_number(keyframe.value,"Scale keyframe value",0.0001,100.0)?,
                            Property::X|Property::Y|Property::RotationDegrees=>
                                validate_number(keyframe.value,"Transform keyframe value",-1_000_000.0,1_000_000.0)?,
                        }
                    }
                }
            }
        }

        if self.review.sample_times_seconds.len()>MAX_REVIEW_SAMPLES {
            return Err(format!("Motion-graphics review exceeds {MAX_REVIEW_SAMPLES} sample times."));
        }
        let mut last=-1.0_f64;
        for value in &self.review.sample_times_seconds {
            validate_number(*value,"Review sample time",0.0,self.duration_seconds)?;
            if *value<=last {
                return Err("Motion-graphics review sample times must be strictly increasing.".into());
            }
            last=*value;
        }
        if self.review.criteria.len()>MAX_REVIEW_CRITERIA {
            return Err(format!("Motion-graphics review exceeds {MAX_REVIEW_CRITERIA} criteria."));
        }
        for criterion in &self.review.criteria {
            validate_label(criterion,"Review criterion",MAX_LABEL_CHARS)?;
        }
        Ok(())
    }

    pub fn summary(&self)->Result<Value,String>{
        self.validate()?;
        let layer_count=self.scenes.iter().map(|scene|scene.layers.len()).sum::<usize>();
        let track_count=self.scenes.iter().flat_map(|scene|scene.layers.iter()).map(|layer|layer.tracks.len()).sum::<usize>();
        let keyframe_count=self.scenes.iter().flat_map(|scene|scene.layers.iter())
            .flat_map(|layer|layer.tracks.iter()).map(|track|track.keyframes.len()).sum::<usize>();
        Ok(json!({
            "schema_version":1,
            "valid":true,
            "renderer":self.renderer,
            "delivery":self.delivery,
            "duration_seconds":self.duration_seconds,
            "canvas":{"width":self.canvas.width,"height":self.canvas.height,"fps":self.canvas.fps,
                "transparent_background":self.canvas.transparent_background},
            "scene_count":self.scenes.len(),
            "layer_count":layer_count,
            "animation_track_count":track_count,
            "keyframe_count":keyframe_count,
            "review_sample_count":self.review.sample_times_seconds.len(),
            "renderer_execution_performed":false,
            "preview_render_verified":false,
            "visual_review_verified":false,
            "production_ready":false
        }))
    }
}


const MAX_AE_ADAPTER_STEPS:usize=4_096;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AfterEffectsPlanRequest {
    pub project_file:String,
    pub composition_name:String,
    pub plan:Plan,
    #[serde(default)]
    pub asset_item_ids:BTreeMap<String,u32>,
}

fn verified_receipt_ref(step_id:&str,field:&str)->Value{
    json!({"$verified_receipt":{"step_id":step_id,"field":field}})
}

fn push_ae_step(steps:&mut Vec<Value>,step:Value)->Result<(),String>{
    if steps.len()>=MAX_AE_ADAPTER_STEPS {
        return Err(format!("After Effects adapter plan exceeds {MAX_AE_ADAPTER_STEPS} bounded steps."));
    }
    steps.push(step);
    Ok(())
}

fn ae_track_match_name(property:Property)->Option<&'static str>{
    match property {
        Property::Opacity=>Some("ADBE Opacity"),
        Property::RotationDegrees=>Some("ADBE Rotate Z"),
        Property::X|Property::Y|Property::ScaleX|Property::ScaleY=>None,
    }
}

fn ae_keyframe_value(property:Property,value:f64)->Value{
    match property {
        Property::Opacity=>json!(value*100.0),
        Property::RotationDegrees=>json!(value),
        _=>Value::Null,
    }
}

fn ae_interpolation(easing:Easing)->(&'static str,bool){
    match easing {
        Easing::Linear=>("linear",true),
        Easing::Hold=>("hold",true),
        Easing::EaseIn|Easing::EaseOut|Easing::EaseInOut=>("bezier",false),
    }
}

impl AfterEffectsPlanRequest {
    pub fn plan(&self)->Result<Value,String>{
        self.plan.validate()?;
        crate::after_effects::validate_project_path(&self.project_file)?;
        validate_label(&self.composition_name,"After Effects composition name",120)?;
        if self.plan.renderer==Renderer::Remotion {
            return Err("A Remotion-only motion-graphics plan cannot be routed through the After Effects adapter.".into());
        }
        for (asset_id,item_id) in &self.asset_item_ids {
            validate_id(asset_id,"After Effects asset binding id")?;
            if *item_id==0 {
                return Err(format!("After Effects asset binding '{asset_id}' must use a non-zero inspected project item ID."));
            }
        }

        let mut steps=Vec::<Value>::new();
        let mut blockers=Vec::<Value>::new();
        let mut approximate_curves=0_usize;
        let create_comp_id="create_comp";
        push_ae_step(&mut steps,json!({
            "step_id":create_comp_id,
            "host_action":"create_comp",
            "host_args":{
                "name":self.composition_name,
                "width":self.plan.canvas.width,
                "height":self.plan.canvas.height,
                "pixel_aspect":1.0,
                "duration_seconds":self.plan.duration_seconds,
                "frame_rate":self.plan.canvas.fps
            },
            "produces":{"comp_id":"result.comp_id"},
            "requires_fresh_inspection":true,
            "requires_fresh_project_revision":true,
            "requires_unique_request_id":true,
            "checkpoint_required":true,
            "automatic_execution":false
        }))?;

        for (scene_index,scene) in self.plan.scenes.iter().enumerate() {
            for (layer_index,layer) in scene.layers.iter().enumerate() {
                let prefix=format!("s{scene_index}_l{layer_index}");
                let create_id=format!("{prefix}_create");
                let comp_ref=verified_receipt_ref(create_comp_id,"comp_id");
                let (host_action,host_args)=match layer.kind {
                    LayerKind::Text=>(
                        "add_text",
                        json!({"comp_id":comp_ref,"text":layer.text.as_deref().unwrap_or(""),"name":layer.name})
                    ),
                    LayerKind::Group=>(
                        "add_null",
                        json!({"comp_id":comp_ref,"name":layer.name})
                    ),
                    LayerKind::Image|LayerKind::Video=>{
                        let asset_id=layer.asset_id.as_deref().ok_or_else(||format!("Layer '{}' lost its required asset_id.",layer.id))?;
                        let Some(item_id)=self.asset_item_ids.get(asset_id).copied() else {
                            blockers.push(json!({
                                "code":"missing_inspected_asset_item_id",
                                "scene_id":scene.id,
                                "layer_id":layer.id,
                                "asset_id":asset_id,
                                "required":"Bind asset_id to a non-zero item_id returned by fresh after_effects_run inspect_project_items."
                            }));
                            continue;
                        };
                        ("add_item_layer",json!({"comp_id":comp_ref,"item_id":item_id}))
                    },
                    LayerKind::Shape=>{
                        blockers.push(json!({
                            "code":"shape_visual_spec_missing",
                            "scene_id":scene.id,
                            "layer_id":layer.id,
                            "required":"Renderer-neutral schema currently identifies a shape layer but does not yet define rectangle/ellipse geometry, fill, stroke, or path data. No invisible empty shape is fabricated."
                        }));
                        continue;
                    }
                };

                push_ae_step(&mut steps,json!({
                    "step_id":create_id,
                    "scene_id":scene.id,
                    "layer_id":layer.id,
                    "host_action":host_action,
                    "host_args":host_args,
                    "depends_on":[create_comp_id],
                    "produces":{"layer_id":"result.layer_id"},
                    "requires_verified_dependency_receipts":true,
                    "requires_fresh_inspection":true,
                    "requires_fresh_project_revision":true,
                    "requires_unique_request_id":true,
                    "checkpoint_required":true,
                    "automatic_execution":false
                }))?;

                let layer_ref=verified_receipt_ref(&create_id,"layer_id");
                let timing_id=format!("{prefix}_timing");
                push_ae_step(&mut steps,json!({
                    "step_id":timing_id,
                    "scene_id":scene.id,
                    "layer_id":layer.id,
                    "host_action":"set_layer_timing",
                    "host_args":{
                        "comp_id":verified_receipt_ref(create_comp_id,"comp_id"),
                        "layer_id":layer_ref,
                        "in_point":scene.start_seconds,
                        "out_point":scene.start_seconds+scene.duration_seconds
                    },
                    "depends_on":[create_id],
                    "requires_verified_dependency_receipts":true,
                    "requires_fresh_inspection":true,
                    "requires_fresh_project_revision":true,
                    "requires_unique_request_id":true,
                    "checkpoint_required":true,
                    "automatic_execution":false
                }))?;

                for (track_index,track) in layer.tracks.iter().enumerate() {
                    let Some(match_name)=ae_track_match_name(track.property) else {
                        blockers.push(json!({
                            "code":"vector_transform_readback_required",
                            "scene_id":scene.id,
                            "layer_id":layer.id,
                            "property":track.property,
                            "required":"X/Y and per-axis scale tracks must first inspect the exact AE transform property dimensionality/separation and then synthesize full vector values. The adapter refuses to guess the other vector components."
                        }));
                        continue;
                    };
                    let property=json!({
                        "target":{
                            "comp_id":verified_receipt_ref(create_comp_id,"comp_id"),
                            "layer_id":verified_receipt_ref(&create_id,"layer_id")
                        },
                        "path":[
                            {"match_name":"ADBE Transform Group","property_index":null},
                            {"match_name":match_name,"property_index":null}
                        ]
                    });
                    let times=track.keyframes.iter().map(|keyframe|scene.start_seconds+keyframe.time_seconds).collect::<Vec<_>>();
                    let values=track.keyframes.iter().map(|keyframe|ae_keyframe_value(track.property,keyframe.value)).collect::<Vec<_>>();
                    let keys_id=format!("{prefix}_t{track_index}_keys");
                    push_ae_step(&mut steps,json!({
                        "step_id":keys_id,
                        "scene_id":scene.id,
                        "layer_id":layer.id,
                        "property":track.property,
                        "host_action":"set_values_at_times",
                        "host_args":{"property":property,"times":times,"values":values},
                        "depends_on":[create_id,timing_id],
                        "requires_verified_dependency_receipts":true,
                        "requires_fresh_inspection":true,
                        "requires_fresh_project_revision":true,
                        "requires_unique_request_id":true,
                        "checkpoint_required":true,
                        "automatic_execution":false
                    }))?;

                    for (key_index,keyframe) in track.keyframes.iter().enumerate() {
                        let (interpolation,exact)=ae_interpolation(keyframe.easing);
                        if !exact { approximate_curves+=1; }
                        let interpolation_id=format!("{prefix}_t{track_index}_k{key_index}_interp");
                        push_ae_step(&mut steps,json!({
                            "step_id":interpolation_id,
                            "scene_id":scene.id,
                            "layer_id":layer.id,
                            "property":track.property,
                            "keyframe_index":key_index+1,
                            "host_action":"set_keyframe_interpolation",
                            "host_args":{
                                "property":{
                                    "target":{
                                        "comp_id":verified_receipt_ref(create_comp_id,"comp_id"),
                                        "layer_id":verified_receipt_ref(&create_id,"layer_id")
                                    },
                                    "path":[
                                        {"match_name":"ADBE Transform Group","property_index":null},
                                        {"match_name":match_name,"property_index":null}
                                    ]
                                },
                                "key_index":key_index+1,
                                "in_type":interpolation,
                                "out_type":interpolation
                            },
                            "depends_on":[keys_id],
                            "curve_semantics_exact":exact,
                            "requires_temporal_ease_tuning":!exact,
                            "requires_verified_dependency_receipts":true,
                            "requires_fresh_inspection":true,
                            "requires_fresh_project_revision":true,
                            "requires_unique_request_id":true,
                            "checkpoint_required":true,
                            "automatic_execution":false
                        }))?;
                    }
                }
            }
        }

        if self.plan.delivery==DeliveryKind::TransparentOverlay {
            blockers.push(json!({
                "code":"transparent_render_output_not_planned",
                "required":"The current adapter builds composition content only. A verified alpha-capable output-module/render-queue plan must be added before transparent-overlay delivery can be claimed."
            }));
        }
        if approximate_curves>0 {
            blockers.push(json!({
                "code":"directional_easing_needs_temporal_ease_synthesis",
                "affected_keyframes":approximate_curves,
                "required":"ease_in/ease_out/ease_in_out currently map only to AE bezier interpolation type. Exact directional curve semantics require bounded set_keyframe_temporal_ease synthesis and readback."
            }));
        }

        Ok(json!({
            "schema_version":1,
            "adapter":"after_effects",
            "source_plan_valid":true,
            "renderer_request":self.plan.renderer,
            "renderer_candidate":"after_effects",
            "project_file":self.project_file,
            "composition_name":self.composition_name,
            "steps":steps,
            "blockers":blockers,
            "step_count":steps.len(),
            "blocker_count":blockers.len(),
            "dynamic_binding_contract":"Resolve every $verified_receipt reference only from the matching prior after_effects_run verified receipt; never from model text or guessed IDs.",
            "execution_contract":"Before every mutating host step, run a fresh inspect_context and use its exact saved project path and project_revision in a fresh after_effects_run request. Stop on uncertain/unverified receipts.",
            "automatic_execution":false,
            "host_mutation_performed":false,
            "renderer_runtime_verified":false,
            "preview_render_verified":false,
            "visual_review_verified":false,
            "production_ready":false
        }))
    }
}

#[cfg(test)]
mod tests{
    use super::*;

    fn valid_plan()->Plan{
        Plan{
            schema_version:1,
            objective:"Animated title overlay".into(),
            renderer:Renderer::Auto,
            duration_seconds:4.0,
            canvas:Canvas{width:1920,height:1080,fps:30.0,transparent_background:true},
            delivery:DeliveryKind::TransparentOverlay,
            scenes:vec![Scene{
                id:"intro".into(),start_seconds:0.0,duration_seconds:4.0,
                layers:vec![Layer{
                    id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),asset_id:None,
                    tracks:vec![Track{property:Property::Opacity,keyframes:vec![
                        Keyframe{time_seconds:0.0,value:0.0,easing:Easing::EaseOut},
                        Keyframe{time_seconds:0.4,value:1.0,easing:Easing::EaseOut},
                        Keyframe{time_seconds:3.6,value:1.0,easing:Easing::Linear},
                        Keyframe{time_seconds:4.0,value:0.0,easing:Easing::EaseIn},
                    ]}]
                }]
            }],
            review:ReviewSpec{sample_times_seconds:vec![0.4,2.0,3.6],criteria:vec!["Readable title".into()]},
        }
    }

    #[test]
    fn renderer_neutral_plan_validates(){
        let plan=valid_plan();
        plan.validate().unwrap();
        let summary=plan.summary().unwrap();
        assert_eq!(summary["scene_count"],1);
        assert_eq!(summary["renderer_execution_performed"],false);
        assert_eq!(summary["production_ready"],false);
    }

    #[test]
    fn overlay_requires_transparency_and_bounded_timeline(){
        let mut plan=valid_plan();
        plan.canvas.transparent_background=false;
        assert!(plan.validate().is_err());
        let mut plan=valid_plan();
        plan.scenes[0].duration_seconds=5.0;
        assert!(plan.validate().is_err());
    }

    #[test]
    fn tracks_are_ordered_and_semantically_bounded(){
        let mut plan=valid_plan();
        plan.scenes[0].layers[0].tracks[0].keyframes[1].time_seconds=0.0;
        assert!(plan.validate().is_err());
        let mut plan=valid_plan();
        plan.scenes[0].layers[0].tracks[0].keyframes[0].value=2.0;
        assert!(plan.validate().is_err());
    }

    #[test]
    fn after_effects_adapter_composes_existing_actions_without_execution(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        assert_eq!(value["adapter"],"after_effects");
        assert_eq!(value["automatic_execution"],false);
        assert_eq!(value["host_mutation_performed"],false);
        assert_eq!(value["renderer_runtime_verified"],false);
        let steps=value["steps"].as_array().unwrap();
        assert_eq!(steps[0]["host_action"],"create_comp");
        assert!(steps.iter().any(|step|step["host_action"]=="add_text"));
        assert!(steps.iter().any(|step|step["host_action"]=="set_layer_timing"));
        assert!(steps.iter().any(|step|step["host_action"]=="set_values_at_times"));
        assert!(steps.iter().any(|step|step["host_action"]=="set_keyframe_interpolation"));
        assert!(value["blockers"].as_array().unwrap().iter()
            .any(|blocker|blocker["code"]=="transparent_render_output_not_planned"));
    }

    #[test]
    fn after_effects_adapter_refuses_to_guess_vector_components_or_missing_assets(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![Track{property:Property::X,keyframes:vec![
            Keyframe{time_seconds:0.0,value:10.0,easing:Easing::Linear},
            Keyframe{time_seconds:1.0,value:20.0,easing:Easing::Linear},
        ]}];
        plan.scenes[0].layers.push(Layer{
            id:"photo".into(),kind:LayerKind::Image,name:"Photo".into(),text:None,asset_id:Some("photo_1".into()),tracks:vec![]
        });
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        let blockers=value["blockers"].as_array().unwrap();
        assert!(blockers.iter().any(|b|b["code"]=="vector_transform_readback_required"));
        assert!(blockers.iter().any(|b|b["code"]=="missing_inspected_asset_item_id"));
        assert!(!value["steps"].as_array().unwrap().iter().any(|step|
            step.get("layer_id").and_then(Value::as_str)==Some("photo") && step["host_action"]=="add_item_layer"));
    }

    #[test]
    fn after_effects_adapter_rejects_remotion_only_route(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::Remotion;
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        assert!(request.plan().unwrap_err().contains("Remotion-only"));
    }

}
