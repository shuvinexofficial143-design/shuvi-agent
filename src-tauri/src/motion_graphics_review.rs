use crate::motion_graphics::Plan;
use serde::{Deserialize,Serialize};
use std::collections::HashSet;

const MAX_REVIEW_ISSUES:usize=24;
const MAX_REVIEW_TEXT_CHARS:usize=1_200;
const MAX_REVIEW_ID_CHARS:usize=80;
const MAX_REVIEW_JSON_BYTES:usize=128*1024;
const MAX_REVIEW_ACTIVE_LAYERS:usize=512;
const MAX_MULTI_REVIEW_FRAMES:usize=8;

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Severity {
    Info,
    Minor,
    Major,
    Blocking,
}

#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Verdict {
    Pass,
    Revise,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewIssue {
    pub id:String,
    pub severity:Severity,
    pub criterion:String,
    #[serde(default)]
    pub target_layer_id:Option<String>,
    pub observation:String,
    pub suggested_correction:String,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisualReview {
    pub schema_version:u8,
    pub verdict:Verdict,
    pub issues:Vec<ReviewIssue>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MultiFrameIssue {
    pub id:String,
    pub severity:Severity,
    pub criterion:String,
    #[serde(default)]
    pub target_layer_id:Option<String>,
    pub frame_times_seconds:Vec<f64>,
    pub observation:String,
    pub suggested_correction:String,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MultiFrameReview {
    pub schema_version:u8,
    pub verdict:Verdict,
    pub issues:Vec<MultiFrameIssue>,
}

fn bounded_text(value:&str,label:&str,max:usize)->Result<(),String>{
    let trimmed=value.trim();
    if trimmed.is_empty() || trimmed.chars().count()>max || trimmed.chars().any(char::is_control) {
        return Err(format!("{label} must be non-empty, control-character free, and at most {max} characters."));
    }
    Ok(())
}

fn bounded_id(value:&str,label:&str)->Result<(),String>{
    bounded_text(value,label,MAX_REVIEW_ID_CHARS)?;
    if !value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'_'|'-')) {
        return Err(format!("{label} may contain only ASCII letters, numbers, underscore, or hyphen."));
    }
    Ok(())
}

pub fn review_prompt(plan:&Plan,sample_time_seconds:f64)->Result<String,String>{
    plan.validate()?;
    if !sample_time_seconds.is_finite() || sample_time_seconds<0.0 || sample_time_seconds>plan.duration_seconds {
        return Err("Motion preview sample time must be finite and inside the plan duration.".into());
    }
    if plan.review.criteria.is_empty() {
        return Err("Motion preview review requires at least one explicit review criterion in the plan.".into());
    }
    let criteria=serde_json::to_string(&plan.review.criteria).map_err(|e|e.to_string())?;
    let layer_ids=plan.scenes.iter()
        .filter(|scene|sample_time_seconds>=scene.start_seconds
            && sample_time_seconds<=scene.start_seconds+scene.duration_seconds+0.000_001)
        .flat_map(|scene|scene.layers.iter().map(|layer|layer.id.as_str()))
        .collect::<Vec<_>>();
    if layer_ids.len()>MAX_REVIEW_ACTIVE_LAYERS {
        return Err(format!("Motion preview review exceeds {MAX_REVIEW_ACTIVE_LAYERS} active layer IDs at one sample time."));
    }
    let layer_ids=serde_json::to_string(&layer_ids).map_err(|e|e.to_string())?;
    Ok(format!(
        "Review this single motion-graphics preview frame at sample_time_seconds={sample_time_seconds}. Objective: {}. Review criteria are exactly {criteria}. Visible/active layer IDs at this time are {layer_ids}. Return exactly one raw JSON object with no markdown, prose, tool calls, or extra keys. Schema: {{\"schema_version\":1,\"verdict\":\"pass|revise\",\"issues\":[{{\"id\":\"short_ascii_id\",\"severity\":\"info|minor|major|blocking\",\"criterion\":\"exact criterion from the supplied list\",\"target_layer_id\":\"optional exact active layer id or null\",\"observation\":\"what is visibly wrong in this frame\",\"suggested_correction\":\"bounded high-level correction, not code or a tool call\"}}]}}. If verdict is pass, issues must be empty. If verdict is revise, issues must be non-empty. Judge only what is visibly supported by this frame. Do not claim timing, motion continuity, audio, renderer identity, export correctness, or off-frame content from a single image.",
        plan.objective
    ))
}

pub fn parse_review(plan:&Plan,text:&str)->Result<VisualReview,String>{
    plan.validate()?;
    let candidate=text.trim();
    if candidate.is_empty() || candidate.len()>MAX_REVIEW_JSON_BYTES {
        return Err("Motion visual-review response is empty or exceeds the 128 KiB safety limit.".into());
    }
    if candidate.starts_with("~~~") || candidate.starts_with(char::from(96)) {
        return Err("Motion visual-review provider must return raw JSON without markdown fences.".into());
    }
    let review:VisualReview=serde_json::from_str(candidate)
        .map_err(|e|format!("Motion visual-review provider returned invalid strict JSON: {e}"))?;
    validate_review(plan,&review)?;
    Ok(review)
}

pub fn validate_review(plan:&Plan,review:&VisualReview)->Result<(),String>{
    plan.validate()?;
    if review.schema_version!=1 {
        return Err("Motion visual-review schema_version must be 1.".into());
    }
    if review.issues.len()>MAX_REVIEW_ISSUES {
        return Err(format!("Motion visual review exceeds {MAX_REVIEW_ISSUES} issues."));
    }
    match review.verdict {
        Verdict::Pass if !review.issues.is_empty() =>
            return Err("A passing motion visual review must not contain issues.".into()),
        Verdict::Revise if review.issues.is_empty() =>
            return Err("A revise motion visual review must contain at least one issue.".into()),
        _=>{}
    }

    let criteria=plan.review.criteria.iter().map(String::as_str).collect::<HashSet<_>>();
    let layer_ids=plan.scenes.iter().flat_map(|scene|scene.layers.iter())
        .map(|layer|layer.id.as_str()).collect::<HashSet<_>>();
    let mut issue_ids=HashSet::new();
    for issue in &review.issues {
        bounded_id(&issue.id,"Motion visual-review issue id")?;
        if !issue_ids.insert(issue.id.as_str()) {
            return Err(format!("Duplicate motion visual-review issue id: {}.",issue.id));
        }
        bounded_text(&issue.criterion,"Motion visual-review criterion",240)?;
        if !criteria.contains(issue.criterion.as_str()) {
            return Err(format!("Motion visual-review issue '{}' used a criterion outside the plan allowlist.",issue.id));
        }
        if let Some(layer_id)=issue.target_layer_id.as_deref() {
            bounded_id(layer_id,"Motion visual-review target layer id")?;
            if !layer_ids.contains(layer_id) {
                return Err(format!("Motion visual-review issue '{}' invented unknown layer id '{}'.",issue.id,layer_id));
            }
        }
        bounded_text(&issue.observation,"Motion visual-review observation",MAX_REVIEW_TEXT_CHARS)?;
        bounded_text(&issue.suggested_correction,"Motion visual-review suggested correction",MAX_REVIEW_TEXT_CHARS)?;
    }
    Ok(())
}

pub fn system_prompt()->&'static str{
    "You are Shuvi's visual quality reviewer for one preview image. Judge only visible evidence. Return exactly one raw JSON object matching the requested review schema. Never emit markdown, prose, code, tool calls, hidden reasoning, or claims about unseen frames."
}

