use crate::premiere_review::{Issue, Session};
use serde_json::{json,Value};

pub fn strategy(category:&str)->(&'static str,&'static str){
    match category {
        "framing"|"motion" => ("video_components","premiere_plan_video_recipe"),
        "exposure"|"color" => ("video_components","premiere_plan_video_recipe"),
        "graphics" => ("mogrt_properties","premiere_plan_mogrt_recipe"),
        "audio_visual" => ("audio_components","premiere_plan_audio_automation"),
        "transition" => ("clip_boundaries","premiere_add_video_transition"),
        "caption" => ("caption_adapter",""),
        "continuity" => ("timeline_and_frames",""),
        _ => ("none",""),
    }
}

pub fn issue<'a>(session:&'a Session, id:&str, seconds:f64)->Result<&'a Issue,String>{
    if !matches!(session.status.as_str(),"awaiting_approval"|"reviewing") {return Err("Review session is not available for binding.".into());}
    let issue=session.reviews.last().and_then(|r|r.issues.iter().find(|i|i.id==id)).ok_or("Review issue ID not found in latest iteration.")?;
    if !seconds.is_finite() || !session.sample_times.contains(&seconds) || !issue.frame_seconds.contains(&seconds){
        return Err("Review timestamp is not grounded to this issue and session samples.".into());
    }
    Ok(issue)
}

pub fn resolve(session:&Session,issue:&Issue,seconds:f64,timeline:&Value)->Result<Value,String>{
    if timeline.get("truncated").and_then(Value::as_bool)!=Some(false)
        || timeline.pointer("/expected/project_guid").and_then(Value::as_str)!=Some(session.project_guid.as_str())
        || timeline.get("sequenceGuid").and_then(Value::as_str)!=Some(session.sequence_guid.as_str()){
        return Err("Timeline is incomplete or project/sequence identity changed.".into());
    }
    let (inspection,planner)=strategy(&issue.category);
    let kinds:&[&str]=if issue.category=="audio_visual" {&["audio"]}else{&["video"]};
    let mut candidates=vec![];
    for kind in kinds {
        let tracks=timeline.get(if *kind=="audio"{"audioTracks"}else{"videoTracks"}).and_then(Value::as_array)
            .ok_or("Timeline tracks are missing.")?;
        if tracks.len()>128{return Err("Too many tracks to resolve safely.".into());}
        for track in tracks {
            let index=track.get("index").and_then(Value::as_u64).filter(|n|*n<=128).ok_or("Invalid track index.")?;
            let items=track.get("items").and_then(Value::as_array).ok_or("Missing timeline items.")?;
            for item in items {
                let (start,end)=(item.get("startSeconds").and_then(Value::as_f64),item.get("endSeconds").and_then(Value::as_f64));
                if !matches!((start,end),(Some(a),Some(b)) if a.is_finite() && b.is_finite() && a<=seconds && seconds<b){continue;}
                let clip=item.get("clipIndex").and_then(Value::as_u64).filter(|n|*n<=10000).ok_or("Invalid clip index.")?;
                let sig=item.get("targetSignature").and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=4096)
                    .ok_or("Active clip has no reliable target signature.")?;
                if candidates.len()>=16{return Err("More than 16 overlapping clips; narrow the frame/target.".into());}
                candidates.push(json!({"kind":kind,"track":index,"clip_index":clip,"clip_name":item.get("name"),
                    "start_seconds":start,"end_seconds":end,"target_signature":sig,"layer_position":index,
                    "inspection_required":inspection}));
            }
        }
    }
    Ok(json!({"issue_id":issue.id,"category":issue.category,"frame_seconds":seconds,"candidates":candidates,
        "ambiguous":candidates.len()>1,"inspection_strategy":inspection,"planner_family":planner,
        "read_only":true,"timeline_truncated":false}))
}

