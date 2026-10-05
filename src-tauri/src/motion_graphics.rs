use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::{BTreeMap,HashSet};
use std::path::Path;

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
pub enum ShapeKind {
    Rectangle,
    Ellipse,
}

fn default_stroke_width()->f64{1.0}

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ShapeSpec {
    pub kind:ShapeKind,
    pub size:[f64;2],
    #[serde(default)]
    pub position:[f64;2],
    #[serde(default)]
    pub roundness:f64,
    #[serde(default)]
    pub fill_color:Option<[f64;4]>,
    #[serde(default)]
    pub stroke_color:Option<[f64;4]>,
    #[serde(default="default_stroke_width")]
    pub stroke_width:f64,
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
    pub shape:Option<ShapeSpec>,
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

impl ShapeSpec {
    fn validate(&self,layer_id:&str)->Result<(),String>{
        for (axis,value) in self.size.iter().enumerate() {
            validate_number(*value,&format!("Shape layer '{layer_id}' size[{axis}]"),0.0001,1_000_000.0)?;
        }
        for (axis,value) in self.position.iter().enumerate() {
            validate_number(*value,&format!("Shape layer '{layer_id}' position[{axis}]"),-1_000_000.0,1_000_000.0)?;
        }
        validate_number(self.roundness,&format!("Shape layer '{layer_id}' roundness"),0.0,100_000.0)?;
        if self.kind==ShapeKind::Ellipse && self.roundness.abs()>0.000_001 {
            return Err(format!("Shape layer '{layer_id}' ellipse roundness must be 0 because AE ellipse primitives do not expose rectangle roundness."));
        }
        if self.fill_color.is_none() && self.stroke_color.is_none() {
            return Err(format!("Shape layer '{layer_id}' requires fill_color and/or stroke_color."));
        }
        for (label,color) in [("fill_color",self.fill_color.as_ref()),("stroke_color",self.stroke_color.as_ref())] {
            if let Some(color)=color {
                for (index,value) in color.iter().enumerate() {
                    validate_number(*value,&format!("Shape layer '{layer_id}' {label}[{index}]"),0.0,1.0)?;
                }
            }
        }
        validate_number(self.stroke_width,&format!("Shape layer '{layer_id}' stroke_width"),0.0,10_000.0)?;
        Ok(())
    }
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
                    LayerKind::Shape if layer.shape.is_none() =>
                        return Err(format!("Shape layer '{}' requires explicit shape geometry/style.",layer.id)),
                    _=>{}
                }
                if layer.kind!=LayerKind::Shape && layer.shape.is_some() {
                    return Err(format!("Non-shape layer '{}' cannot carry a shape specification.",layer.id));
                }
                if layer.kind==LayerKind::Shape && (layer.text.is_some() || layer.asset_id.is_some()) {
                    return Err(format!("Shape layer '{}' cannot carry text or asset_id.",layer.id));
                }
                if let Some(shape)=layer.shape.as_ref() {
                    shape.validate(&layer.id)?;
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

    pub fn fingerprint(&self)->Result<String,String>{
        self.validate()?;
        let bytes=serde_json::to_vec(self).map_err(|e|format!("Could not encode motion-graphics plan snapshot: {e}"))?;
        let mut hash=0xcbf29ce484222325u64;
        for byte in bytes {
            hash^=byte as u64;
            hash=hash.wrapping_mul(0x100000001b3);
        }
        Ok(format!("fnv1a64:{hash:016x}"))
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

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AfterEffectsOutputPlanRequest {
    pub project_file:String,
    pub comp_id:u32,
    pub output_file:String,
    pub output_module_template:String,
    #[serde(default)]
    pub render_settings_template:Option<String>,
    pub transparent_required:bool,
}

fn validate_ae_single_file_output(path:&str)->Result<(),String>{
    validate_label(path,"After Effects output_file",4_096)?;
    let value=Path::new(path);
    if !value.is_absolute() {
        return Err("After Effects output_file must be an absolute path.".into());
    }
    let extension=value.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(),"mov"|"mp4"|"m4v"|"m4a"|"avi"|"wav"|"png"|"jpg"|"jpeg") {
        return Err("After Effects output_file must use a single-file extension supported by the guarded render route.".into());
    }
    Ok(())
}

impl AfterEffectsOutputPlanRequest {
    pub fn plan(&self)->Result<Value,String>{
        crate::after_effects::validate_project_path(&self.project_file)?;
        if self.comp_id==0 {
            return Err("After Effects output planning requires a non-zero inspected comp_id.".into());
        }
        validate_ae_single_file_output(&self.output_file)?;
        validate_label(&self.output_module_template,"After Effects output module template",240)?;
        if let Some(template)=self.render_settings_template.as_deref() {
            validate_label(template,"After Effects render settings template",240)?;
        }

        let add_id="add_render_queue_item";
        let mut add_args=json!({
            "comp_id":self.comp_id,
            "output_module_template":self.output_module_template,
            "output_file":self.output_file
        });
        if let (Some(template),Value::Object(map))=(self.render_settings_template.as_deref(),&mut add_args) {
            map.insert("render_settings_template".into(),json!(template));
        }
        let steps=vec![
            json!({
                "step_id":add_id,
                "host_action":"add_render_queue_item",
                "host_args":add_args,
                "produces":{"queue_index":"result.queue_index"},
                "requires_fresh_inspection":true,
                "requires_fresh_project_revision":true,
                "requires_unique_request_id":true,
                "checkpoint_required":true,
                "automatic_execution":false
            }),
            json!({
                "step_id":"inspect_output_module",
                "host_action":"inspect_output_module",
                "host_args":{
                    "queue_index":verified_receipt_ref(add_id,"queue_index"),
                    "output_module_index":1
                },
                "depends_on":[add_id],
                "requires_verified_dependency_receipts":true,
                "requires_fresh_inspection":true,
                "requires_exact_project_identity":true,
                "automatic_execution":false
            })
        ];
        let mut blockers=Vec::<Value>::new();
        if self.transparent_required {
            blockers.push(json!({
                "code":"alpha_output_runtime_attestation_required",
                "required":"Execute the approved queue-setup step, then inspect the exact output module. Transparent rendering remains blocked until runtime acceptance establishes that the exact host Format/Channels/Depth evidence is alpha-capable; template names or localized display strings alone are insufficient."
            }));
        }
        Ok(json!({
            "schema_version":1,
            "adapter":"after_effects_output",
            "project_file":self.project_file,
            "comp_id":self.comp_id,
            "output_file":self.output_file,
            "transparent_required":self.transparent_required,
            "steps":steps,
            "blockers":blockers,
            "step_count":steps.len(),
            "blocker_count":blockers.len(),
            "queue_setup_planned":true,
            "output_module_inspection_planned":true,
            "render_action_planned":false,
            "host_mutation_performed":false,
            "output_module_settings_runtime_verified":false,
            "alpha_capability_verified":false,
            "render_completion_verified":false,
            "production_ready":false,
            "evidence_contract":"Only inspect_output_module host readback may ground Format/Channels/Depth evidence. The planner never infers alpha from an output-module template name."
        }))
    }
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

fn ae_track_match_name(property:Property)->&'static str{
    match property {
        Property::Opacity=>"ADBE Opacity",
        Property::RotationDegrees=>"ADBE Rotate Z",
        Property::X|Property::Y=>"ADBE Position",
        Property::ScaleX|Property::ScaleY=>"ADBE Scale",
    }
}

fn ae_component_index(property:Property)->Option<usize>{
    match property {
        Property::X|Property::ScaleX=>Some(0),
        Property::Y|Property::ScaleY=>Some(1),
        Property::RotationDegrees|Property::Opacity=>None,
    }
}

fn ae_keyframe_value(property:Property,value:f64)->Value{
    match property {
        Property::Opacity|Property::ScaleX|Property::ScaleY=>json!(value*100.0),
        Property::X|Property::Y|Property::RotationDegrees=>json!(value),
    }
}

fn ae_interpolation(easing:Easing)->(&'static str,&'static str,bool){
    match easing {
        Easing::Linear=>("linear","linear",true),
        Easing::Hold=>("hold","hold",true),
        Easing::EaseIn=>("bezier","linear",false),
        Easing::EaseOut=>("linear","bezier",false),
        Easing::EaseInOut=>("bezier","bezier",false),
    }
}

const AE_DEFAULT_EASE_SPEED:f64=0.0;
const AE_DEFAULT_EASE_INFLUENCE:f64=33.333_333;

fn ae_temporal_ease_sides(easing:Easing)->Option<(bool,bool)>{
    match easing {
        Easing::EaseIn=>Some((true,false)),
        Easing::EaseOut=>Some((false,true)),
        Easing::EaseInOut=>Some((true,true)),
        Easing::Linear|Easing::Hold=>None,
    }
}

fn ae_tracks_can_coalesce(first:&Track,second:&Track)->bool{
    first.keyframes.len()==second.keyframes.len()
        && first.keyframes.iter().zip(second.keyframes.iter()).all(|(a,b)|
            a.time_seconds.to_bits()==b.time_seconds.to_bits() && a.easing==b.easing)
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
                let mut shape_spec:Option<&ShapeSpec>=None;
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
                        shape_spec=layer.shape.as_ref();
                        ("add_shape",json!({"comp_id":comp_ref,"name":layer.name}))
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
                let mut content_ready_id=create_id.clone();
                if let Some(shape)=shape_spec {
                    let primitive_id=format!("{prefix}_shape_primitive");
                    let kind=match shape.kind {ShapeKind::Rectangle=>"rectangle",ShapeKind::Ellipse=>"ellipse"};
                    let mut primitive_args=json!({
                        "comp_id":verified_receipt_ref(create_comp_id,"comp_id"),
                        "layer_id":verified_receipt_ref(&create_id,"layer_id"),
                        "kind":kind,
                        "size":shape.size,
                        "position":shape.position,
                        "roundness":shape.roundness,
                        "stroke_width":shape.stroke_width
                    });
                    if let Value::Object(map)=&mut primitive_args {
                        if let Some(fill)=shape.fill_color {map.insert("fill_color".into(),json!(fill));}
                        if let Some(stroke)=shape.stroke_color {map.insert("stroke_color".into(),json!(stroke));}
                    }
                    push_ae_step(&mut steps,json!({
                        "step_id":primitive_id,
                        "scene_id":scene.id,
                        "layer_id":layer.id,
                        "host_action":"add_shape_primitive",
                        "host_args":primitive_args,
                        "depends_on":[create_id],
                        "requires_verified_dependency_receipts":true,
                        "requires_fresh_inspection":true,
                        "requires_fresh_project_revision":true,
                        "requires_unique_request_id":true,
                        "checkpoint_required":true,
                        "automatic_execution":false
                    }))?;
                    content_ready_id=primitive_id;
                }
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
                    "depends_on":[content_ready_id],
                    "requires_verified_dependency_receipts":true,
                    "requires_fresh_inspection":true,
                    "requires_fresh_project_revision":true,
                    "requires_unique_request_id":true,
                    "checkpoint_required":true,
                    "automatic_execution":false
                }))?;

                let mut handled_track_indices=HashSet::<usize>::new();
                for (track_index,track) in layer.tracks.iter().enumerate() {
                    if handled_track_indices.contains(&track_index) {
                        continue;
                    }

                    let paired_index=match track.property {
                        Property::X=>layer.tracks.iter().position(|candidate|candidate.property==Property::Y),
                        Property::Y=>layer.tracks.iter().position(|candidate|candidate.property==Property::X),
                        Property::ScaleX=>layer.tracks.iter().position(|candidate|candidate.property==Property::ScaleY),
                        Property::ScaleY=>layer.tracks.iter().position(|candidate|candidate.property==Property::ScaleX),
                        Property::RotationDegrees|Property::Opacity=>None,
                    };

                    if let Some(other_index)=paired_index {
                        let other=&layer.tracks[other_index];
                        handled_track_indices.insert(track_index);
                        handled_track_indices.insert(other_index);
                        let pair_label=if matches!(track.property,Property::X|Property::Y) {"position"} else {"scale"};
                        if !ae_tracks_can_coalesce(track,other) {
                            blockers.push(json!({
                                "code":"combined_vector_component_tracks_need_coalescing",
                                "scene_id":scene.id,
                                "layer_id":layer.id,
                                "property":pair_label,
                                "required":"Paired After Effects vector components can be coalesced only when both component tracks have exactly aligned keyframe times and easing. Mismatched timelines remain fail-closed."
                            }));
                            continue;
                        }

                        let match_name=ae_track_match_name(track.property);
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
                        let times=track.keyframes.iter()
                            .map(|keyframe|scene.start_seconds+keyframe.time_seconds).collect::<Vec<_>>();
                        let first_values=track.keyframes.iter()
                            .map(|keyframe|ae_keyframe_value(track.property,keyframe.value)).collect::<Vec<_>>();
                        let second_values=other.keyframes.iter()
                            .map(|keyframe|ae_keyframe_value(other.property,keyframe.value)).collect::<Vec<_>>();
                        let first_keys_id=format!("{prefix}_t{track_index}_keys");
                        let second_keys_id=format!("{prefix}_t{other_index}_keys");
                        let first_component=ae_component_index(track.property)
                            .ok_or_else(||"Internal AE pair planner lost its first component index.".to_string())?;
                        let second_component=ae_component_index(other.property)
                            .ok_or_else(||"Internal AE pair planner lost its second component index.".to_string())?;

                        push_ae_step(&mut steps,json!({
                            "step_id":first_keys_id,
                            "scene_id":scene.id,
                            "layer_id":layer.id,
                            "property":track.property,
                            "coalesced_with":other.property,
                            "host_action":"set_component_values_at_times",
                            "host_args":{
                                "property":property.clone(),
                                "times":times.clone(),
                                "values":first_values,
                                "component_index":first_component,
                                "expected_existing_key_times":[]
                            },
                            "depends_on":[create_id,timing_id],
                            "coalesced_component_pair":true,
                            "preserves_unmodified_vector_components":true,
                            "requires_unseparated_dimensions":true,
                            "requires_verified_dependency_receipts":true,
                            "requires_fresh_inspection":true,
                            "requires_fresh_project_revision":true,
                            "requires_unique_request_id":true,
                            "checkpoint_required":true,
                            "automatic_execution":false
                        }))?;
                        push_ae_step(&mut steps,json!({
                            "step_id":second_keys_id,
                            "scene_id":scene.id,
                            "layer_id":layer.id,
                            "property":other.property,
                            "coalesced_with":track.property,
                            "host_action":"set_component_values_at_times",
                            "host_args":{
                                "property":property.clone(),
                                "times":times.clone(),
                                "values":second_values,
                                "component_index":second_component,
                                "expected_existing_key_times":times
                            },
                            "depends_on":[first_keys_id],
                            "coalesced_component_pair":true,
                            "preserves_unmodified_vector_components":true,
                            "requires_unseparated_dimensions":true,
                            "requires_verified_dependency_receipts":true,
                            "requires_fresh_inspection":true,
                            "requires_fresh_project_revision":true,
                            "requires_unique_request_id":true,
                            "checkpoint_required":true,
                            "automatic_execution":false
                        }))?;

                        for (key_index,keyframe) in track.keyframes.iter().enumerate() {
                            let (in_interpolation,out_interpolation,exact)=ae_interpolation(keyframe.easing);
                            let interpolation_id=format!("{prefix}_pair_t{track_index}_{other_index}_k{key_index}_interp");
                            push_ae_step(&mut steps,json!({
                                "step_id":interpolation_id,
                                "scene_id":scene.id,
                                "layer_id":layer.id,
                                "property":pair_label,
                                "keyframe_index":key_index+1,
                                "host_action":"set_keyframe_interpolation",
                                "host_args":{
                                    "property":property.clone(),
                                    "key_index":key_index+1,
                                    "in_type":in_interpolation,
                                    "out_type":out_interpolation
                                },
                                "depends_on":[second_keys_id],
                                "coalesced_component_pair":true,
                                "curve_semantics_exact":exact,
                                "requires_temporal_ease_tuning":!exact,
                                "requires_verified_dependency_receipts":true,
                                "requires_fresh_inspection":true,
                                "requires_fresh_project_revision":true,
                                "requires_unique_request_id":true,
                                "checkpoint_required":true,
                                "automatic_execution":false
                            }))?;
                            if let Some((apply_in,apply_out))=ae_temporal_ease_sides(keyframe.easing) {
                                let temporal_id=format!("{prefix}_pair_t{track_index}_{other_index}_k{key_index}_ease");
                                push_ae_step(&mut steps,json!({
                                    "step_id":temporal_id,
                                    "scene_id":scene.id,
                                    "layer_id":layer.id,
                                    "property":pair_label,
                                    "keyframe_index":key_index+1,
                                    "host_action":"set_keyframe_temporal_ease_uniform",
                                    "host_args":{
                                        "property":property.clone(),
                                        "key_index":key_index+1,
                                        "expected_time_seconds":scene.start_seconds+keyframe.time_seconds,
                                        "apply_in":apply_in,
                                        "apply_out":apply_out,
                                        "speed":AE_DEFAULT_EASE_SPEED,
                                        "influence":AE_DEFAULT_EASE_INFLUENCE
                                    },
                                    "depends_on":[interpolation_id],
                                    "coalesced_component_pair":true,
                                    "curve_semantics_exact":true,
                                    "temporal_ease_contract":"zero_speed_33_333333_influence",
                                    "host_dimension_count_inferred":false,
                                    "requires_verified_dependency_receipts":true,
                                    "requires_fresh_inspection":true,
                                    "requires_fresh_project_revision":true,
                                    "requires_unique_request_id":true,
                                    "checkpoint_required":true,
                                    "automatic_execution":false
                                }))?;
                            }
                        }
                        continue;
                    }

                    handled_track_indices.insert(track_index);
                    let component_index=ae_component_index(track.property);
                    let match_name=ae_track_match_name(track.property);
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
                    let (key_action,key_args)=if let Some(component_index)=component_index {
                        ("set_component_values_at_times",json!({
                            "property":property,
                            "times":times,
                            "values":values,
                            "component_index":component_index,
                            "expected_existing_key_times":[]
                        }))
                    } else {
                        ("set_values_at_times",json!({"property":property,"times":times,"values":values}))
                    };
                    push_ae_step(&mut steps,json!({
                        "step_id":keys_id,
                        "scene_id":scene.id,
                        "layer_id":layer.id,
                        "property":track.property,
                        "host_action":key_action,
                        "host_args":key_args,
                        "depends_on":[create_id,timing_id],
                        "preserves_unmodified_vector_components":component_index.is_some(),
                        "requires_unseparated_dimensions":component_index.is_some(),
                        "requires_verified_dependency_receipts":true,
                        "requires_fresh_inspection":true,
                        "requires_fresh_project_revision":true,
                        "requires_unique_request_id":true,
                        "checkpoint_required":true,
                        "automatic_execution":false
                    }))?;

                    for (key_index,keyframe) in track.keyframes.iter().enumerate() {
                        let (in_interpolation,out_interpolation,exact)=ae_interpolation(keyframe.easing);
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
                                "in_type":in_interpolation,
                                "out_type":out_interpolation
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
                        if let Some((apply_in,apply_out))=ae_temporal_ease_sides(keyframe.easing) {
                            let temporal_id=format!("{prefix}_t{track_index}_k{key_index}_ease");
                            let temporal_property=json!({
                                "target":{
                                    "comp_id":verified_receipt_ref(create_comp_id,"comp_id"),
                                    "layer_id":verified_receipt_ref(&create_id,"layer_id")
                                },
                                "path":[
                                    {"match_name":"ADBE Transform Group","property_index":null},
                                    {"match_name":match_name,"property_index":null}
                                ]
                            });
                            push_ae_step(&mut steps,json!({
                                "step_id":temporal_id,
                                "scene_id":scene.id,
                                "layer_id":layer.id,
                                "property":track.property,
                                "keyframe_index":key_index+1,
                                "host_action":"set_keyframe_temporal_ease_uniform",
                                "host_args":{
                                    "property":temporal_property,
                                    "key_index":key_index+1,
                                    "expected_time_seconds":scene.start_seconds+keyframe.time_seconds,
                                    "apply_in":apply_in,
                                    "apply_out":apply_out,
                                    "speed":AE_DEFAULT_EASE_SPEED,
                                    "influence":AE_DEFAULT_EASE_INFLUENCE
                                },
                                "depends_on":[interpolation_id],
                                "curve_semantics_exact":true,
                                "temporal_ease_contract":"zero_speed_33_333333_influence",
                                "host_dimension_count_inferred":false,
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
        }

        if self.plan.delivery==DeliveryKind::TransparentOverlay {
            blockers.push(json!({
                "code":"transparent_render_output_not_planned",
                "required":"The current adapter builds composition content only. A verified alpha-capable output-module/render-queue plan must be added before transparent-overlay delivery can be claimed."
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
                    id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),asset_id:None,shape:None,
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
    fn plan_snapshot_changes_when_validated_plan_changes(){
        let plan=valid_plan();
        let first=plan.fingerprint().unwrap();
        assert_eq!(first.len(),24);
        assert!(first.starts_with("fnv1a64:"));
        let mut changed=valid_plan();
        changed.scenes[0].layers[0].tracks[0].keyframes[1].value=0.75;
        let second=changed.fingerprint().unwrap();
        assert_ne!(first,second);
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
    fn after_effects_adapter_uses_component_readback_write_and_blocks_missing_assets(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![Track{property:Property::X,keyframes:vec![
            Keyframe{time_seconds:0.0,value:10.0,easing:Easing::Linear},
            Keyframe{time_seconds:1.0,value:20.0,easing:Easing::Linear},
        ]}];
        plan.scenes[0].layers.push(Layer{
            id:"photo".into(),kind:LayerKind::Image,name:"Photo".into(),text:None,asset_id:Some("photo_1".into()),shape:None,tracks:vec![]
        });
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        let blockers=value["blockers"].as_array().unwrap();
        assert!(blockers.iter().any(|b|b["code"]=="missing_inspected_asset_item_id"));
        let component=value["steps"].as_array().unwrap().iter()
            .find(|step|step["host_action"]=="set_component_values_at_times").unwrap();
        assert_eq!(component["host_args"]["component_index"],0);
        assert_eq!(component["host_args"]["expected_existing_key_times"],json!([]));
        assert_eq!(component["host_args"]["values"],json!([10.0,20.0]));
        assert_eq!(component["preserves_unmodified_vector_components"],true);
        assert!(!value["steps"].as_array().unwrap().iter().any(|step|
            step.get("layer_id").and_then(Value::as_str)==Some("photo") && step["host_action"]=="add_item_layer"));
    }

    #[test]
    fn after_effects_adapter_maps_directional_easing_to_the_correct_keyframe_side(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![Track{property:Property::Opacity,keyframes:vec![
            Keyframe{time_seconds:0.0,value:0.0,easing:Easing::EaseOut},
            Keyframe{time_seconds:1.0,value:1.0,easing:Easing::EaseIn},
            Keyframe{time_seconds:2.0,value:0.5,easing:Easing::EaseInOut},
        ]}];
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        let interpolation_steps=value["steps"].as_array().unwrap().iter()
            .filter(|step|step["host_action"]=="set_keyframe_interpolation").collect::<Vec<_>>();
        assert_eq!(interpolation_steps.len(),3);
        assert_eq!(interpolation_steps[0]["host_args"]["in_type"],"linear");
        assert_eq!(interpolation_steps[0]["host_args"]["out_type"],"bezier");
        assert_eq!(interpolation_steps[1]["host_args"]["in_type"],"bezier");
        assert_eq!(interpolation_steps[1]["host_args"]["out_type"],"linear");
        assert_eq!(interpolation_steps[2]["host_args"]["in_type"],"bezier");
        assert_eq!(interpolation_steps[2]["host_args"]["out_type"],"bezier");
        assert!(!value["blockers"].as_array().unwrap().iter()
            .any(|b|b["code"]=="directional_easing_needs_temporal_ease_synthesis"));
        let temporal_steps=value["steps"].as_array().unwrap().iter()
            .filter(|step|step["host_action"]=="set_keyframe_temporal_ease_uniform").collect::<Vec<_>>();
        assert_eq!(temporal_steps.len(),3);
        assert_eq!(temporal_steps[0]["host_args"]["apply_in"],false);
        assert_eq!(temporal_steps[0]["host_args"]["apply_out"],true);
        assert_eq!(temporal_steps[1]["host_args"]["apply_in"],true);
        assert_eq!(temporal_steps[1]["host_args"]["apply_out"],false);
        assert_eq!(temporal_steps[2]["host_args"]["apply_in"],true);
        assert_eq!(temporal_steps[2]["host_args"]["apply_out"],true);
        assert_eq!(temporal_steps[0]["host_args"]["speed"],0.0);
        assert_eq!(temporal_steps[0]["host_args"]["influence"],33.333_333);
        assert!(temporal_steps.iter().all(|step|step["host_dimension_count_inferred"]==false));
        assert!(temporal_steps.iter().all(|step|step["host_args"].get("in_ease").is_none()));
    }

    #[test]
    fn after_effects_adapter_coalesces_aligned_component_timelines(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![
            Track{property:Property::X,keyframes:vec![
                Keyframe{time_seconds:0.0,value:10.0,easing:Easing::Linear},
                Keyframe{time_seconds:1.0,value:20.0,easing:Easing::Linear},
            ]},
            Track{property:Property::Y,keyframes:vec![
                Keyframe{time_seconds:0.0,value:30.0,easing:Easing::Linear},
                Keyframe{time_seconds:1.0,value:40.0,easing:Easing::Linear},
            ]}
        ];
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        assert!(!value["blockers"].as_array().unwrap().iter()
            .any(|b|b["code"]=="combined_vector_component_tracks_need_coalescing" && b["property"]=="position"));
        let component_steps=value["steps"].as_array().unwrap().iter()
            .filter(|step|step["host_action"]=="set_component_values_at_times").collect::<Vec<_>>();
        assert_eq!(component_steps.len(),2);
        assert_eq!(component_steps[0]["coalesced_component_pair"],true);
        assert_eq!(component_steps[0]["host_args"]["expected_existing_key_times"],json!([]));
        assert_eq!(component_steps[1]["host_args"]["expected_existing_key_times"],json!([0.0,1.0]));
        assert_eq!(component_steps[1]["depends_on"],json!([component_steps[0]["step_id"].as_str().unwrap()]));
        assert_eq!(value["steps"].as_array().unwrap().iter()
            .filter(|step|step["host_action"]=="set_keyframe_interpolation" && step["coalesced_component_pair"]==true).count(),2);
    }

    #[test]
    fn after_effects_adapter_blocks_misaligned_component_timelines(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![
            Track{property:Property::X,keyframes:vec![
                Keyframe{time_seconds:0.0,value:10.0,easing:Easing::Linear},
                Keyframe{time_seconds:1.0,value:20.0,easing:Easing::Linear},
            ]},
            Track{property:Property::Y,keyframes:vec![
                Keyframe{time_seconds:0.0,value:30.0,easing:Easing::Linear},
                Keyframe{time_seconds:1.5,value:40.0,easing:Easing::Linear},
            ]}
        ];
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        assert!(value["blockers"].as_array().unwrap().iter()
            .any(|b|b["code"]=="combined_vector_component_tracks_need_coalescing" && b["property"]=="position"));
        assert!(!value["steps"].as_array().unwrap().iter()
            .any(|step|step["host_action"]=="set_component_values_at_times"));
    }

    #[test]
    fn after_effects_scale_component_converts_factor_to_percent(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers[0].tracks=vec![Track{property:Property::ScaleX,keyframes:vec![
            Keyframe{time_seconds:0.0,value:0.5,easing:Easing::Linear},
            Keyframe{time_seconds:1.0,value:1.25,easing:Easing::Linear},
        ]}];
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        let component=value["steps"].as_array().unwrap().iter()
            .find(|step|step["host_action"]=="set_component_values_at_times").unwrap();
        assert_eq!(component["host_args"]["component_index"],0);
        assert_eq!(component["host_args"]["values"],json!([50.0,125.0]));
    }

    #[test]
    fn shape_schema_maps_to_existing_ae_shape_primitives(){
        let mut plan=valid_plan();
        plan.renderer=Renderer::AfterEffects;
        plan.delivery=DeliveryKind::StandaloneVideo;
        plan.canvas.transparent_background=false;
        plan.scenes[0].layers.push(Layer{
            id:"badge".into(),kind:LayerKind::Shape,name:"Badge".into(),text:None,asset_id:None,
            shape:Some(ShapeSpec{kind:ShapeKind::Rectangle,size:[640.0,160.0],position:[0.0,0.0],roundness:24.0,
                fill_color:Some([0.1,0.2,0.3,1.0]),stroke_color:Some([1.0,1.0,1.0,1.0]),stroke_width:4.0}),
            tracks:vec![]
        });
        let request=AfterEffectsPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            composition_name:"Shuvi Motion".into(),
            plan,
            asset_item_ids:BTreeMap::new(),
        };
        let value=request.plan().unwrap();
        let steps=value["steps"].as_array().unwrap();
        assert!(steps.iter().any(|step|step.get("layer_id").and_then(Value::as_str)==Some("badge") && step["host_action"]=="add_shape"));
        let primitive=steps.iter().find(|step|step.get("layer_id").and_then(Value::as_str)==Some("badge") && step["host_action"]=="add_shape_primitive").unwrap();
        assert_eq!(primitive["host_args"]["kind"],"rectangle");
        assert_eq!(primitive["host_args"]["size"],json!([640.0,160.0]));
        assert_eq!(primitive["host_args"]["fill_color"],json!([0.1,0.2,0.3,1.0]));
        assert!(!value["blockers"].as_array().unwrap().iter().any(|blocker|blocker["code"]=="shape_visual_spec_missing"));
    }

    #[test]
    fn shape_schema_rejects_invisible_or_invalid_geometry(){
        let mut plan=valid_plan();
        plan.scenes[0].layers.push(Layer{
            id:"bad_shape".into(),kind:LayerKind::Shape,name:"Bad shape".into(),text:None,asset_id:None,
            shape:Some(ShapeSpec{kind:ShapeKind::Ellipse,size:[100.0,100.0],position:[0.0,0.0],roundness:10.0,
                fill_color:None,stroke_color:None,stroke_width:1.0}),
            tracks:vec![]
        });
        assert!(plan.validate().is_err());
    }

    #[test]
    fn after_effects_output_planner_stages_queue_inspection_without_render_or_alpha_claim(){
        let request=AfterEffectsOutputPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            comp_id:42,
            output_file:if cfg!(windows){r"C:\Work\motion-alpha.mov".into()}else{"/tmp/motion-alpha.mov".into()},
            output_module_template:"Caller Selected Template".into(),
            render_settings_template:Some("Best Settings".into()),
            transparent_required:true,
        };
        let value=request.plan().unwrap();
        assert_eq!(value["adapter"],"after_effects_output");
        assert_eq!(value["render_action_planned"],false);
        assert_eq!(value["alpha_capability_verified"],false);
        assert_eq!(value["host_mutation_performed"],false);
        let steps=value["steps"].as_array().unwrap();
        assert_eq!(steps.len(),2);
        assert_eq!(steps[0]["host_action"],"add_render_queue_item");
        assert_eq!(steps[1]["host_action"],"inspect_output_module");
        assert_eq!(steps[1]["host_args"]["queue_index"],verified_receipt_ref("add_render_queue_item","queue_index"));
        assert!(value["blockers"].as_array().unwrap().iter()
            .any(|b|b["code"]=="alpha_output_runtime_attestation_required"));
    }

    #[test]
    fn after_effects_output_planner_rejects_relative_or_unsupported_output(){
        let mut request=AfterEffectsOutputPlanRequest{
            project_file:if cfg!(windows){r"C:\Work\motion.aep".into()}else{"/tmp/motion.aep".into()},
            comp_id:42,
            output_file:"relative.mov".into(),
            output_module_template:"Template".into(),
            render_settings_template:None,
            transparent_required:false,
        };
        assert!(request.plan().unwrap_err().contains("absolute"));
        request.output_file=if cfg!(windows){r"C:\Work\motion.gif".into()}else{"/tmp/motion.gif".into()};
        assert!(request.plan().unwrap_err().contains("single-file extension"));
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
