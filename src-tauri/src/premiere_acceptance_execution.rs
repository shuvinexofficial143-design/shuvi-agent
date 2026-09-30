use crate::premiere_target::PremiereExpectation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};

const MAX_BYTES: usize = 32 * 1024;
static ACTION_IO:std::sync::Mutex<()>=std::sync::Mutex::new(());

pub fn begin(path:&Path,inspected:&Action)->Result<Action,String>{
    let _io=ACTION_IO.lock().map_err(|_|"Acceptance state lock unavailable.")?;
    let mut latest=load(path)?;
    if latest.status!="prepared" || latest.cancellation_requested
        || serde_json::to_value(&latest).map_err(|e|e.to_string())?!=serde_json::to_value(inspected).map_err(|e|e.to_string())? {
        return Err("Acceptance changed or was cancelled during inspection; no edit launched.".into());
    }
    latest.status="executing".into();save(path,&latest)?;Ok(latest)
}

pub fn cancel(path:&Path)->Result<Action,String>{
    let _io=ACTION_IO.lock().map_err(|_|"Acceptance state lock unavailable.")?;
    let mut latest=load(path)?;
    if latest.status=="prepared" {latest.status="cancelled".into();}
    if latest.status=="executing" {latest.cancellation_requested=true;}
    save(path,&latest)?;Ok(latest)
}

pub fn save_progress(path:&Path,record:&mut Action)->Result<(),String>{
    let _io=ACTION_IO.lock().map_err(|_|"Acceptance state lock unavailable.")?;
    let latest=load(path)?;
    if latest.action_id!=record.action_id || latest.status!="executing" {
        return Err("Acceptance completion is stale; terminal or recovered state was preserved.".into());
    }
    record.cancellation_requested|=latest.cancellation_requested;
    save(path,record)
}

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
    #[serde(default)]
    pub recovery_verified: bool,
    pub cancellation_requested: bool,
    pub created_at_ms: u64,
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

