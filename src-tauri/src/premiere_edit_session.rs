use crate::premiere_editorial::{Recipe, Request};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs,path::Path,time::{SystemTime,UNIX_EPOCH}};

const MAX_BYTES:usize=96*1024;
const MAX_HISTORY:usize=64;
const STATES:&[&str]=&["pending","blocked","ready","awaiting_approval","executing","applied","review_required","reviewing","completed","skipped","failed","cancelled","cancelled_after_apply","uncertain"];

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageRun {pub id:String,pub state:String,pub reason:Option<String>,pub action_id:Option<String>,pub review_session_id:Option<String>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {pub stage_id:String,pub state:String,pub action_id:Option<String>,pub at_ms:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {pub schema_version:u8,pub session_id:String,pub recipe:Recipe,pub project_guid:String,
    pub sequence_guid:String,pub project_path:Option<String>,pub created_at_ms:u64,pub status:String,pub stages:Vec<StageRun>,
    pub current_stage:Option<String>,pub history:Vec<Event>}

fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}

impl Session {
    pub fn new(id:String,request:Request,project:&str,sequence:&str,path:Option<&str>)->Result<Self,String>{
        if id.len()>80 || id.is_empty() || project.is_empty() || project.len()>240 || sequence.is_empty() || sequence.len()>240
            || path.is_some_and(|s|s.len()>1024) {return Err("Invalid edit session identity.".into());}
        let planned=crate::premiere_editorial::plan(request)?;
        let recipe:Recipe=serde_json::from_value(planned["recipe"].clone()).map_err(|e|e.to_string())?;
        recipe.validate()?;
        let stages=recipe.stages.iter().map(|s|StageRun{id:s.id.clone(),
            state:if s.state=="blocked"{"blocked"}else{"pending"}.into(),
            reason:(s.state=="blocked").then(||s.unsupported_behavior.clone()),action_id:None,review_session_id:None}).collect();
        let result=Self {schema_version:1,session_id:id,recipe,project_guid:project.into(),sequence_guid:sequence.into(),
            project_path:path.map(str::to_owned),created_at_ms:now(),status:"running".into(),stages,current_stage:None,history:vec![]};
        result.validate()?;Ok(result)
    }
    pub fn validate(&self)->Result<(),String>{
        self.recipe.validate()?;
        if self.schema_version!=1 || self.session_id.is_empty() || self.session_id.len()>80
            || self.project_guid.is_empty() || self.project_guid.len()>240 || self.sequence_guid.is_empty() || self.sequence_guid.len()>240
            || self.project_path.as_ref().is_some_and(|s|s.len()>1024) || self.created_at_ms==0 || self.stages.len()!=self.recipe.stages.len()
            || self.stages.len()>32 || self.history.len()>MAX_HISTORY || !matches!(self.status.as_str(),"running"|"cancelled"|"completed")
            || self.current_stage.as_ref().is_some_and(|s|!self.stages.iter().any(|r|&r.id==s)) {return Err("Invalid edit session version, bounds or identity.".into());}
        for (run,spec) in self.stages.iter().zip(&self.recipe.stages){
            if run.id!=spec.id || !STATES.contains(&run.state.as_str()) || run.reason.as_ref().is_some_and(|s|s.len()>300)
                || run.action_id.as_ref().is_some_and(|s|s.len()>80) || run.review_session_id.as_ref().is_some_and(|s|s.len()>80)
                || run.state=="skipped" || matches!(run.state.as_str(),"completed"|"applied"|"review_required"|"reviewing")
                    && spec.stage_type!="review" && run.action_id.is_none()
                || run.state=="completed" && spec.review_required && run.review_session_id.is_none() {return Err("Invalid stage evidence or transition state.".into());}
        }
        for e in &self.history {if !self.stages.iter().any(|s|s.id==e.stage_id) || !STATES.contains(&e.state.as_str())
            || e.action_id.as_ref().is_some_and(|s|s.len()>80){return Err("Invalid stage history.".into());}}
        if self.status=="completed" && self.stages.iter().any(|s|s.state!="completed") {return Err("Blocked or pending mandatory stage prevents completion.".into());}
        if serde_json::to_vec(self).map_err(|e|e.to_string())?.len()>MAX_BYTES{return Err("Edit session exceeds 96 KiB.".into());}
        Ok(())
    }
    pub fn identity(&self,context:&Value)->Result<(),String>{
        if context.get("projectGuid").and_then(Value::as_str)!=Some(self.project_guid.as_str())
            || context.pointer("/activeSequence/guid").and_then(Value::as_str)!=Some(self.sequence_guid.as_str())
            || self.project_path.as_ref().is_some_and(|p|context.get("projectPath").and_then(Value::as_str)!=Some(p.as_str())){
            return Err("Edit session project or active sequence changed; inspect before continuing.".into());
        }Ok(())
    }
    fn event(&mut self,index:usize,state:&str,action_id:Option<&str>)->Result<(),String>{
        if self.history.len()==MAX_HISTORY {self.history.remove(0);}
        self.stages[index].state=state.into();
        self.current_stage=Some(self.stages[index].id.clone());
        self.history.push(Event{stage_id:self.stages[index].id.clone(),state:state.into(),action_id:action_id.map(str::to_owned),at_ms:now()});
        self.validate()
    }
    pub fn next(&mut self)->Result<Value,String>{
        if self.status!="running" {return Err("Edit session is cancelled or completed.".into());}
        for i in 0..self.stages.len(){
            if self.stages[i].state!="pending" {continue;}
            let dependencies=&self.recipe.stages[i].dependencies;
            if dependencies.iter().any(|id|self.stages.iter().any(|s|&s.id==id && matches!(s.state.as_str(),"blocked"|"failed"|"cancelled"|"cancelled_after_apply"|"uncertain"))){
                self.stages[i].reason=Some("Required predecessor is blocked or failed; explicit replan required.".into());
                self.event(i,"blocked",None)?;continue;
            }
            if dependencies.iter().any(|id|!self.stages.iter().any(|s|&s.id==id && s.state=="completed")){continue;}
            let stage=&self.recipe.stages[i];
            let stage_id=stage.id.clone();let tool=stage.required_capability.clone();
            let review=stage.review_required;
            let state=if stage.stage_type=="review" {"review_required"} else if stage.stage_type=="inspect" {"ready"} else {"awaiting_approval"};
            self.event(i,state,None)?;
            return Ok(json!({"stage_id":stage_id,"state":state,"typed_tool":tool,"review_required":review,
                "automatic_execution":false,"expected":{"project_guid":self.project_guid,"project_path":self.project_path,
                    "sequence_guid":self.sequence_guid,"clips":[]},
                "next":if state=="review_required"{"premiere_review_session_start"}else{"Invoke the exact typed tool under normal approval, checkpoint, expectation and audit flow."}}));
        }
        if self.stages.iter().all(|s|matches!(s.state.as_str(),"completed"|"skipped")) {self.status="completed".into();self.validate()?;}
        Ok(json!({"status":self.status,"next_stage":null,"blocked":self.stages.iter().filter(|s|s.state=="blocked").map(|s|&s.id).collect::<Vec<_>>(),
            "waiting":self.stages.iter().filter(|s|matches!(s.state.as_str(),"awaiting_approval"|"review_required"|"reviewing"|"applied")).map(|s|&s.id).collect::<Vec<_>>() }))
    }
    pub fn record(&mut self,id:&str,action_id:&str,tool:&str,success:bool)->Result<(),String>{
        if self.status!="running" || action_id.is_empty()||action_id.len()>80{return Err("Session cannot record this action.".into());}
        let i=self.stages.iter().position(|s|s.id==id).ok_or("Unknown stage.")?;
        let spec=&self.recipe.stages[i];let requires_review=spec.review_required;
        if self.stages[i].state!=if spec.stage_type=="inspect"{"ready"}else{"awaiting_approval"}
            || tool!=spec.required_capability || self.history.iter().any(|e|e.action_id.as_deref()==Some(action_id)){
            return Err("Stage is not awaiting this exact typed action or receipt was used before.".into());
        }
        self.stages[i].action_id=Some(action_id.into());
        if !success {self.stages[i].reason=Some("Approved typed tool reported failure; no automatic retry.".into());return self.event(i,"failed",Some(action_id));}
        self.event(i,"applied",Some(action_id))?;
        if requires_review {self.event(i,"review_required",None)}else{self.event(i,"completed",None)}
    }
    pub fn review(&mut self,id:&str,review_session_id:&str,acceptable:bool)->Result<(),String>{
        if self.status!="running" || review_session_id.is_empty()||review_session_id.len()>80 {return Err("Invalid review receipt.".into());}
        let i=self.stages.iter().position(|s|s.id==id).ok_or("Unknown stage.")?;
        if !self.recipe.stages[i].review_required || self.stages[i].state!="review_required" ||
            self.stages.iter().any(|s|s.review_session_id.as_deref()==Some(review_session_id)) {
            return Err("Review session cannot be reused or this stage is not awaiting review.".into());
        }
        self.stages[i].review_session_id=Some(review_session_id.into());
        self.event(i,"reviewing",None)?;
        if acceptable {self.event(i,"completed",None)}else{self.event(i,"failed",None)}
    }
    pub fn cancel(&mut self){if self.status!="running" {return;} self.status="cancelled".into();self.current_stage=None;
        for run in &mut self.stages {
            match run.state.as_str() {
                "pending"|"ready"|"awaiting_approval" => {
                    run.state="cancelled".into();
                    run.reason=Some("Cancelled before any typed action receipt was recorded.".into());
                }
                "applied" => {
                    run.state="cancelled_after_apply".into();
                    run.reason=Some("Typed mutation was already applied; session cancellation does not roll it back. Inspect before any further edit.".into());
                }
                "review_required"|"reviewing" if run.action_id.is_some() => {
                    run.state="cancelled_after_apply".into();
                    run.reason=Some("Typed mutation was already applied but review was not completed; cancellation does not roll it back.".into());
                }
                "review_required"|"reviewing" => {
                    run.state="cancelled".into();
                    run.reason=Some("Review-only stage cancelled before completion.".into());
                }
                "executing" => {
                    run.state="uncertain".into();
                    run.reason=Some("Cancellation cannot prove an already dispatched native mutation stopped; inspect native state before retry.".into());
                }
                _ => {}
            }
        }
    }
}

pub fn load(path:&Path)->Result<Session,String>{
    let read=|p:&Path| -> Result<Session,String>{let bytes=crate::read_file_bytes_bounded(p, MAX_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_BYTES{return Err("Oversized edit session.".into());}
        let session:Session=serde_json::from_slice(&bytes).map_err(|_|"Corrupt edit session.")?;session.validate()?;Ok(session)};
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){
        let mut recovered=read(&path.with_extension("json.bak"))?;
        recovered.cancel();recovered.status="cancelled".into();recovered.current_stage=None;
        Ok(recovered)
    }else{Err(e)})
}
pub fn save(path:&Path,session:&Session)->Result<(),String>{
    session.validate()?;let bytes=serde_json::to_vec(session).map_err(|e|e.to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,|data|{
        let session:Session=serde_json::from_slice(data).map_err(|e|e.to_string())?;session.validate()
    })
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]fn backup_recovery_never_resumes_an_older_running_session(){
        let r=Request{preset:"social_reel".into(),targets:Default::default(),inputs:Default::default(),options:Default::default()};
        let s=Session::new("id".into(),r,"p","s",None).unwrap();
        let path=std::env::temp_dir().join(format!("shuvi-session-recover-{}.json",uuid::Uuid::new_v4()));
        save(&path,&s).unwrap();save(&path,&s).unwrap();fs::write(&path,b"broken").unwrap();
        let mut recovered=load(&path).unwrap();assert_eq!(recovered.status,"cancelled");assert!(recovered.next().is_err());
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("json.bak")).unwrap();
    }
    #[test]fn missing_inputs_block_and_never_complete(){let r=Request{preset:"social_reel".into(),targets:Default::default(),inputs:Default::default(),options:Default::default()};
        let mut s=Session::new("id".into(),r,"p","s",None).unwrap();assert_eq!(s.next().unwrap()["stage_id"],"inspect");
        assert!(s.record("pace","receipt","premiere_trim_clip",true).is_err());
        s.record("inspect","receipt","premiere_timeline",true).unwrap();assert_ne!(s.next().unwrap()["status"],"completed");
        assert!(s.identity(&json!({"projectGuid":"p","activeSequence":{"guid":"other"}})).is_err());
        s.cancel();assert!(s.next().is_err());s.validate().unwrap();}
    #[test]fn no_duplicate_receipts_or_automatic_review(){let r=Request{preset:"clean_corporate".into(),targets:Default::default(),inputs:Default::default(),options:Default::default()};
        let mut s=Session::new("id".into(),r,"p","s",None).unwrap();s.next().unwrap();
        s.record("inspect","a","premiere_timeline",true).unwrap();assert!(s.record("inspect","a","premiere_timeline",true).is_err());
        assert!(s.review("review","fake",true).is_err());}
}
