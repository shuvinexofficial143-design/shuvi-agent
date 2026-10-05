use crate::motion_graphics::{Plan,LayerKind};
use crate::motion_graphics_review::{self,VisualReview,Verdict};
use serde::{Deserialize,Serialize};

const MAX_CORRECTION_JSON_BYTES:usize=256*1024;
const MAX_CORRECTION_ITERATIONS:u8=3;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionRequest {
    pub plan:Plan,
    pub plan_snapshot:String,
    pub review:VisualReview,
    pub iteration:u8,
    pub max_iterations:u8,
}

impl CorrectionRequest {
    pub fn validate(&self)->Result<(),String>{
        self.plan.validate()?;
        motion_graphics_review::validate_review(&self.plan,&self.review)?;
        let actual=self.plan.fingerprint()?;
        if self.plan_snapshot!=actual {
            return Err("Motion correction request plan_snapshot does not match the exact supplied plan.".into());
        }
        if self.review.verdict!=Verdict::Revise {
            return Err("Motion correction proposal requires a revise visual-review verdict.".into());
        }
        if self.max_iterations==0 || self.max_iterations>MAX_CORRECTION_ITERATIONS
            || self.iteration==0 || self.iteration>self.max_iterations {
            return Err(format!("Motion correction iteration must be 1..max_iterations and max_iterations must be 1..{MAX_CORRECTION_ITERATIONS}."));
        }
        Ok(())
    }

    pub fn prompt(&self)->Result<String,String>{
        self.validate()?;
        let plan=serde_json::to_string(&self.plan).map_err(|e|e.to_string())?;
        let review=serde_json::to_string(&self.review).map_err(|e|e.to_string())?;
        Ok(format!(
            "Return exactly one raw JSON motion-graphics Plan revision for correction iteration {}/{}. No markdown, prose, code fences, tool calls, or extra wrapper object. ORIGINAL_PLAN={plan} VISUAL_REVIEW={review}. Preserve schema_version, objective, renderer, duration_seconds, canvas, delivery, scene count/order/ids/start_seconds/duration_seconds, layer count/order/ids/kind/name/text/asset_id, and the entire review specification exactly. You may change only layer animation tracks/keyframes/easing, and only when the visible review issues justify that change. Do not add/remove/reorder scenes or layers. Do not rewrite text. Do not change assets. Do not invent effects, fonts, colors, APIs, renderer code, or hidden properties. The revised plan must differ from ORIGINAL_PLAN and remain valid under the same renderer-neutral schema.",
            self.iteration,self.max_iterations
        ))
    }

    pub fn parse_revision(&self,text:&str)->Result<Plan,String>{
        self.validate()?;
        let candidate=text.trim();
        if candidate.is_empty() || candidate.len()>MAX_CORRECTION_JSON_BYTES {
            return Err("Motion correction response is empty or exceeds the 256 KiB safety limit.".into());
        }
        if candidate.starts_with("~~~") || candidate.starts_with(char::from(96)) {
            return Err("Motion correction provider must return raw JSON without markdown fences.".into());
        }
        let revised:Plan=serde_json::from_str(candidate)
            .map_err(|e|format!("Motion correction provider returned invalid strict JSON: {e}"))?;
        self.validate_revision(&revised)?;
        Ok(revised)
    }

    pub fn validate_revision(&self,revised:&Plan)->Result<(),String>{
        self.validate()?;
        revised.validate()?;
        if revised.schema_version!=self.plan.schema_version
            || revised.objective!=self.plan.objective
            || revised.renderer!=self.plan.renderer
            || (revised.duration_seconds-self.plan.duration_seconds).abs()>0.000_001
            || revised.canvas.width!=self.plan.canvas.width
            || revised.canvas.height!=self.plan.canvas.height
            || (revised.canvas.fps-self.plan.canvas.fps).abs()>0.000_001
            || revised.canvas.transparent_background!=self.plan.canvas.transparent_background
            || revised.delivery!=self.plan.delivery {
            return Err("Motion correction changed a fixed plan constraint.".into());
        }
        if revised.review.sample_times_seconds!=self.plan.review.sample_times_seconds
            || revised.review.criteria!=self.plan.review.criteria {
            return Err("Motion correction changed the review specification.".into());
        }
        if revised.scenes.len()!=self.plan.scenes.len() {
            return Err("Motion correction changed scene topology.".into());
        }
        for (before,after) in self.plan.scenes.iter().zip(&revised.scenes) {
            if before.id!=after.id
                || (before.start_seconds-after.start_seconds).abs()>0.000_001
                || (before.duration_seconds-after.duration_seconds).abs()>0.000_001
                || before.layers.len()!=after.layers.len() {
                return Err(format!("Motion correction changed scene topology for '{}'.",before.id));
            }
            for (old,new) in before.layers.iter().zip(&after.layers) {
                if old.id!=new.id || old.kind!=new.kind || old.name!=new.name
                    || old.text!=new.text || old.asset_id!=new.asset_id {
                    return Err(format!("Motion correction changed immutable layer identity/content for '{}'.",old.id));
                }
                if matches!(new.kind,LayerKind::Shape) {
                    return Err("Motion correction cannot synthesize shape appearance until geometry/style is represented in the neutral schema.".into());
                }
            }
        }
        if revised.fingerprint()?==self.plan_snapshot {
            return Err("Motion correction provider returned the unchanged plan.".into());
        }
        Ok(())
    }
}