impl Action {
    pub fn new(id: String, step: String, fixture: Fixture, context: &Value, timeline: &Value) -> Result<Self,String> {
        if !matches!(step.as_str(),"trim"|"move"|"clone"|"scene_markers") {return Err("Acceptance action is unsupported; no arbitrary bridge action.".into());}
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
            },
            "scene_markers" => {
                if fixture.kind!="video" || fixture.start_seconds.is_some() || fixture.end_seconds.is_some() || fixture.delta_seconds.is_some() {
                    return Err("Scene marker acceptance requires one exact video clip and no timing mutation fields.".into());
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
            recovery:None,recovery_verified:false,cancellation_requested:false,created_at_ms:now()};
        record.validate()?;Ok(record)
    }
    pub fn validate(&self)->Result<(),String>{
        self.fixture.expected.validate()?;
        let fixture=&self.fixture;
        let clip=fixture.expected.clips.first().ok_or("Acceptance clip expectation missing.")?;
        if fixture.expected.clips.len()!=1 || fixture.kind!=clip.kind || fixture.track!=clip.track
            || fixture.clip_index!=clip.clip_index || fixture.expected.sequence_guid.is_none()
            || fixture.expected.project_path.as_deref()!=Some(self.project_path.as_str())
            || self.before.get("targetSignature").and_then(Value::as_str)!=Some(clip.signature.as_str())
            || !self.before.get("clip_count").and_then(Value::as_u64).is_some_and(|n|n>0 && n<=240) {
            return Err("Persisted acceptance target does not match its exact fixture.".into());
        }
        let start=self.before.get("startSeconds").and_then(Value::as_f64).ok_or("Acceptance start missing.")?;
        let end=self.before.get("endSeconds").and_then(Value::as_f64).ok_or("Acceptance end missing.")?;
        if !start.is_finite() || !end.is_finite() || start<0.0 || end>86400.0 || start>=end {
            return Err("Invalid persisted acceptance timing.".into());
        }
        match self.step.as_str() {
            "trim" if fixture.delta_seconds.is_some()
                || fixture.start_seconds.is_none() && fixture.end_seconds.is_none()
                || fixture.start_seconds.unwrap_or(start)>=fixture.end_seconds.unwrap_or(end)
                || fixture.start_seconds.is_some_and(|n|!n.is_finite() || n<0.0 || n>=end || (n-start).abs()>3.0)
                || fixture.end_seconds.is_some_and(|n|!n.is_finite() || n<=start || n>86400.0 || (n-end).abs()>3.0)
                => return Err("Invalid persisted acceptance trim.".into()),
            "move"|"clone" if fixture.start_seconds.is_some() || fixture.end_seconds.is_some()
                || !fixture.delta_seconds.is_some_and(|n|n.is_finite() && n!=0.0 && n.abs()<=3.0 && start+n>=0.0 && end+n<=86400.0)
                => return Err("Invalid persisted acceptance offset.".into()),
            _=>{}
        }
        if self.schema_version!=1 || self.group!=2 || !matches!(self.step.as_str(),"trim"|"move"|"clone"|"scene_markers")
            || (self.step=="scene_markers" && (self.fixture.kind!="video" || self.fixture.start_seconds.is_some()
                || self.fixture.end_seconds.is_some() || self.fixture.delta_seconds.is_some()))
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
    pub fn finish_scene_markers(&mut self,native:&Value)->Result<bool,String>{
        if self.status!="executing" {return Err("Acceptance action cannot be completed twice.".into());}
        if self.step!="scene_markers" {return Err("Scene marker receipt supplied for a different acceptance step.".into());}
        let result=native.get("result").ok_or("Scene detection acceptance receipt is missing native result.")?;
        let new_markers=result.get("newMarkers").and_then(Value::as_array).ok_or("Scene detection marker delta is missing.")?;
        let verified=native.get("native_accepted").and_then(Value::as_bool)==Some(true)
            && native.get("verification_status").and_then(Value::as_str)==Some("verified_delta")
            && result.get("mode").and_then(Value::as_str)==Some("markers")
            && result.get("nativeAccepted").and_then(Value::as_bool)==Some(true)
            && result.get("operationDispatched").and_then(Value::as_bool)==Some(true)
            && result.get("selectionRestored").and_then(Value::as_bool)==Some(true)
            && result.get("targetCount").and_then(Value::as_u64)==Some(1)
            && result.get("markerObservationTruncated").and_then(Value::as_bool)==Some(false)
            && !new_markers.is_empty() && new_markers.len()<=1000;
        self.after=Some(json!({
            "mode":"markers",
            "native_accepted":result.get("nativeAccepted"),
            "verification_status":native.get("verification_status"),
            "selection_restored":result.get("selectionRestored"),
            "target_count":result.get("targetCount"),
            "new_marker_count":new_markers.len(),
            "marker_observation_truncated":result.get("markerObservationTruncated")
        }));
        self.status=if verified {"verified"} else {"uncertain"}.into();
        self.recovery=Some("A .prproj checkpoint is retained; generated scene markers were not removed automatically.".into());
        self.validate()?;Ok(verified)
    }

    pub fn finish(&mut self,after:&Value, native_accepted:bool)->Result<bool,String>{
        if self.status!="executing" {return Err("Acceptance action cannot be completed twice.".into());}
        let verified=native_accepted && verify(&self.step,&self.fixture,&self.before,after);
        self.after=Some(summary(after,&self.fixture)?);
        self.status=if verified {"verified"} else {"uncertain"}.into();
        self.recovery=Some("A .prproj checkpoint is retained; no rollback or cleanup was performed. Inspect before explicit recovery.".into());
        self.validate()?;Ok(verified)
    }

    pub fn verify_recovery(&mut self,context:&Value,timeline:&Value)->Result<bool,String>{
        if self.checkpoint.is_none() || !matches!(self.step.as_str(),"trim"|"move"|"clone")
            || !matches!(self.status.as_str(),"verified"|"uncertain"|"failed") {
            return Err("Recovery verification requires a completed trim/move/clone acceptance action with checkpoint.".into());
        }
        let checkpoint=self.checkpoint.as_deref().ok_or("Checkpoint missing.")?;
        let current_path=context.get("projectPath").and_then(Value::as_str).ok_or("Recovery host project path missing.")?;
        let canonical_current=fs::canonicalize(current_path).map_err(|e|format!("Recovery project path unavailable: {e}"))?;
        let canonical_checkpoint=fs::canonicalize(checkpoint).map_err(|e|format!("Checkpoint path unavailable: {e}"))?;
        if canonical_current!=canonical_checkpoint
            || context.get("projectGuid").and_then(Value::as_str)!=Some(self.fixture.expected.project_guid.as_str())
            || context.pointer("/activeSequence/guid").and_then(Value::as_str)!=self.fixture.expected.sequence_guid.as_deref()
            || context.get("premiereVersion").and_then(Value::as_str)!=Some(self.premiere_version.as_str()) {
            self.recovery_verified=false;
            return Ok(false);
        }
        if timeline.get("truncated").and_then(Value::as_bool)!=Some(false)
            || timeline.get("sequenceGuid").and_then(Value::as_str)!=self.fixture.expected.sequence_guid.as_deref()
            || timeline.pointer("/expected/project_guid").and_then(Value::as_str)!=Some(self.fixture.expected.project_guid.as_str()) {
            self.recovery_verified=false;
            return Ok(false);
        }
        let timeline_path=timeline.pointer("/expected/project_path").and_then(Value::as_str).ok_or("Recovery timeline project path missing.")?;
        if fs::canonicalize(timeline_path).ok().as_deref()!=Some(canonical_checkpoint.as_path()) {
            self.recovery_verified=false;
            return Ok(false);
        }
        let items=timeline.get(if self.fixture.kind=="video" {"videoTracks"}else{"audioTracks"}).and_then(Value::as_array)
            .and_then(|tracks|tracks.iter().find(|track|track["index"]==self.fixture.track))
            .and_then(|track|track.get("items")).and_then(Value::as_array).ok_or("Recovery track missing.")?;
        if items.len()>240 || Some(items.len() as u64)!=self.before.get("clip_count").and_then(Value::as_u64) {
            self.recovery_verified=false;
            return Ok(false);
        }
        let clip=items.iter().find(|item|item["clipIndex"]==self.fixture.clip_index
            && item.get("targetSignature").and_then(Value::as_str)==Some(self.fixture.expected.clips[0].signature.as_str()));
        let Some(clip)=clip else {self.recovery_verified=false;return Ok(false);};
        let close=|a:f64,b:f64|(a-b).abs()<0.005;
        let recovered=clip.get("name")==self.before.get("name")
            && clip.get("startSeconds").and_then(Value::as_f64).zip(self.before.get("startSeconds").and_then(Value::as_f64))
                .is_some_and(|(a,b)|close(a,b))
            && clip.get("endSeconds").and_then(Value::as_f64).zip(self.before.get("endSeconds").and_then(Value::as_f64))
                .is_some_and(|(a,b)|close(a,b));
        self.recovery_verified=recovered;
        self.recovery=Some(if recovered {
            "Recovery verified by reopening the Shuvi checkpoint and reobserving the exact pre-edit clip/timeline state; Shuvi performed no automatic rollback.".into()
        } else {
            "Checkpoint is open but the exact pre-edit clip/timeline state was not reobserved; recovery remains unverified.".into()
        });
        self.validate()?;
        Ok(recovered)
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
    let expected=fixture.expected.clips.first().filter(|_|fixture.expected.clips.len()==1)
        .ok_or("Acceptance requires one exact clip expectation.")?;
    let items=track(timeline,fixture)?.get("items").and_then(Value::as_array).ok_or("Track items missing.")?;
    let clip=items.iter().find(|c|c["clipIndex"]==fixture.clip_index).ok_or("Exact clip missing.")?;
    if clip.get("targetSignature").and_then(Value::as_str)!=Some(expected.signature.as_str()) {
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
    let read=|p:&Path|->Result<Action,String>{let bytes=crate::read_file_bytes_bounded(p, MAX_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_BYTES {return Err("Oversized acceptance action.".into());}
        let action:Action=serde_json::from_slice(&bytes).map_err(|_|"Corrupt acceptance action.")?;action.validate()?;Ok(action)};
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){
        let mut recovered=read(&path.with_extension("json.bak"))?;
        // A backup can precede dispatch or cancellation. Never revive its prepared action.
        recovered.status="uncertain".into();recovered.recovery_verified=false;
        recovered.recovery=Some("Recovered an older acceptance snapshot; execution/cancellation may have occurred. Inspect the host; do not replay.".into());
        Ok(recovered)
    }else{Err(e)})
}
pub fn save(path:&Path,action:&Action)->Result<(),String>{
    action.validate()?;let bytes=serde_json::to_vec(action).map_err(|e|e.to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,|data|{
        let action:Action=serde_json::from_slice(data).map_err(|e|e.to_string())?;action.validate()
    })
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]fn cancellation_during_inspection_cannot_be_overwritten_and_late_completion_is_rejected(){
        let (f,c,t)=fixture();let a=Action::new("a".into(),"trim".into(),f,&c,&t).unwrap();
        let path=std::env::temp_dir().join(format!("shuvi-acceptance-cancel-{}.json",uuid::Uuid::new_v4()));
        save(&path,&a).unwrap();cancel(&path).unwrap();
        assert!(begin(&path,&a).is_err());assert_eq!(load(&path).unwrap().status,"cancelled");
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("json.bak")).unwrap();
        save(&path,&a).unwrap();let mut running=begin(&path,&a).unwrap();cancel(&path).unwrap();
        running.status="uncertain".into();save_progress(&path,&mut running).unwrap();
        assert!(running.cancellation_requested);assert!(save_progress(&path,&mut running).is_err());
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("json.bak")).unwrap();
    }
    #[test]fn persisted_fixture_cannot_drop_or_retarget_clip_or_enlarge_mutation(){
        let (f,c,t)=fixture();let a=Action::new("a".into(),"trim".into(),f,&c,&t).unwrap();
        let mut bad=a.clone();bad.fixture.expected.clips.clear();assert!(bad.validate().is_err());
        assert!(exact_clip(&t,&bad.fixture).is_err());
        let mut bad=a.clone();bad.fixture.clip_index=1;assert!(bad.validate().is_err());
        let mut bad=a.clone();bad.fixture.expected.sequence_guid=None;assert!(bad.validate().is_err());
        let mut bad=a.clone();bad.fixture.start_seconds=Some(99.0);assert!(bad.validate().is_err());
        let mut bad=a.clone();bad.before["targetSignature"]=json!("different");assert!(bad.validate().is_err());
    }
    #[test]fn recovered_pre_dispatch_backup_cannot_authorize_replay(){
        let (f,c,t)=fixture();let a=Action::new("a".into(),"trim".into(),f,&c,&t).unwrap();
        let path=std::env::temp_dir().join(format!("shuvi-acceptance-recovery-{}.json",uuid::Uuid::new_v4()));
        fs::write(path.with_extension("json.bak"),serde_json::to_vec(&a).unwrap()).unwrap();
        fs::write(&path,b"corrupt").unwrap();
        let recovered=load(&path).unwrap();assert_eq!(recovered.status,"uncertain");
        assert!(!recovered.recovery_verified);
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("json.bak")).unwrap();
    }
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
    #[test] fn move_and_clone_require_exact_observed_poststate(){
        let (mut move_fixture,c,mut moved)=fixture();
        move_fixture.start_seconds=None;move_fixture.end_seconds=None;move_fixture.delta_seconds=Some(1.0);
        let mut move_action=Action::new("move-a".into(),"move".into(),move_fixture,&c,&moved).unwrap();
        move_action.status="executing".into();
        moved["videoTracks"][0]["items"][0]["startSeconds"]=json!(1.0);
        moved["videoTracks"][0]["items"][0]["endSeconds"]=json!(3.0);
        assert!(move_action.finish(&moved,true).unwrap());

        let (mut clone_fixture,c,mut cloned)=fixture();
        clone_fixture.start_seconds=None;clone_fixture.end_seconds=None;clone_fixture.delta_seconds=Some(1.0);
        let mut clone_action=Action::new("clone-a".into(),"clone".into(),clone_fixture,&c,&cloned).unwrap();
        clone_action.status="executing".into();
        cloned["videoTracks"][0]["items"].as_array_mut().unwrap().push(json!({
            "clipIndex":1,"name":"test","startSeconds":1.0,"endSeconds":3.0,"targetSignature":"clone-sig"
        }));
        assert!(clone_action.finish(&cloned,true).unwrap());

        let (mut bad_fixture,c,bad)=fixture();
        bad_fixture.start_seconds=None;bad_fixture.end_seconds=None;bad_fixture.delta_seconds=Some(1.0);
        let mut bad_action=Action::new("clone-b".into(),"clone".into(),bad_fixture,&c,&bad).unwrap();
        bad_action.status="executing".into();
        assert!(!bad_action.finish(&bad,true).unwrap());
    }
    #[test] fn recovery_requires_checkpoint_project_and_exact_pre_edit_state(){
        let (fixture,mut context,timeline)=fixture();
        let mut action=Action::new("recover-a".into(),"trim".into(),Fixture {
            start_seconds:Some(0.1),..fixture
        },&context,&timeline).unwrap();
        let checkpoint_dir=std::env::temp_dir().join(format!("shuvi-recovery-{}",std::process::id()));
        let backups=checkpoint_dir.join("Shuvi Backups");
        fs::create_dir_all(&backups).unwrap();
        let source=checkpoint_dir.join("original.prproj");
        let checkpoint=backups.join("backup.prproj");
        fs::write(&source,b"source").unwrap();
        fs::write(&checkpoint,b"backup").unwrap();
        action.checkpoint=Some(checkpoint.to_string_lossy().into_owned());
        action.status="verified".into();
        context["projectPath"]=json!(checkpoint.to_string_lossy().to_string());
        let mut recovered=timeline.clone();
        recovered["expected"]["project_path"]=json!(checkpoint.to_string_lossy().to_string());
        assert!(action.verify_recovery(&context,&recovered).unwrap());
        recovered["videoTracks"][0]["items"][0]["startSeconds"]=json!(0.5);
        assert!(!action.verify_recovery(&context,&recovered).unwrap());
        let _=fs::remove_dir_all(checkpoint_dir);
    }
    #[test] fn scene_marker_acceptance_needs_native_observed_delta(){
        let (mut f,c,t)=fixture();f.start_seconds=None;f.end_seconds=None;f.delta_seconds=None;
        let mut a=Action::new("a".into(),"scene_markers".into(),f,&c,&t).unwrap();
        a.status="executing".into();
        let receipt=json!({"native_accepted":true,"verification_status":"verified_delta","result":{
            "mode":"markers","nativeAccepted":true,"operationDispatched":true,"selectionRestored":true,
            "targetCount":1,"markerObservationTruncated":false,"newMarkers":[{"startSeconds":1.0}]
        }});
        assert!(a.finish_scene_markers(&receipt).unwrap());
        assert_eq!(a.after.as_ref().unwrap()["new_marker_count"],1);
    }
}