pub fn bind(session:&Session,issue:&Issue,seconds:f64,timeline:&Value,kind:&str,track:u32,clip:u32,
    signature:&str,selector:Option<(&str,&str)>,inspection:&Value)->Result<Value,String>{
    if signature.is_empty() || signature.len()>4096 || track>128 || clip>10000 {return Err("Invalid exact target.".into());}
    let resolved=resolve(session,issue,seconds,timeline)?;
    let exact=resolved["candidates"].as_array().unwrap().iter().filter(|c|c["kind"]==kind
        && c["track"]==track && c["clip_index"]==clip && c["target_signature"]==signature).count();
    if exact!=1{return Err("Clip target is stale or ambiguous.".into());}
    let (_,planner)=strategy(&issue.category);
    let expected=json!({"project_guid":session.project_guid,"project_path":timeline.pointer("/expected/project_path"),
        "sequence_guid":session.sequence_guid,"clips":[{"kind":kind,"track":track,"clip_index":clip,"signature":signature}]});
    if planner.is_empty() || matches!(issue.category.as_str(),"caption"|"continuity"|"other") {
        return Ok(json!({"supported":false,"reason":"No verified native edit for this review issue.","expected":expected}));
    }
    if issue.category=="transition" {
        return Ok(json!({"supported":false,"planner":planner,"expected":expected,
            "reason":"Inspect exact boundary, transition match name, duration and position before proposing an edit."}));
    }
    if issue.category=="graphics" {
        let bound=inspection.pointer("/expected/project_guid").and_then(Value::as_str)==Some(session.project_guid.as_str())
            && inspection.pointer("/expected/sequence_guid").and_then(Value::as_str)==Some(session.sequence_guid.as_str())
            && inspection.get("expected").and_then(|v|v.get("clips")).and_then(Value::as_array)
            .is_some_and(|clips| clips.len()==1 && clips[0]["signature"]==signature);
        if !bound || inspection.get("truncated").and_then(Value::as_bool)!=Some(false) {
            return Err("Graphics property inspection is stale or incomplete.".into());
        }
        let components=inspection.get("components").and_then(Value::as_array).ok_or("Missing native graphic components.")?;
        let mut candidates=vec![];
        for component in components {
            let Some(name)=component.get("matchName").and_then(Value::as_str) else {continue};
            let Some(params)=component.get("params").and_then(Value::as_array) else {continue};
            for param in params {
                if param.get("editable").and_then(Value::as_bool)!=Some(true) {continue;}
                let Some(field)=param.get("displayName").and_then(Value::as_str) else {continue};
                if candidates.len()>=16 {return Err("More than 16 editable graphics properties; select a smaller inspected target.".into());}
                candidates.push(json!({"component_match_name":name,"param_display_name":field,
                    "current_value":param.get("value"),"value_type":param.get("type"),
                    "time_varying":param.get("timeVarying"),"keyframes_supported":param.get("keyframesSupported")}));
            }
        }
        let hits=selector.map(|(component,param)|candidates.iter().filter(|c|
            c["component_match_name"]==component && c["param_display_name"]==param).collect::<Vec<_>>()).unwrap_or_default();
        let supported=hits.len()==1;
        return Ok(json!({"supported":supported,"planner":planner,"expected":expected,
            "inspection_candidates":candidates,"binding":hits.first(),"ambiguous":hits.len()>1,
            "missing_information":if supported {"Caller-supplied semantic role and exact value for the typed MOGRT planner"}
                else {"Select one unique inspected primitive property by exact native component and parameter names"},
            "reason":"Generic native parameters do not prove MOGRT identity or semantic text roles; no edit was sent."}));
    }
    if inspection.get("componentsTruncated").and_then(Value::as_bool)!=Some(false)
        || inspection.get("track").and_then(Value::as_u64)!=Some(track as u64)
        || inspection.get("clipIndex").and_then(Value::as_u64)!=Some(clip as u64)
        || inspection.get("components").and_then(Value::as_array).is_some_and(|c|c.iter().any(|c|c["paramsTruncated"]==true)) {
        return Err("Native component inspection is incomplete or targets another clip.".into());
    }
    let components=inspection.get("components").and_then(Value::as_array).ok_or("No native components returned.")?;
    if selector.is_none() {
        let mut candidates=Vec::new();
        for component in components {
            let Some(match_name)=component.get("matchName").and_then(Value::as_str)
                .filter(|value|!value.is_empty()&&value.len()<=240) else {continue};
            let display_name=component.get("displayName").and_then(Value::as_str)
                .filter(|value|!value.is_empty()&&value.len()<=240);
            let Some(params)=component.get("params").and_then(Value::as_array) else {continue};
            for param in params {
                let Some(param_name)=param.get("displayName").and_then(Value::as_str)
                    .filter(|value|!value.is_empty()&&value.len()<=240) else {continue};
                let value=&param["startValue"];
                let value_type=if value.is_number(){"number"}else if value.is_string(){"string"}else if value.is_boolean(){"boolean"}else{continue};
                let time_varying=param.get("timeVarying").and_then(Value::as_bool).unwrap_or(true);
                let keyframes_supported=param.get("keyframesSupported").and_then(Value::as_bool).unwrap_or(false);
                if kind=="audio" && !value.is_number() {continue;}
                if candidates.len()>=32 {return Err("More than 32 primitive native parameters; select a narrower exact component first.".into());}
                candidates.push(json!({
                    "component_match_name":match_name,
                    "component_display_name":display_name,
                    "param_display_name":param_name,
                    "current_value":value,
                    "value_type":value_type,
                    "time_varying":time_varying,
                    "keyframes_supported":keyframes_supported,
                    "static_edit_candidate":!time_varying,
                    "planner_compatible":if kind=="audio"{value.is_number()}else{true}
                }));
            }
        }
        let static_count=candidates.iter().filter(|candidate|candidate["static_edit_candidate"]==true).count();
        return Ok(json!({
            "supported":false,
            "planner":planner,
            "operation_family":if kind=="audio"{"premiere_plan_audio_automation"}else{"premiere_plan_video_recipe"},
            "expected":expected,
            "inspection_candidates":candidates,
            "candidate_count":candidates.len(),
            "static_candidate_count":static_count,
            "requires_exact_selector":true,
            "reason":if candidates.is_empty(){
                "No bounded primitive native parameter is available on this exact clip; no correction was proposed."
            }else{
                "Select one exact inspected native component/parameter. Vision evidence does not choose a native parameter or correction value."
            }
        }));
    }
    let Some((component,param))=selector else {unreachable!("selector presence checked above")};
    if component.is_empty()||component.len()>240||param.is_empty()||param.len()>240{return Err("Invalid native selector.".into());}
    let matching=components.iter().filter(|c|c.get("matchName").and_then(Value::as_str)==Some(component)).collect::<Vec<_>>();
    if matching.len()!=1 {return Ok(json!({"supported":false,"planner":planner,"expected":expected,
        "reason":"Native component identity is missing or ambiguous."}));}
    let hits=matching.into_iter()
        .flat_map(|c|c.get("params").and_then(Value::as_array).into_iter().flatten())
        .filter(|p|p.get("displayName").and_then(Value::as_str)==Some(param)).collect::<Vec<_>>();
    if hits.len()!=1 {return Ok(json!({"supported":false,"planner":planner,"expected":expected,
        "reason":"Native component/parameter is missing or ambiguous; inspect and select exact identity.","match_count":hits.len().min(2)}));}
    let value=&hits[0]["startValue"];
    let primitive=value.is_boolean()||value.is_number()||value.is_string();
    let animated=hits[0]["timeVarying"].as_bool().unwrap_or(true);
    let supported=primitive && !animated;
    Ok(json!({"supported":supported,"planner":planner,"operation_family":if kind=="audio"{"premiere_plan_audio_automation"}else{"premiere_plan_video_recipe"},
        "expected":expected,"binding":{"component_match_name":component,"param_display_name":param,"current_value":value,
            "value_type":if value.is_number(){"number"}else if value.is_string(){"string"}else if value.is_boolean(){"boolean"}else{"unknown"},
            "time_varying":animated,"keyframes_supported":hits[0]["keyframesSupported"]},
        "missing_information":if supported {vec!["Exact desired primitive value for premiere_plan_review_correction"]}else{vec!["Static primitive native parameter"]},
        "next_tool":if supported {Some("premiere_plan_review_correction")}else{None},
        "reason":if supported {"Exact binding available; plan one separately approved static correction, then re-review."}else{"Animated, complex or unreadable value cannot be statically edited."}}))
}

