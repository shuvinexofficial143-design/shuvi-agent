use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::HashSet;

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
}
