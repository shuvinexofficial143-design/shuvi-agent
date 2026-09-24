use crate::premiere_target::PremiereExpectation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};

const MAX_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fixture {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub start_seconds: Option<f64>,
    pub end_seconds: Option<f64>,
    pub delta_seconds: Option<f64>,
    pub expected: PremiereExpectation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub schema_version: u8,
    pub action_id: String,
    pub group: u8,
    pub step: String,
    pub fixture: Fixture,
    pub premiere_version: String,
    pub project_path: String,
    pub before: Value,
    pub status: String,
    pub checkpoint: Option<String>,
    pub after: Option<Value>,
    pub recovery: Option<String>,
    pub cancellation_requested: bool,
    pub created_at_ms: u64,
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

impl Action {
    pub fn new(id: String, step: String, fixture: Fixture, context: &Value, timeline: &Value) -> Result<Self,String> {
        if !matches!(step.as_str(),"trim"|"move"|"clone") {return Err("Acceptance action is unsupported; no arbitrary bridge action.".into());}
        fixture.expected.validate()?;
        if fixture.expected.clips.len()!=1 || fixture.kind!=fixture.expected.clips[0].kind
            || fixture.track!=fixture.expected.clips[0].track || fixture.clip_index!=fixture.expected.clips[0].clip_index
            || fixture.expected.project_path.as_deref()!=context.get("projectPath").and_then(Value::as_str)
            || fixture.expected.project_guid!=context.get("projectGuid").and_then(Value::as_str).unwrap_or("")
            || fixture.expected.sequence_guid.as_deref()!=context.pointer("/activeSequence/guid").and_then(Value::as_str)
            || !matches!(fixture.kind.as_str(),"video"|"audio") || fixture.track>128 || fixture.clip_index>10000 {
            return Err("Acceptance fixture does not bind one exact live clip and project path.".into());
        }
        let before=exact_clip(timeline,&fixture)?;
        let (start,end)=(before["startSeconds"].as_f64().ok_or("Clip start missing.")?,
            before["endSeconds"].as_f64().ok_or("Clip end missing.")?);
        if !start.is_finite() || !end.is_finite() || start>=end {return Err("Invalid native clip timing.".into())}
        match step.as_str() {
            "trim" => {
                if fixture.delta_seconds.is_some() || fixture.start_seconds.is_none() && fixture.end_seconds.is_none()
                    || fixture.start_seconds.unwrap_or(start)>=fixture.end_seconds.unwrap_or(end)
                    || fixture.start_seconds.is_some_and(|n|!n.is_finite() || n<0.0 || n>=end || (n-start).abs()>3.0)
                    || fixture.end_seconds.is_some_and(|n|!n.is_finite() || n<=start || n>86400.0 || (n-end).abs()>3.0) {
                    return Err("Acceptance trim must be a bounded meaningful small change.".into());
                }
            },
            "move"|"clone" => {
                if fixture.start_seconds.is_some() || fixture.end_seconds.is_some()
                    || !fixture.delta_seconds.is_some_and(|n|n.is_finite() && n!=0.0 && n.abs()<=3.0 && start+n>=0.0 && end+n<=86400.0) {
                    return Err("Acceptance move/clone requires a bounded offset of at most three seconds.".into());
                }
            }, _=> unreachable!()
        }
        let project_path=context.get("projectPath").and_then(Value::as_str).unwrap_or("");
        let version=context.get("premiereVersion").and_then(Value::as_str).unwrap_or("");
        if id.len()>80 || id.is_empty() || project_path.len()>1024 || project_path.is_empty() || version.len()>80 || version.is_empty() {
            return Err("Host identity and Premiere version must be bounded and available.".into());
        }
        let record=Self{schema_version:1,action_id:id,group:2,step,fixture,premiere_version:version.into(),
            project_path:project_path.into(),before,status:"prepared".into(),checkpoint:None,after:None,
            recovery:None,cancellation_requested:false,created_at_ms:now()};
        record.validate()?;Ok(record)
    }
    pub fn validate(&self)->Result<(),String>{
        self.fixture.expected.validate()?;
        if self.schema_version!=1 || self.group!=2 || !matches!(self.step.as_str(),"trim"|"move"|"clone")
            || !matches!(self.status.as_str(),"prepared"|"executing"|"verified"|"uncertain"|"failed"|"cancelled")
            || self.action_id.is_empty() || self.action_id.len()>80 || self.project_path.is_empty() || self.project_path.len()>1024
            || self.premiere_version.is_empty() || self.premiere_version.len()>80
            || self.checkpoint.as_ref().is_some_and(|s|s.len()>1024)
            || self.recovery.as_ref().is_some_and(|s|s.len()>300)
            || serde_json::to_vec(self).map_err(|e|e.to_string())?.len()>MAX_BYTES {
            return Err("Invalid or oversized Premiere acceptance action.".into());
        }Ok(())
    }
    pub fn identity(&self, context:&Value)->Result<(),String>{
        if context.get("projectGuid").and_then(Value::as_str)!=Some(self.fixture.expected.project_guid.as_str())
            || context.get("projectPath").and_then(Value::as_str)!=Some(self.project_path.as_str())
            || context.pointer("/activeSequence/guid").and_then(Value::as_str)!=self.fixture.expected.sequence_guid.as_deref()
            || context.get("premiereVersion").and_then(Value::as_str)!=Some(self.premiere_version.as_str()) {
            return Err("Acceptance host snapshot stale; no edit launched.".into());
        } Ok(())
    }
    pub fn finish(&mut self,after:&Value, native_accepted:bool)->Result<bool,String>{
        if self.status!="executing" {return Err("Acceptance action cannot be completed twice.".into());}
        let verified=native_accepted && verify(&self.step,&self.fixture,&self.before,after);
        self.after=Some(summary(after,&self.fixture)?);
        self.status=if verified {"verified"} else {"uncertain"}.into();
        self.recovery=Some("A .prproj checkpoint is retained; no rollback or cleanup was performed. Inspect before explicit recovery.".into());
        self.validate()?;Ok(verified)
    }
}

fn track<'a>(timeline:&'a Value,fixture:&Fixture)->Result<&'a Value,String>{
    if timeline.get("truncated").and_then(Value::as_bool)!=Some(false)
        || timeline.pointer("/expected/project_guid").and_then(Value::as_str)!=Some(fixture.expected.project_guid.as_str())
        || timeline.get("sequenceGuid").and_then(Value::as_str)!=fixture.expected.sequence_guid.as_deref()
        || timeline.pointer("/expected/project_path").and_then(Value::as_str)!=fixture.expected.project_path.as_deref() {
        return Err("Acceptance timeline truncated or project identity changed.".into());
    }
    timeline.get(if fixture.kind=="video" {"videoTracks"}else{"audioTracks"}).and_then(Value::as_array)
        .and_then(|v|v.iter().find(|t|t["index"]==fixture.track)).ok_or("Acceptance track missing.".into())
}
pub fn exact_clip(timeline:&Value,fixture:&Fixture)->Result<Value,String>{
    let items=track(timeline,fixture)?.get("items").and_then(Value::as_array).ok_or("Track items missing.")?;
    let clip=items.iter().find(|c|c["clipIndex"]==fixture.clip_index).ok_or("Exact clip missing.")?;
    if clip.get("targetSignature").and_then(Value::as_str)!=Some(fixture.expected.clips[0].signature.as_str()) {
        return Err("Clip target signature changed before acceptance.".into());
    }
    Ok(json!({"name":clip.get("name"),"startSeconds":clip.get("startSeconds"),"endSeconds":clip.get("endSeconds"),
        "targetSignature":clip.get("targetSignature"),"clip_count":items.len()}))
}
fn summary(timeline:&Value,fixture:&Fixture)->Result<Value,String>{
    let items=track(timeline,fixture)?.get("items").and_then(Value::as_array).ok_or("Track items missing.")?;
    if items.len()>240 {return Err("Acceptance track exceeds inspection budget.".into());}
    Ok(json!({"clip_count":items.len(),"items":items.iter().map(|v|json!({"name":v.get("name"),
        "startSeconds":v.get("startSeconds"),"endSeconds":v.get("endSeconds")})).collect::<Vec<_>>()}))
}
pub fn verify(step:&str,fixture:&Fixture,before:&Value,after:&Value)->bool{
    let Ok(state)=summary(after,fixture) else{return false};
    let Some(items)=state["items"].as_array() else{return false};
    let (Some(start),Some(end))=(before["startSeconds"].as_f64(),before["endSeconds"].as_f64()) else{return false};
    let name=&before["name"];
    let close=|a:f64,b:f64|(a-b).abs()<0.005;
    let matches=items.iter().filter(|item|&item["name"]==name).collect::<Vec<_>>();
    match step {
        "trim" => {
            let a=fixture.start_seconds.unwrap_or(start);let b=fixture.end_seconds.unwrap_or(end);
            matches.len()==1 && matches.iter().any(|v|v["startSeconds"].as_f64().is_some_and(|n|close(n,a))
                && v["endSeconds"].as_f64().is_some_and(|n|close(n,b)))
                && (!close(a,start)||!close(b,end))
        },
        "move" => fixture.delta_seconds.is_some_and(|d|matches.len()==1 && matches.iter().any(|v|
            v["startSeconds"].as_f64().is_some_and(|n|close(n,start+d))
            && v["endSeconds"].as_f64().is_some_and(|n|close(n,end+d)))),
        "clone" => fixture.delta_seconds.is_some_and(|d|state["clip_count"].as_u64()==before["clip_count"].as_u64().map(|n|n+1)
            && matches.iter().any(|v|v["startSeconds"].as_f64().is_some_and(|n|close(n,start))
                && v["endSeconds"].as_f64().is_some_and(|n|close(n,end)))
            && matches.iter().any(|v|v["startSeconds"].as_f64().is_some_and(|n|close(n,start+d))
                && v["endSeconds"].as_f64().is_some_and(|n|close(n,end+d)))),
        _ => false,
    }
}