pub fn system_prompt()->&'static str{
    "You are Shuvi's bounded motion-graphics correction planner. Return only one raw revised Plan JSON object. Preserve every immutable constraint and topology field. Modify only animation tracks justified by the supplied visible review. Never emit code, tools, renderer commands, or prose."
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::motion_graphics::{Canvas,DeliveryKind,Easing,Keyframe,Layer,Property,Renderer,ReviewSpec,Scene,Track};
    use crate::motion_graphics_review::{ReviewIssue,Severity};

    fn plan()->Plan{
        Plan{
            schema_version:1,objective:"Readable title".into(),renderer:Renderer::AfterEffects,duration_seconds:3.0,
            canvas:Canvas{width:1920,height:1080,fps:30.0,transparent_background:true},
            delivery:DeliveryKind::TransparentOverlay,
            scenes:vec![Scene{id:"intro".into(),start_seconds:0.0,duration_seconds:3.0,layers:vec![
                Layer{id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),asset_id:None,
                    tracks:vec![Track{property:Property::Opacity,keyframes:vec![
                        Keyframe{time_seconds:0.0,value:0.0,easing:Easing::EaseOut},
                        Keyframe{time_seconds:0.5,value:1.0,easing:Easing::EaseOut},
                    ]}]}
            ]}],
            review:ReviewSpec{sample_times_seconds:vec![1.0],criteria:vec!["readability".into()]},
        }
    }
    fn request()->CorrectionRequest{
        let plan=plan();
        let snapshot=plan.fingerprint().unwrap();
        CorrectionRequest{
            plan,plan_snapshot:snapshot,
            review:VisualReview{schema_version:1,verdict:Verdict::Revise,issues:vec![
                ReviewIssue{id:"title_faint".into(),severity:Severity::Major,criterion:"readability".into(),
                    target_layer_id:Some("title".into()),observation:"Title is faint.".into(),
                    suggested_correction:"Increase visible opacity sooner.".into()}
            ]},
            iteration:1,max_iterations:3,
        }
    }

    #[test]
    fn correction_requires_exact_snapshot_and_bounded_iteration(){
        let req=request();
        req.validate().unwrap();
        let mut stale=request();stale.plan_snapshot="fnv1a64:0000000000000000".into();
        assert!(stale.validate().is_err());
        let mut too_many=request();too_many.max_iterations=4;
        assert!(too_many.validate().is_err());
    }

    #[test]
    fn correction_allows_track_change_but_preserves_topology_and_text(){
        let req=request();
        let mut revised=req.plan.clone();
        revised.scenes[0].layers[0].tracks[0].keyframes[1].time_seconds=0.25;
        req.validate_revision(&revised).unwrap();
        let mut bad=revised.clone();bad.scenes[0].layers[0].text=Some("Different".into());
        assert!(req.validate_revision(&bad).is_err());
        let mut bad_scene=revised;bad_scene.scenes[0].duration_seconds=2.5;
        assert!(req.validate_revision(&bad_scene).is_err());
    }

    #[test]
    fn correction_rejects_unchanged_plan_and_markdown(){
        let req=request();
        assert!(req.validate_revision(&req.plan).is_err());
        assert!(req.parse_revision("~~~json\n{}\n~~~").is_err());
        assert!(req.prompt().unwrap().contains("You may change only layer animation tracks"));
    }
}