pub fn static_correction_proposal(
    bound:&Value,
    kind:&str,
    track:u32,
    clip:u32,
    component_match_name:&str,
    param_display_name:&str,
    desired_value:&Value,
)->Result<Value,String>{
    if !matches!(kind,"video"|"audio") || track>128 || clip>10000
        || component_match_name.is_empty() || component_match_name.len()>240
        || param_display_name.is_empty() || param_display_name.len()>240 {
        return Err("Invalid static review-correction target.".into());
    }
    if bound.get("supported").and_then(Value::as_bool)!=Some(true) {
        return Err("Review correction requires one exact supported native binding.".into());
    }
    let expected=bound.get("expected").cloned().ok_or("Review correction binding has no exact expectation.")?;
    let native=bound.get("binding").ok_or("Review correction binding metadata missing.")?;
    if native.get("component_match_name").and_then(Value::as_str)!=Some(component_match_name)
        || native.get("param_display_name").and_then(Value::as_str)!=Some(param_display_name)
        || native.get("time_varying").and_then(Value::as_bool)!=Some(false) {
        return Err("Review correction binding is stale, animated, or points to another native parameter.".into());
    }
    let current=native.get("current_value").ok_or("Review correction current value missing.")?;
    let same_type=(current.is_number()&&desired_value.is_number())
        ||(current.is_string()&&desired_value.is_string())
        ||(current.is_boolean()&&desired_value.is_boolean());
    if !same_type || kind=="audio"&&!desired_value.is_number() {
        return Err("Desired correction value must match the inspected primitive native type.".into());
    }
    if desired_value.as_f64().is_some_and(|value|!value.is_finite())
        || desired_value.as_str().is_some_and(|value|value.chars().count()>2048) {
        return Err("Desired correction value exceeds bounded primitive limits.".into());
    }
    if current==desired_value {
        return Err("Desired correction value matches the current native value; no edit proposal is needed.".into());
    }
    let apply_tool=if kind=="audio"{"premiere_apply_audio_recipe"}else{"premiere_apply_video_recipe"};
    let settings=json!([{
        "component_match_name":component_match_name,
        "param_display_name":param_display_name,
        "value":desired_value
    }]);
    Ok(json!({
        "tool":apply_tool,
        "arguments":{
            "track":track,
            "clip_index":clip,
            "settings":settings,
            "expected":expected
        },
        "requires_separate_approval":true,
        "checkpoint_required":true,
        "stale_target_guarded":true,
        "runtime_verified":false
    }))
}

