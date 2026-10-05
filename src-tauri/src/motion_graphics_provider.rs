use crate::motion_graphics::{Canvas,DeliveryKind,LayerKind,Plan,Renderer};
use serde::{Deserialize,Serialize};
use serde_json::json;
use std::collections::HashSet;

const MAX_OBJECTIVE_CHARS:usize=1_500;
const MAX_LABEL_CHARS:usize=240;
const MAX_PROVIDER_ASSET_IDS:usize=128;
const MAX_REVIEW_CRITERIA:usize=24;
const MAX_PROVIDER_PLAN_BYTES:usize=256*1024;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderPlanRequest {
    pub objective:String,
    pub renderer:Renderer,
    pub duration_seconds:f64,
    pub canvas:Canvas,
    pub delivery:DeliveryKind,
    #[serde(default)]
    pub available_asset_ids:Vec<String>,
    #[serde(default)]
    pub review_criteria:Vec<String>,
}

fn bounded_label(value:&str,label:&str,max:usize)->Result<(),String>{
    let trimmed=value.trim();
    if trimmed.is_empty() || trimmed.chars().count()>max || trimmed.chars().any(char::is_control) {
        return Err(format!("{label} must be non-empty, control-character free, and at most {max} characters."));
    }
    Ok(())
}

fn bounded_id(value:&str,label:&str)->Result<(),String>{
    bounded_label(value,label,80)?;
    if !value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'_'|'-')) {
        return Err(format!("{label} may contain only ASCII letters, numbers, underscore, or hyphen."));
    }
    Ok(())
}

fn bounded_number(value:f64,label:&str,min:f64,max:f64)->Result<(),String>{
    if !value.is_finite() || value<min || value>max {
        return Err(format!("{label} must be finite and between {min} and {max}."));
    }
    Ok(())
}

impl ProviderPlanRequest {
    pub fn validate(&self)->Result<(),String>{
        bounded_label(&self.objective,"Motion-graphics planner objective",MAX_OBJECTIVE_CHARS)?;
        bounded_number(self.duration_seconds,"Motion-graphics planner duration",0.1,3_600.0)?;
        if !(16..=8192).contains(&self.canvas.width) || !(16..=8192).contains(&self.canvas.height) {
            return Err("Motion-graphics planner canvas width and height must each be 16..8192 pixels.".into());
        }
        bounded_number(self.canvas.fps,"Motion-graphics planner fps",1.0,240.0)?;
        if self.delivery==DeliveryKind::TransparentOverlay && !self.canvas.transparent_background {
            return Err("Transparent overlay planning requires transparent_background=true.".into());
        }
        if self.available_asset_ids.len()>MAX_PROVIDER_ASSET_IDS {
            return Err(format!("Motion-graphics planner exceeds {MAX_PROVIDER_ASSET_IDS} available asset IDs."));
        }
        let mut assets=HashSet::new();
        for asset in &self.available_asset_ids {
            bounded_id(asset,"Motion-graphics planner asset id")?;
            if !assets.insert(asset.as_str()) {
                return Err(format!("Duplicate motion-graphics planner asset id: {asset}."));
            }
        }
        if self.review_criteria.len()>MAX_REVIEW_CRITERIA {
            return Err(format!("Motion-graphics planner exceeds {MAX_REVIEW_CRITERIA} review criteria."));
        }
        for criterion in &self.review_criteria {
            bounded_label(criterion,"Motion-graphics planner review criterion",MAX_LABEL_CHARS)?;
        }
        Ok(())
    }

