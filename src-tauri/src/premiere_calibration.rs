use crate::premiere_target::PremiereExpectation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path};

const MAX_BYTES:usize=96*1024;
const MAX_ENTRIES:usize=128;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {pub kind:String,pub track:u32,pub clip_index:u32,pub component_match_name:String,
    pub param_display_name:String,pub expected:PremiereExpectation}

impl Target {
    pub fn validate(&self)->Result<(),String>{
        self.expected.validate()?;
        if !matches!(self.kind.as_str(),"video"|"audio") || self.track>128 || self.clip_index>10000
            || self.component_match_name.is_empty() || self.component_match_name.len()>240
            || self.param_display_name.is_empty() || self.param_display_name.len()>240
            || self.expected.clips.len()!=1 || self.expected.clips[0].kind!=self.kind
            || self.expected.clips[0].track!=self.track || self.expected.clips[0].clip_index!=self.clip_index {
            return Err("Calibration needs one exact inspected clip and native parameter.".into());
        }Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub premiere_version:String,pub component_match_name:String,pub param_display_name:String,
    pub value_type:String,pub semantic_role:Option<String>,pub unit:String,pub semantic_verified:bool,
    pub native_delta_verified:bool,pub recovery_verified:bool,pub keyframes_supported:bool,pub time_varying:bool,
    pub original_value:Value,pub observed_value:Option<Value>,pub project_guid:String,pub sequence_guid:String,
    pub probe_status:String,pub checkpoint:Option<String>,pub observations:Vec<String>,
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {pub schema_version:u8,pub entries:Vec<Entry>}

impl Default for Registry{fn default()->Self{Self{schema_version:1,entries:vec![]}}}
impl Registry {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1 || self.entries.len()>MAX_ENTRIES {return Err("Invalid calibration registry version or size.".into());}
        for e in &self.entries {
            if e.premiere_version.is_empty() || e.premiere_version.len()>80 || e.component_match_name.is_empty()
                || e.component_match_name.len()>240 || e.param_display_name.is_empty() || e.param_display_name.len()>240
                || !matches!(e.value_type.as_str(),"number"|"string"|"boolean") || !matches!(e.unit.as_str(),"native_unknown"|"percent"|"degrees"|"decibels"|"linear_gain")
                || e.semantic_verified && (!e.native_delta_verified || !e.recovery_verified || e.unit=="native_unknown")
                || e.semantic_role.as_ref().is_some_and(|s|s.len()>80) || e.observations.len()>8
                || e.observations.iter().any(|s|s.len()>240 || s.contains("Bearer ") || s.contains("sk-"))
                || e.project_guid.is_empty() || e.project_guid.len()>240 || e.sequence_guid.is_empty() || e.sequence_guid.len()>240
                || !matches!(e.probe_status.as_str(),"observed"|"probing"|"restoring"|"verified_native_delta"|"needs_recovery"|"uncertain")
                || e.checkpoint.as_ref().is_some_and(|s|s.len()>1024) {return Err("Invalid or unverified calibration entry.".into());}
        }
        if serde_json::to_vec(self).map_err(|e|e.to_string())?.len()>MAX_BYTES{return Err("Calibration registry exceeds 96 KiB.".into());}Ok(())
    }
    pub fn upsert(&mut self,entry:Entry)->Result<(),String>{
        if let Some(old)=self.entries.iter_mut().find(|e|e.premiere_version==entry.premiere_version
            && e.component_match_name==entry.component_match_name && e.param_display_name==entry.param_display_name
            && e.value_type==entry.value_type){
            if old.probe_status!="observed" {return Err("Existing native probe must be inspected; no blind reset.".into());}
            *old=entry;
        }else{if self.entries.len()>=MAX_ENTRIES{return Err("Calibration registry entry budget reached.".into());}
            self.entries.push(entry);}
        self.validate()
    }
    pub fn find_mut(&mut self,version:&str,target:&Target)->Result<&mut Entry,String>{
        self.entries.iter_mut().find(|e|e.premiere_version==version && e.component_match_name==target.component_match_name
            && e.param_display_name==target.param_display_name && e.project_guid==target.expected.project_guid
            && e.sequence_guid==target.expected.sequence_guid).ok_or("Observe this exact native parameter and host version before probing.".into())
    }
    pub fn annotations(&self,version:&str,settings:&Value)->Value{
        let Some(items)=settings.as_array() else{return json!([])};
        json!(items.iter().take(24).filter_map(|item|{
            let c=item.get("component_match_name").and_then(Value::as_str)?;
            let p=item.get("param_display_name").and_then(Value::as_str)?;
            let e=self.entries.iter().find(|e|e.premiere_version==version && e.component_match_name==c
                && e.param_display_name==p && e.semantic_verified && e.native_delta_verified && e.recovery_verified)?;
            Some(json!({"component_match_name":c,"param_display_name":p,"unit":e.unit,"semantic_role":e.semantic_role,
                "native_delta_verified":true,"recovery_verified":true}))
        }).collect::<Vec<_>>())
    }
}

pub fn inspected(context:&Value,native:&Value,target:&Target,semantic_role:Option<&str>)->Result<Entry,String>{
    target.validate()?;
    let version=context.get("premiereVersion").and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=80).ok_or("Host version unavailable.")?;
    if context.get("projectGuid").and_then(Value::as_str)!=Some(target.expected.project_guid.as_str())
        || context.pointer("/activeSequence/guid").and_then(Value::as_str)!=target.expected.sequence_guid.as_deref()
        || context.get("projectPath").and_then(Value::as_str)!=target.expected.project_path.as_deref()
        || native["track"]!=target.track || native["clipIndex"]!=target.clip_index
        || native["componentsTruncated"]!=false {return Err("Native calibration inspection is stale or incomplete.".into());}
    let comps=native.get("components").and_then(Value::as_array).ok_or("No native components.")?;
    if comps.iter().any(|c|c["paramsTruncated"]!=false){return Err("Incomplete native parameter chain.".into());}
    let matches=comps.iter().filter(|c|c["matchName"]==target.component_match_name).collect::<Vec<_>>();
    if matches.len()!=1{return Err("Native component ambiguous.".into());}
    let params=matches[0].get("params").and_then(Value::as_array).ok_or("Native parameters missing.")?;
    let hits=params.iter().filter(|p|p["displayName"]==target.param_display_name).collect::<Vec<_>>();
    if hits.len()!=1{return Err("Native parameter ambiguous.".into());}
    let v=&hits[0]["startValue"];
    let value_type=if v.is_number(){"number"}else if v.is_string(){"string"}else if v.is_boolean(){"boolean"}
        else{return Err("Complex or unreadable PointF/native value is unsupported for calibration.".into())};
    if semantic_role.is_some_and(|s|s.is_empty()||s.len()>80){return Err("Semantic role is too long.".into());}
    let entry=Entry{premiere_version:version.into(),component_match_name:target.component_match_name.clone(),
        param_display_name:target.param_display_name.clone(),value_type:value_type.into(),
        semantic_role:semantic_role.map(str::to_owned),unit:"native_unknown".into(),semantic_verified:false,
        native_delta_verified:false,recovery_verified:false,keyframes_supported:hits[0]["keyframesSupported"].as_bool().unwrap_or(false),
        time_varying:hits[0]["timeVarying"].as_bool().unwrap_or(true),original_value:v.clone(),observed_value:None,
        project_guid:target.expected.project_guid.clone(),sequence_guid:target.expected.sequence_guid.clone().unwrap_or_default(),
        probe_status:"observed".into(),checkpoint:None,observations:vec!["Native start value observed; semantic unit and role unverified.".into()]};
    Registry{schema_version:1,entries:vec![entry.clone()]}.validate()?;Ok(entry)
}