fn time_in_set(value:f64,frames:&[f64])->bool{
    frames.iter().any(|candidate|(candidate-value).abs()<=1e-9_f64.max(candidate.abs().max(value.abs())*1e-9))
}

fn layer_active_at(plan:&Plan,layer_id:&str,time:f64)->bool{
    plan.scenes.iter().any(|scene|
        time>=scene.start_seconds
        &&time<=scene.start_seconds+scene.duration_seconds+0.000_001
        &&scene.layers.iter().any(|layer|layer.id==layer_id)
    )
}

pub fn multi_frame_prompt(plan:&Plan,frame_times_seconds:&[f64])->Result<String,String>{
    plan.validate()?;
    if frame_times_seconds.len()<2||frame_times_seconds.len()>MAX_MULTI_REVIEW_FRAMES{
        return Err(format!("Motion multi-frame review requires 2..={MAX_MULTI_REVIEW_FRAMES} ordered frames."));
    }
    if plan.review.criteria.is_empty(){
        return Err("Motion multi-frame review requires at least one explicit review criterion in the plan.".into());
    }
    for (index,time) in frame_times_seconds.iter().enumerate(){
        if !time.is_finite()||!time_in_set(*time,&plan.review.sample_times_seconds){
            return Err(format!("Motion multi-frame review frame {index} is not an exact approved plan review sample."));
        }
        if index>0&&*time<=frame_times_seconds[index-1]{
            return Err("Motion multi-frame review frame times must be strictly increasing.".into());
        }
    }
    let criteria=serde_json::to_string(&plan.review.criteria).map_err(|e|e.to_string())?;
    let mut frames=Vec::with_capacity(frame_times_seconds.len());
    for (index,time) in frame_times_seconds.iter().enumerate(){
        let ids=plan.scenes.iter()
            .filter(|scene|*time>=scene.start_seconds&&*time<=scene.start_seconds+scene.duration_seconds+0.000_001)
            .flat_map(|scene|scene.layers.iter().map(|layer|layer.id.as_str()))
            .collect::<Vec<_>>();
        if ids.len()>MAX_REVIEW_ACTIVE_LAYERS{
            return Err(format!("Motion multi-frame review exceeds {MAX_REVIEW_ACTIVE_LAYERS} active layer IDs at sample {index}."));
        }
        frames.push(serde_json::json!({
            "index":index,
            "sample_time_seconds":time,
            "active_layer_ids":ids
        }));
    }
    let frames=serde_json::to_string(&frames).map_err(|e|e.to_string())?;
    Ok(format!(
        "Review these ordered motion-graphics preview frames together. Objective: {}. Review criteria are exactly {criteria}. Frame context in image order is exactly {frames}. Return exactly one raw JSON object with no markdown, prose, tool calls, or extra keys. Schema: {{"schema_version":1,"verdict":"pass|revise","issues":[{{"id":"short_ascii_id","severity":"info|minor|major|blocking","criterion":"exact criterion from the supplied list","target_layer_id":"optional exact active layer id or null","frame_times_seconds":["one or more exact supplied sample times"],"observation":"visible cross-frame or frame-local issue","suggested_correction":"bounded high-level correction, not code or a tool call"}}]}}. If verdict is pass, issues must be empty. If verdict is revise, issues must be non-empty. Use the ordered samples to judge readability, composition, clipping, sampled movement, timing progression, continuity, and awkward transitions only when supported by the supplied images. Do not claim audio, renderer process provenance, export correctness, alpha correctness, or unsampled motion between these frames.",
        plan.objective
    ))
}

