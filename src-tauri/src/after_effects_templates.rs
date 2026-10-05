//! Read-only recipes compose existing typed actions; execution keeps per-step host guards.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::BTreeMap;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step { pub action:String, pub args:Value }
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplatePlan {
    pub schema_version:u8,
    pub name:String,
    pub category:String,
    pub project_file:String,
    pub steps:Vec<Step>,
    #[serde(default)]
    pub bindings:BTreeMap<String,Value>,
}

fn bounded(value:&Value,depth:usize,nodes:&mut usize)->Result<(),String>{
    *nodes+=1;
    if depth>8||*nodes>10_000{return Err("Template exceeds nesting or node limits.".into());}
    match value {
        Value::String(s) if s.len()>4096=>return Err("Template string exceeds 4096 bytes.".into()),
        Value::Array(a)=>for v in a{bounded(v,depth+1,nodes)?;},
        Value::Object(m)=>for (k,v) in m{
            if k.len()>80{return Err("Template key exceeds 80 bytes.".into());}
            bounded(v,depth+1,nodes)?;
        },
        _=>{}
    }
    Ok(())
}
fn resolve(value:&Value,bindings:&BTreeMap<String,Value>)->Result<Value,String>{
    match value {
        Value::Object(m) if m.contains_key("$binding")=>{
            if m.len()!=1{return Err("A binding reference must contain only $binding.".into());}
            let key=m["$binding"].as_str().ok_or("Binding name must be a string.")?;
            // Bindings are inspected values, never recursively evaluated templates.
            let bound=bindings.get(key).ok_or_else(||format!("Missing explicit template binding: {key}"))?;
            if contains_binding(bound){return Err("Nested binding references are not allowed in bound values.".into());}
            Ok(bound.clone())
        },
        Value::Object(m)=>Ok(Value::Object(m.iter().map(|(k,v)|Ok((k.clone(),resolve(v,bindings)?))).collect::<Result<_,String>>()?)),
        Value::Array(a)=>Ok(Value::Array(a.iter().map(|v|resolve(v,bindings)).collect::<Result<_,_>>()?)),
        _=>Ok(value.clone())
    }
}
fn contains_binding(v:&Value)->bool{
    match v{Value::Object(m)=>m.contains_key("$binding")||m.values().any(contains_binding),Value::Array(a)=>a.iter().any(contains_binding),_=>false}
}
pub fn plan(input:&TemplatePlan)->Result<Value,String>{
    if input.schema_version!=1||input.name.is_empty()||input.name.len()>160
        ||!matches!(input.category.as_str(),"text_style"|"motion"|"effect_stack"|"transition"|"wedding_graphic"|"lower_third"|"title"|"photo_animation")
        ||input.steps.is_empty()||input.steps.len()>32||input.bindings.len()>64{
        return Err("Invalid bounded After Effects template recipe.".into());
    }
    crate::after_effects::validate_project_path(&input.project_file)?;
    let raw=serde_json::to_value(input).map_err(|e|e.to_string())?;
    if serde_json::to_vec(&raw).map_err(|e|e.to_string())?.len()>128*1024{return Err("Template exceeds 128 KiB.".into());}
    bounded(&raw,0,&mut 0)?;
    let mut steps=Vec::new();
    for (index,step) in input.steps.iter().enumerate(){
        // Recipes deliberately exclude file access, deletion, expressions, rendering and opaque presets.
        if !matches!(step.action.as_str(),"set_text_style"|"set_layer_transform"|"set_layer_timing"|"set_property"|"set_values_at_times"
            |"set_keyframe_interpolation"|"set_keyframe_temporal_ease"|"set_keyframe_temporal_flags"|"set_keyframe_spatial"
            |"add_effect"|"add_text"|"add_shape"|"add_shape_primitive"|"add_text_animator"|"add_null"|"add_solid"|"set_layer_parent"){
            return Err(format!("Action is outside the template composition scope: {}",step.action));
        }
        let args=resolve(&step.args,&input.bindings)?;
        if !args.is_object(){return Err("Template step args must be an object.".into());}
        // Reuse the typed transport envelope; this synthetic revision is validation-only and never emitted.
        let envelope=crate::after_effects_transport::Request{schema_version:1,request_id:format!("template-check-{index}"),
            action:step.action.clone(),expected_project_file:Some(input.project_file.clone()),expected_project_revision:Some(1),args:args.clone()};
        envelope.validate()?;
        steps.push(json!({"step_index":index,"host_action":step.action,"host_args":args,
            "requires_fresh_inspection":true,"requires_fresh_project_revision":true,"requires_unique_request_id":true,
            "checkpoint_required":true,"retry_safe":false}));
    }
    Ok(json!({"schema_version":1,"name":input.name,"category":input.category,"project_file":input.project_file,"steps":steps,
        "state":"planned_not_executed","source_validation":"bounded_recipe_and_transport_envelope_only",
        "host_property_validation_required":true,"semantic_result_verified":false,"runtime_verified":false,
        "automatic_execution":false,"stop_on_uncertain_step":true,
        "execution_rule":"Inspect exact targets and current project revision before each step, use after_effects_run, reconcile its receipt and readback before advancing. Bind created IDs only from verified receipts. Never replay an uncertain step."}))
}

#[cfg(test)]
mod tests{
    use super::*;
    fn input()->TemplatePlan{TemplatePlan{schema_version:1,name:"Title style".into(),category:"title".into(),
        project_file:if cfg!(windows){r"C:\Work\edit.aep".into()}else{"/tmp/edit.aep".into()},
        steps:vec![Step{action:"set_text_style".into(),args:json!({"layer_id":{"$binding":"title"},"comp_id":4,"font_size":48})}],
        bindings:BTreeMap::from([("title".into(),json!(7))])}}
    #[test]fn plan_resolves_only_explicit_bindings_and_requires_fresh_per_step_guards(){
        let result=plan(&input()).unwrap();assert_eq!(result["steps"][0]["host_args"]["layer_id"],7);
        assert_eq!(result["steps"][0]["requires_fresh_project_revision"],true);
        assert_eq!(result["steps"][0]["retry_safe"],false);assert!(result["steps"][0].get("request").is_none());
        assert_eq!(result["automatic_execution"],false);
    }
    #[test]fn missing_nested_and_unsafe_steps_fail_closed(){
        let mut x=input();x.bindings.clear();assert!(plan(&x).is_err());
        let mut x=input();x.bindings.insert("title".into(),json!({"$binding":"other"}));assert!(plan(&x).is_err());
        for action in ["render_queue","apply_preset","remove_layer","set_expression","unknown"]{
            let mut x=input();x.steps[0].action=action.into();assert!(plan(&x).is_err());
        }
    }
    #[test]fn oversized_or_invalid_recipes_are_rejected(){
        let mut x=input();x.steps=vec![x.steps[0].clone();33];assert!(plan(&x).is_err());
        let mut x=input();x.steps[0].args=json!({"text":"x".repeat(4097)});assert!(plan(&x).is_err());
        let mut x=input();x.steps[0].args=json!([]);assert!(plan(&x).is_err());
        let mut x=input();x.project_file="relative.aep".into();assert!(plan(&x).is_err());
    }
}