#[cfg(test)] mod tests {
    use super::*;
    fn fixture()->(Session,Value){
        let mut s=Session::new("id".into(),"p".into(),"s".into(),"grade".into(),"".into(),vec![2.0],4,1).unwrap();
        s.status="awaiting_approval".into();
        s.reviews.push(crate::premiere_review::Review {iteration:1,overall_confidence:0.9,stop_recommended:false,
            issues:vec![Issue{id:"i".into(),category:"color".into(),severity:"medium".into(),confidence:0.9,
                frame_seconds:vec![2.0],observation:"warm".into(),suggested_action_type:"color_recipe".into()}]});
        let item=json!({"clipIndex":0,"name":"clip","startSeconds":0.0,"endSeconds":4.0,"targetSignature":"sig"});
        (s,json!({"sequenceGuid":"s","expected":{"project_guid":"p","project_path":"C:/test.prproj"},"truncated":false,
            "videoTracks":[{"index":0,"items":[item.clone()]},{"index":1,"items":[item]}],"audioTracks":[]}))
    }
    #[test] fn grounded_overlap_and_stale_target(){let (s,t)=fixture();let i=issue(&s,"i",2.0).unwrap();
        assert!(issue(&s,"i",2.1).is_err());let r=resolve(&s,i,2.0,&t).unwrap();assert_eq!(r["candidates"].as_array().unwrap().len(),2);
        assert_eq!(r["ambiguous"],true);let mut changed=t.clone();changed["sequenceGuid"]=json!("other");assert!(resolve(&s,i,2.0,&changed).is_err());
        assert!(bind(&s,i,2.0,&t,"video",0,0,"old",None,&json!({})).is_err());}
    #[test] fn exact_primitive_requires_unique_native_binding(){let (s,t)=fixture();let i=issue(&s,"i",2.0).unwrap();
        let mut native=json!({"track":0,"clipIndex":0,"componentsTruncated":false,"components":[{"matchName":"color.native",
            "paramsTruncated":false,"params":[{"displayName":"Exposure","startValue":1.0,"timeVarying":false,"keyframesSupported":true}]}]});
        let discovery=bind(&s,i,2.0,&t,"video",0,0,"sig",None,&native).unwrap();
        assert_eq!(discovery["supported"],false);
        assert_eq!(discovery["candidate_count"],1);
        assert_eq!(discovery["inspection_candidates"][0]["param_display_name"],"Exposure");
        assert_eq!(discovery["inspection_candidates"][0]["static_edit_candidate"],true);
        let b=bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("color.native","Exposure")),&native).unwrap();assert_eq!(b["supported"],true);
        assert_eq!(b["expected"]["clips"][0]["signature"],"sig");
        native["components"][0]["params"][0]["timeVarying"]=json!(true);
        assert_eq!(bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("color.native","Exposure")),&native).unwrap()["supported"],false);
        native["components"][0]["params"][0]["timeVarying"]=json!(false);
        let duplicate=native["components"][0]["params"][0].clone();
        native["components"][0]["params"].as_array_mut().unwrap().push(duplicate);
        assert_eq!(bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("color.native","Exposure")),&native).unwrap()["supported"],false);
    }
    #[test] fn audio_discovery_filters_non_numeric_parameters(){
        let (mut s,t)=fixture();s.reviews[0].issues[0].category="audio_visual".into();
        let mut audio_t=t.clone();
        audio_t["videoTracks"]=json!([]);
        audio_t["audioTracks"]=json!([{"index":0,"items":[{"clipIndex":0,"name":"audio","startSeconds":0.0,"endSeconds":4.0,"targetSignature":"sig"}]}]);
        let i=issue(&s,"i",2.0).unwrap();
        let native=json!({"track":0,"clipIndex":0,"componentsTruncated":false,"components":[{"matchName":"audio.native",
            "paramsTruncated":false,"params":[
                {"displayName":"Level","startValue":1.0,"timeVarying":false,"keyframesSupported":true},
                {"displayName":"Mode","startValue":"auto","timeVarying":false,"keyframesSupported":false}
            ]}]});
        let discovery=bind(&s,i,2.0,&audio_t,"audio",0,0,"sig",None,&native).unwrap();
        assert_eq!(discovery["candidate_count"],1);
        assert_eq!(discovery["inspection_candidates"][0]["param_display_name"],"Level");
    }
    #[test] fn static_correction_proposal_preserves_expectation_and_type(){
        let (s,t)=fixture();let i=issue(&s,"i",2.0).unwrap();
        let native=json!({"track":0,"clipIndex":0,"componentsTruncated":false,"components":[{"matchName":"color.native",
            "paramsTruncated":false,"params":[{"displayName":"Exposure","startValue":1.0,"timeVarying":false,"keyframesSupported":true}]}]});
        let bound=bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("color.native","Exposure")),&native).unwrap();
        let proposal=static_correction_proposal(&bound,"video",0,0,"color.native","Exposure",&json!(1.2)).unwrap();
        assert_eq!(proposal["tool"],"premiere_apply_video_recipe");
        assert_eq!(proposal["arguments"]["expected"]["clips"][0]["signature"],"sig");
        assert_eq!(proposal["arguments"]["settings"][0]["value"],1.2);
        assert!(static_correction_proposal(&bound,"video",0,0,"color.native","Exposure",&json!("bad")).is_err());
        assert!(static_correction_proposal(&bound,"video",0,0,"color.native","Exposure",&json!(1.0)).is_err());
    }
    #[test] fn graphics_property_requires_native_identity_and_exact_selector(){
        let (mut s,t)=fixture();s.reviews[0].issues[0].category="graphics".into();let i=issue(&s,"i",2.0).unwrap();
        let native=json!({"expected":{"project_guid":"p","sequence_guid":"s","clips":[{"signature":"sig"}]},"truncated":false,
            "components":[{"matchName":"native.graphic","params":[{"displayName":"Text","editable":true,"value":"old",
                "type":"string","timeVarying":false,"keyframesSupported":false}]}]});
        let candidate=bind(&s,i,2.0,&t,"video",0,0,"sig",None,&native).unwrap();
        assert_eq!(candidate["supported"],false);assert_eq!(candidate["inspection_candidates"][0]["value_type"],"string");
        assert_eq!(bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("native.graphic","Text")),&native).unwrap()["supported"],true);
        let mut stale=native.clone();stale["truncated"]=json!(true);
        assert!(bind(&s,i,2.0,&t,"video",0,0,"sig",Some(("native.graphic","Text")),&stale).is_err());
    }
}