pub fn parse_multi_frame_review(plan:&Plan,frame_times_seconds:&[f64],text:&str)->Result<MultiFrameReview,String>{
    let candidate=text.trim();
    if candidate.is_empty()||candidate.len()>MAX_REVIEW_JSON_BYTES{
        return Err("Motion multi-frame review response is empty or exceeds the 128 KiB safety limit.".into());
    }
    if candidate.starts_with("~~~")||candidate.starts_with(char::from(96)){
        return Err("Motion multi-frame review provider must return raw JSON without markdown fences.".into());
    }
    let review:MultiFrameReview=serde_json::from_str(candidate)
        .map_err(|e|format!("Motion multi-frame review provider returned invalid strict JSON: {e}"))?;
    validate_multi_frame_review(plan,frame_times_seconds,&review)?;
    Ok(review)
}

pub fn validate_multi_frame_review(plan:&Plan,frame_times_seconds:&[f64],review:&MultiFrameReview)->Result<(),String>{
    multi_frame_prompt(plan,frame_times_seconds)?;
    if review.schema_version!=1{return Err("Motion multi-frame review schema_version must be 1.".into());}
    if review.issues.len()>MAX_REVIEW_ISSUES{
        return Err(format!("Motion multi-frame review exceeds {MAX_REVIEW_ISSUES} issues."));
    }
    match review.verdict{
        Verdict::Pass if !review.issues.is_empty()=>return Err("A passing motion multi-frame review must not contain issues.".into()),
        Verdict::Revise if review.issues.is_empty()=>return Err("A revise motion multi-frame review must contain at least one issue.".into()),
        _=>{}
    }
    let criteria=plan.review.criteria.iter().map(String::as_str).collect::<HashSet<_>>();
    let layer_ids=plan.scenes.iter().flat_map(|scene|scene.layers.iter()).map(|layer|layer.id.as_str()).collect::<HashSet<_>>();
    let mut issue_ids=HashSet::new();
    for issue in &review.issues{
        bounded_id(&issue.id,"Motion multi-frame review issue id")?;
        if !issue_ids.insert(issue.id.as_str()){
            return Err(format!("Duplicate motion multi-frame review issue id: {}.",issue.id));
        }
        bounded_text(&issue.criterion,"Motion multi-frame review criterion",240)?;
        if !criteria.contains(issue.criterion.as_str()){
            return Err(format!("Motion multi-frame review issue '{}' used a criterion outside the plan allowlist.",issue.id));
        }
        if issue.frame_times_seconds.is_empty()||issue.frame_times_seconds.len()>MAX_MULTI_REVIEW_FRAMES{
            return Err(format!("Motion multi-frame review issue '{}' has an invalid frame-time count.",issue.id));
        }
        for (index,time) in issue.frame_times_seconds.iter().enumerate(){
            if !time.is_finite()||!time_in_set(*time,frame_times_seconds){
                return Err(format!("Motion multi-frame review issue '{}' cited an unsupplied frame time.",issue.id));
            }
            if index>0&&*time<=issue.frame_times_seconds[index-1]{
                return Err(format!("Motion multi-frame review issue '{}' frame times must be strictly increasing.",issue.id));
            }
        }
        if let Some(layer_id)=issue.target_layer_id.as_deref(){
            bounded_id(layer_id,"Motion multi-frame review target layer id")?;
            if !layer_ids.contains(layer_id){
                return Err(format!("Motion multi-frame review issue '{}' invented unknown layer id '{}'.",issue.id,layer_id));
            }
            if !issue.frame_times_seconds.iter().any(|time|layer_active_at(plan,layer_id,*time)){
                return Err(format!("Motion multi-frame review issue '{}' targeted layer '{}' outside its cited active frames.",issue.id,layer_id));
            }
        }
        bounded_text(&issue.observation,"Motion multi-frame review observation",MAX_REVIEW_TEXT_CHARS)?;
        bounded_text(&issue.suggested_correction,"Motion multi-frame review suggested correction",MAX_REVIEW_TEXT_CHARS)?;
    }
    Ok(())
}