pub fn load(path:&Path)->Result<Action,String>{
    let read=|p:&Path|->Result<Action,String>{let bytes=fs::read(p).map_err(|e|e.to_string())?;
        if bytes.len()>MAX_BYTES {return Err("Oversized acceptance action.".into());}
        let action:Action=serde_json::from_slice(&bytes).map_err(|_|"Corrupt acceptance action.")?;action.validate()?;Ok(action)};
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){read(&path.with_extension("json.bak"))}else{Err(e)})
}
pub fn save(path:&Path,action:&Action)->Result<(),String>{
    action.validate()?;let bytes=serde_json::to_vec(action).map_err(|e|e.to_string())?;
    let tmp=path.with_extension("json.tmp");let bak=path.with_extension("json.bak");
    fs::write(&tmp,bytes).map_err(|e|e.to_string())?;
    if path.exists(){if bak.exists(){fs::remove_file(&bak).map_err(|e|e.to_string())?;}fs::rename(path,&bak).map_err(|e|e.to_string())?;}
    if let Err(e)=fs::rename(&tmp,path){if bak.exists(){let _=fs::rename(&bak,path);}return Err(e.to_string());}
    if bak.exists(){let _=fs::remove_file(bak);}Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    fn fixture()->(Fixture,Value,Value){
        let expected:PremiereExpectation=serde_json::from_value(json!({"project_guid":"p","project_path":"C:/disposable.prproj",
            "sequence_guid":"s","clips":[{"kind":"video","track":0,"clip_index":0,"signature":"sig"}]})).unwrap();
        let fixture=Fixture{kind:"video".into(),track:0,clip_index:0,start_seconds:Some(0.5),end_seconds:None,
            delta_seconds:None,expected};
        let context=json!({"projectGuid":"p","projectPath":"C:/disposable.prproj","activeSequence":{"guid":"s"},"premiereVersion":"26"});
        let timeline=json!({"truncated":false,"expected":{"project_guid":"p","project_path":"C:/disposable.prproj"},"sequenceGuid":"s",
            "videoTracks":[{"index":0,"items":[{"clipIndex":0,"name":"test","startSeconds":0.0,"endSeconds":2.0,"targetSignature":"sig"}]}]});
        (fixture,context,timeline)
    }
    #[test] fn rejects_injection_stale_and_dangerous_delta(){let (mut f,c,t)=fixture();
        assert!(Action::new("a".into(),"arbitrary_js".into(),f.clone(),&c,&t).is_err());
        let mut stale=c.clone();stale["projectGuid"]=json!("other");
        assert!(Action::new("a".into(),"trim".into(),f.clone(),&stale,&t).is_err());
        f.start_seconds=Some(20.0);assert!(Action::new("a".into(),"trim".into(),f,&c,&t).is_err());
    }
    #[test] fn requires_native_poststate_and_one_execution(){let (f,c,t)=fixture();
        let mut action=Action::new("a".into(),"trim".into(),f,&c,&t).unwrap();
        assert!(action.identity(&c).is_ok());
        let mut stale=c.clone();stale["activeSequence"]["guid"]=json!("other");assert!(action.identity(&stale).is_err());
        action.status="executing".into();assert!(!action.finish(&t,true).unwrap());
        assert!(action.finish(&t,true).is_err());
    }
    #[test] fn verified_timing_requires_real_poststate(){let (f,c,mut t)=fixture();let mut a=Action::new("a".into(),"trim".into(),f,&c,&t).unwrap();
        a.status="executing".into();t["videoTracks"][0]["items"][0]["startSeconds"]=json!(0.5);
        assert!(a.finish(&t,true).unwrap());assert_eq!(a.status,"verified");
    }
}