pub fn bounded_delta(value:&Value,delta:f64,time_varying:bool)->Result<Value,String>{
    let n=value.as_f64().filter(|n|n.is_finite()).ok_or("Only finite native numeric values can be delta probed.")?;
    if time_varying || !delta.is_finite() || delta==0.0 || delta.abs()>1.0
        || delta.abs()>n.abs().max(1.0)*0.01 || !(n+delta).is_finite(){
        return Err("Calibration delta must be static, at most one native unit and 1% of baseline.".into());
    }Ok(json!(n+delta))
}

pub fn load(path:&Path)->Result<Registry,String>{
    let read=|p:&Path|->Result<Registry,String>{let bytes=crate::read_file_bytes_bounded(p, MAX_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_BYTES{return Err("Oversized calibration registry.".into());}
        let r:Registry=serde_json::from_slice(&bytes).map_err(|_|"Corrupt calibration registry.")?;r.validate()?;Ok(r)};
    if !path.exists() && !path.with_extension("json.bak").exists(){return Ok(Registry::default());}
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){read(&path.with_extension("json.bak"))}else{Err(e)})
}
pub fn save(path:&Path,registry:&Registry)->Result<(),String>{
    registry.validate()?;let bytes=serde_json::to_vec(registry).map_err(|e|e.to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,|data|{
        let registry:Registry=serde_json::from_slice(data).map_err(|e|e.to_string())?;registry.validate()
    })
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]fn unknown_units_and_delta_bounds(){
        assert_eq!(bounded_delta(&json!(100.0),1.0,false).unwrap(),json!(101.0));
        assert!(bounded_delta(&json!(100.0),2.0,false).is_err());
        assert!(bounded_delta(&json!([1,2]),0.1,false).is_err());
        assert!(bounded_delta(&json!(1.0),0.1,true).is_err());
        assert_eq!(Registry::default().annotations("26",&json!([])),json!([]));
    }
}