pub fn multi_frame_system_prompt()->&'static str{
    "You are Shuvi's bounded motion continuity reviewer. Compare only the supplied ordered preview images and exact sample metadata. Return exactly one raw JSON object matching the requested schema. Never emit markdown, prose, code, tool calls, hidden reasoning, or claims about unsupplied frames, audio, renderer provenance, export correctness, or alpha correctness."
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::motion_graphics::{Canvas,DeliveryKind,Easing,Keyframe,Layer,LayerKind,Property,Renderer,ReviewSpec,Scene,Track};

    fn plan()->Plan{
        Plan{
            schema_version:1,
            objective:"Readable animated title".into(),
            renderer:Renderer::AfterEffects,
            duration_seconds:3.0,
            canvas:Canvas{width:1920,height:1080,fps:30.0,transparent_background:true},
            delivery:DeliveryKind::TransparentOverlay,
            scenes:vec![Scene{id:"intro".into(),start_seconds:0.0,duration_seconds:3.0,layers:vec![
                Layer{id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),asset_id:None,shape:None,
                    tracks:vec![Track{property:Property::Opacity,keyframes:vec![
                        Keyframe{time_seconds:0.0,value:0.0,easing:Easing::EaseOut},
                        Keyframe{time_seconds:0.5,value:1.0,easing:Easing::EaseOut},
                    ]}]}
            ]}],
            review:ReviewSpec{sample_times_seconds:vec![1.0],criteria:vec!["readability".into(),"composition".into()]},
        }
    }

    #[test]
    fn review_prompt_is_single_frame_and_evidence_bounded(){
        let prompt=review_prompt(&plan(),1.0).unwrap();
        assert!(prompt.contains("Judge only what is visibly supported"));
        assert!(prompt.contains("target_layer_id"));
        assert!(prompt.contains("readability"));
    }

    #[test]
    fn strict_review_accepts_known_criterion_and_layer(){
        let raw=r#"{"schema_version":1,"verdict":"revise","issues":[{"id":"title_small","severity":"major","criterion":"readability","target_layer_id":"title","observation":"Title is too small.","suggested_correction":"Increase title size while preserving margins."}]}"#;
        let review=parse_review(&plan(),raw).unwrap();
        assert_eq!(review.verdict,Verdict::Revise);
        assert_eq!(review.issues.len(),1);
    }

    #[test]
    fn multi_frame_review_is_ordered_bounded_and_strict(){
        let mut p=plan();
        p.review.sample_times_seconds=vec![0.5,1.0,2.0];
        let times=vec![0.5,1.0,2.0];
        let prompt=multi_frame_prompt(&p,&times).unwrap();
        assert!(prompt.contains("ordered motion-graphics preview frames"));
        assert!(prompt.contains("continuity"));
        let raw=r#"{"schema_version":1,"verdict":"revise","issues":[{"id":"motion_jump","severity":"major","criterion":"composition","target_layer_id":"title","frame_times_seconds":[0.5,1.0],"observation":"Title position jumps between adjacent supplied frames.","suggested_correction":"Smooth the title movement between these sampled positions."}]}"#;
        let review=parse_multi_frame_review(&p,&times,raw).unwrap();
        assert_eq!(review.verdict,Verdict::Revise);
        assert_eq!(review.issues[0].frame_times_seconds,vec![0.5,1.0]);
        let invented=r#"{"schema_version":1,"verdict":"revise","issues":[{"id":"bad","severity":"minor","criterion":"composition","target_layer_id":"title","frame_times_seconds":[0.75],"observation":"Unsupported.","suggested_correction":"Change it."}]}"#;
        assert!(parse_multi_frame_review(&p,&times,invented).is_err());
    }

    #[test]
    fn strict_review_rejects_markdown_invented_targets_and_bad_verdict_shape(){
        let base=plan();
        assert!(parse_review(&base,"~~~json\n{}\n~~~").is_err());
        let invented=r#"{"schema_version":1,"verdict":"revise","issues":[{"id":"x","severity":"minor","criterion":"readability","target_layer_id":"invented","observation":"Visible issue.","suggested_correction":"Fix it."}]}"#;
        assert!(parse_review(&base,invented).is_err());
        let pass_with_issue=r#"{"schema_version":1,"verdict":"pass","issues":[{"id":"x","severity":"info","criterion":"readability","target_layer_id":null,"observation":"Minor issue.","suggested_correction":"Fix it."}]}"#;
        assert!(parse_review(&base,pass_with_issue).is_err());
    }
}