    pub fn prompt(&self)->Result<String,String>{
        self.validate()?;
        let fixed=serde_json::to_string(&json!({
            "objective":self.objective,
            "renderer":self.renderer,
            "duration_seconds":self.duration_seconds,
            "canvas":self.canvas,
            "delivery":self.delivery,
            "available_asset_ids":self.available_asset_ids,
            "required_review_criteria":self.review_criteria
        })).map_err(|e|e.to_string())?;
        Ok(format!(
            "Create exactly one renderer-neutral motion-graphics Plan JSON object. Return raw JSON only: no markdown, comments, prose, code fences, tool calls, or extra keys. Use schema_version=1 and copy objective, renderer, duration_seconds, canvas, and delivery exactly from FIXED_CONSTRAINTS. Use 1..64 scenes; each scene has id, start_seconds, duration_seconds, and 1..128 layers. Layer kind is text, shape, image, video, or group. Text layers require text. Image/video asset_id must be chosen only from available_asset_ids; if that list is empty, do not create image/video layers. Shape layers require shape={kind:'rectangle'|'ellipse',size:[width,height],position:[x,y],roundness,fill_color?,stroke_color?,stroke_width}; size must be positive, colors are RGBA arrays with each channel 0..1, at least one of fill_color/stroke_color is required, and ellipse roundness must be 0. Do not attach shape to non-shape layers. Tracks may use x, y, scale_x, scale_y, rotation_degrees, opacity. x/y are composition-space pixel coordinates; scale_x/scale_y are factors where 1.0 means 100%; opacity is 0..1; rotation_degrees is Z rotation in degrees. Keyframe time_seconds is relative to its scene and must be strictly increasing. Easing is linear, ease_in, ease_out, ease_in_out, or hold. review.sample_times_seconds must be strictly increasing within the full plan duration. review.criteria must include every required_review_criteria string exactly; you may add bounded useful criteria. Do not invent assets, renderer capabilities, fonts, effects, paths, APIs, or fields outside the schema. FIXED_CONSTRAINTS={fixed}"
        ))
    }

    pub fn validate_generated(&self,plan:&Plan)->Result<(),String>{
        self.validate()?;
        plan.validate()?;
        if plan.objective!=self.objective {
            return Err("Generated motion-graphics plan changed the fixed objective.".into());
        }
        if plan.renderer!=self.renderer {
            return Err("Generated motion-graphics plan changed the fixed renderer request.".into());
        }
        if (plan.duration_seconds-self.duration_seconds).abs()>0.000_001 {
            return Err("Generated motion-graphics plan changed the fixed duration.".into());
        }
        if plan.canvas.width!=self.canvas.width || plan.canvas.height!=self.canvas.height
            || (plan.canvas.fps-self.canvas.fps).abs()>0.000_001
            || plan.canvas.transparent_background!=self.canvas.transparent_background {
            return Err("Generated motion-graphics plan changed the fixed canvas.".into());
        }
        if plan.delivery!=self.delivery {
            return Err("Generated motion-graphics plan changed the fixed delivery mode.".into());
        }
        let available=self.available_asset_ids.iter().map(String::as_str).collect::<HashSet<_>>();
        for scene in &plan.scenes {
            for layer in &scene.layers {
                if matches!(layer.kind,LayerKind::Image|LayerKind::Video) {
                    let asset=layer.asset_id.as_deref().ok_or("Generated media layer is missing asset_id.")?;
                    if !available.contains(asset) {
                        return Err(format!("Generated motion-graphics plan invented unavailable asset_id '{asset}'."));
                    }
                }
            }
        }
        for required in &self.review_criteria {
            if !plan.review.criteria.iter().any(|criterion|criterion==required) {
                return Err(format!("Generated motion-graphics plan dropped required review criterion: {required}."));
            }
        }
        Ok(())
    }

    pub fn parse_generated(&self,text:&str)->Result<Plan,String>{
        self.validate()?;
        let candidate=text.trim();
        if candidate.is_empty() || candidate.len()>MAX_PROVIDER_PLAN_BYTES {
            return Err("Provider motion-graphics plan is empty or exceeds the 256 KiB safety limit.".into());
        }
        if candidate.starts_with("~~~") || candidate.starts_with(char::from(96)) {
            return Err("Provider motion-graphics planner must return raw JSON without markdown fences.".into());
        }
        let plan:Plan=serde_json::from_str(candidate)
            .map_err(|e|format!("Provider motion-graphics planner returned invalid strict JSON: {e}"))?;
        self.validate_generated(&plan)?;
        Ok(plan)
    }
}

pub fn system_prompt()->&'static str{
    "You are Shuvi's motion-graphics planning engine. Follow the user message as a strict data contract. Output exactly one raw JSON object matching the requested schema. Never emit markdown, prose, tool calls, or renderer code. Never change fixed constraints or invent unavailable assets."
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::motion_graphics::{Easing,Keyframe,Layer,Property,ReviewSpec,Scene,ShapeKind,ShapeSpec,Track};

    fn request()->ProviderPlanRequest{
        ProviderPlanRequest{
            objective:"Animated title".into(),
            renderer:Renderer::AfterEffects,
            duration_seconds:4.0,
            canvas:Canvas{width:1920,height:1080,fps:30.0,transparent_background:true},
            delivery:DeliveryKind::TransparentOverlay,
            available_asset_ids:vec![],
            review_criteria:vec!["Readable title".into()],
        }
    }

    fn plan()->Plan{
        Plan{
            schema_version:1,
            objective:"Animated title".into(),
            renderer:Renderer::AfterEffects,
            duration_seconds:4.0,
            canvas:Canvas{width:1920,height:1080,fps:30.0,transparent_background:true},
            delivery:DeliveryKind::TransparentOverlay,
            scenes:vec![Scene{id:"intro".into(),start_seconds:0.0,duration_seconds:4.0,layers:vec![
                Layer{id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),asset_id:None,shape:None,
                    tracks:vec![Track{property:Property::Opacity,keyframes:vec![
                        Keyframe{time_seconds:0.0,value:0.0,easing:Easing::EaseOut},
                        Keyframe{time_seconds:0.5,value:1.0,easing:Easing::EaseOut},
                    ]}]}
            ]}],
            review:ReviewSpec{sample_times_seconds:vec![0.5,2.0],criteria:vec!["Readable title".into()]},
        }
    }

    #[test]
    fn strict_provider_plan_preserves_fixed_constraints(){
        let req=request();
        let raw=serde_json::to_string(&plan()).unwrap();
        let parsed=req.parse_generated(&raw).unwrap();
        assert_eq!(parsed.objective,req.objective);
        assert_eq!(parsed.renderer,req.renderer);
        assert!(req.prompt().unwrap().contains("raw JSON only"));
    }

    #[test]
    fn provider_plan_rejects_markdown_constraint_drift_and_invented_assets(){
        let req=request();
        let raw=serde_json::to_string(&plan()).unwrap();
        assert!(req.parse_generated(&format!("~~~json\n{raw}\n~~~")).is_err());

        let mut drift=plan();drift.duration_seconds=5.0;drift.scenes[0].duration_seconds=4.0;
        assert!(req.validate_generated(&drift).is_err());

        let mut invented=plan();
        invented.scenes[0].layers.push(Layer{id:"photo".into(),kind:LayerKind::Image,name:"Photo".into(),
            text:None,asset_id:Some("not_available".into()),shape:None,tracks:vec![]});
        assert!(req.validate_generated(&invented).is_err());
    }

    #[test]
    fn provider_plan_accepts_explicit_bounded_shape_geometry(){
        let req=request();
        let mut generated=plan();
        generated.scenes[0].layers.push(Layer{
            id:"badge".into(),kind:LayerKind::Shape,name:"Badge".into(),text:None,asset_id:None,
            shape:Some(ShapeSpec{kind:ShapeKind::Rectangle,size:[480.0,120.0],position:[0.0,0.0],roundness:18.0,
                fill_color:Some([0.05,0.1,0.2,0.9]),stroke_color:None,stroke_width:1.0}),
            tracks:vec![]
        });
        assert!(req.validate_generated(&generated).is_ok());
        assert!(req.prompt().unwrap().contains("fill_color"));
    }
}
