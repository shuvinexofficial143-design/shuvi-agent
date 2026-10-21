//! M1 opt-in native, same-window, READ-ONLY inspection; NEVER authority for
//! mutating UI controls, filesystem actions, model requests or old checkpoints.
use std::collections::{HashMap,HashSet};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;
const TTL_MS:u64=180_000;
const MAX_ACTIONS:u8=8;
const MAX_SCOPES:usize=8;
/// Only this independently OS-attested root identity may produce successful
/// scoped results. Window titles alone are not process/session authority.
#[derive(Debug,Clone,PartialEq,Eq)]
struct Identity { hwnd:u64,pid:u32,start_ticks:String }
fn observed_identity(stdout:&str)->Result<Identity,String>{
    if stdout.len()>128*1024 {return Err("Scoped UI observation too large.".into());}
    let json:Value=serde_json::from_str(stdout)
        .map_err(|_|"Scoped UI root identity has no valid JSON witness.")?;
    let observations=json.as_array()
        .ok_or("Scoped read must include a bounded array of OS-attested UIA observations.")?;
    if observations.is_empty()||observations.len()>150{
        return Err("Scoped UI root attestation requires at least one valid observed control.".into());
    }
    let mut identity:Option<Identity>=None;
    for item in observations {
        let hwnd=item.get("ObservedWindowHwnd").and_then(Value::as_u64)
            .filter(|v|*v>0)
            .ok_or("Missing real native window HWND in UIA readback.")?;
        let pid=item.get("ObservedWindowPid").and_then(Value::as_u64)
            .filter(|v|*v>0&&*v<=u32::MAX as u64)
            .ok_or("Missing real native window PID in UIA readback.")? as u32;
        let start=item.get("ObservedWindowProcessStartTicks").and_then(Value::as_str)
            .filter(|v|!v.is_empty()&&v.len()<=24&&v.bytes().all(|c|c.is_ascii_digit())&&v!="0")
            .ok_or("Missing verified process generation in UIA readback.")?;
        let actual=Identity{hwnd,pid,start_ticks:start.to_string()};
        if identity.as_ref().is_some_and(|old|old!=&actual){
            return Err("Contradictory window identities in one scoped UI read.".into());
        }
        identity=Some(actual);
    }
    identity.ok_or("Scoped UI identity is unavailable.".into())
}
#[derive(Clone)]
struct Scope{
    task:String,origin:String,window:String,expires:u64,remaining:u8,
    consumed:HashSet<String>,bound:Option<Identity>,
}
#[derive(Default)]
pub(crate) struct Store{scopes:HashMap<String,Scope>}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct View{
    pub id:String,pub task_id:String,pub window:String,pub allowed_tools:Vec<String>,
    pub expires_at_ms:u64,pub remaining_actions:u8,pub authorized_paid_requests:u8,
}
fn valid_uuid(s:&str)->bool{
    Uuid::parse_str(s).map(|x|x.to_string()==s).unwrap_or(false)
}
fn window_for(action:&crate::ToolAction)->Result<&str,String>{
    let w=match action {
        crate::ToolAction::UiDiscover{window}=>window.as_str(),
        crate::ToolAction::UiFind{window:Some(window),name,automation_id}
            if name.as_ref().is_some_and(|s|!s.trim().is_empty())||
               automation_id.as_ref().is_some_and(|s|!s.trim().is_empty())
            =>window.as_str(),
        _=>return Err("Only named ui_find and ui_discover may use inspection scope; mutation needs Allow once.".into()),
    };
    if w.is_empty()||w.len()>160||w.trim()!=w||
        w.chars().any(|c|c.is_control()){
        return Err("Inspection requires one exact nonempty window title.".into());
    }
    Ok(w)
}
impl Store {
    pub(crate) fn issue(&mut self,task:&str,origin:&str,
        action:&crate::ToolAction,now:u64)->Result<View,String>{
        if !valid_uuid(task)||!valid_uuid(origin)||now==0||
            now.checked_add(TTL_MS).is_none(){
            return Err("Bad task, action or clock for inspection scope.".into());
        }
        let window=window_for(action)?;
        self.scopes.retain(|_,s|now<s.expires&&s.remaining>0);
        if self.scopes.values().any(|s|s.task==task){
            return Err("Cannot issue or enlarge an active task inspection scope.".into());
        }
        if self.scopes.len()>=MAX_SCOPES{
            return Err("Too many active task inspection scopes.".into());
        }
        let id=Uuid::new_v4().to_string();
        let expires=now+TTL_MS;
        self.scopes.insert(id.clone(),Scope{task:task.into(),origin:origin.into(),
            window:window.into(),expires,remaining:MAX_ACTIONS,consumed:HashSet::new(),bound:None});
        Ok(View{id,task_id:task.into(),window:window.into(),
            allowed_tools:vec!["ui_discover".into(),"ui_find".into()],
            expires_at_ms:expires,remaining_actions:MAX_ACTIONS,authorized_paid_requests:0})
    }
    pub(crate) fn consume(&mut self,task:&str,scope:&str,action_id:&str,
        action:&crate::ToolAction,now:u64)->Result<(),String>{
        if !valid_uuid(task)||!valid_uuid(scope)||!valid_uuid(action_id)||now==0{
            return Err("Bad exact inspection action identity.".into());
        }
        let window=window_for(action)?;
        let s=self.scopes.get_mut(scope).ok_or("Inspection scope absent or revoked.")?;
        if s.task!=task||s.window!=window||now>=s.expires||
           s.remaining==0||s.consumed.contains(action_id){
            return Err("Read inspection refused: scope expired, cross-window, duplicate or exhausted.".into());
        }
        s.consumed.insert(action_id.into());
        s.remaining-=1;
        Ok(())
    }
    /// Called by the native executor BEFORE it audits a scoped action as
    /// successful or returns its output to the dashboard / paid AI model.
    /// A recycled HWND, another process with the same title, or even a
    /// mixed batch of observed controls irreversibly revokes this scope.
    pub(crate) fn record_audited_read(&mut self,task:&str,scope:&str,
        action_id:&str,stdout:&str)->Result<(),String>{
        let actual=match observed_identity(stdout){
            Ok(value)=>value,
            Err(error)=>{self.scopes.remove(scope);return Err(error);}
        };
        let verdict=(||{
            let s=self.scopes.get_mut(scope).ok_or("Scope absent or owner revoked.")?;
            if s.task!=task||!s.consumed.contains(action_id){
                return Err("Scoped read is not the exactly dispatched task/action.".to_string());
            }
            if let Some(bound)=&s.bound{
                if bound!=&actual{
                    return Err("Window changed HWND, PID or process generation; scoped read rejected.".into());
                }
            }else{
                if s.origin!=action_id{
                    return Err("Original owner-approved read must bind the OS process before any follow-up.".into());
                }
                s.bound=Some(actual);
            }
            Ok(())
        })();
        if verdict.is_err(){self.scopes.remove(scope);}
        verdict
    }
    pub(crate) fn revoke_task(&mut self,task:&str){
        self.scopes.retain(|_,s|s.task!=task);
    }
    pub(crate) fn revoke_action(&mut self,id:&str){
        self.scopes.retain(|_,s|s.origin!=id&&!s.consumed.contains(id));
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn uuid()->String{Uuid::new_v4().to_string()}
    fn discover(w:&str)->crate::ToolAction{
        crate::ToolAction::UiDiscover{window:w.into()}
    }
    fn find(w:&str)->crate::ToolAction{
        crate::ToolAction::UiFind{name:Some("New Project".into()),automation_id:None,
            window:Some(w.into())}
    }
    #[test]
    fn scoped_ui_read_only_boundaries_and_immutable_task(){
        let mut s=Store::default();let task=uuid();let root=uuid();
        let view=s.issue(&task,&root,&discover("Premiere"),1000).unwrap();
        assert_eq!(view.remaining_actions,8);
        assert_eq!(view.authorized_paid_requests,0);
        assert!(s.issue(&task,&uuid(),&discover("Premiere"),1001).is_err());
        assert!(s.consume(&uuid(),&view.id,&root,&find("Premiere"),1002).is_err());
        assert!(s.consume(&task,&view.id,&root,&find("Blender"),1002).is_err());
        s.consume(&task,&view.id,&root,&discover("Premiere"),1002).unwrap();
        let proof=r#"[{"ObservedWindowHwnd":7717,"ObservedWindowPid":3532,"ObservedWindowProcessStartTicks":"6389134567890"}]"#;
        s.record_audited_read(&task,&view.id,&root,proof).unwrap();
        assert!(s.consume(&task,&view.id,&root,&discover("Premiere"),1003).is_err());
        for _ in 1..8{
            let next=uuid();
            s.consume(&task,&view.id,&next,&find("Premiere"),1003).unwrap();
            s.record_audited_read(&task,&view.id,&next,proof).unwrap();
        }
        assert!(s.consume(&task,&view.id,&uuid(),&find("Premiere"),1003).is_err());
    }
    #[test]
    fn recycled_process_and_malformed_metadata_revoke_scope_before_ai_delivery(){
        let mut store=Store::default();let task=uuid();let first=uuid();
        let view=store.issue(&task,&first,&discover("Shared Window Title"),1000).unwrap();
        store.consume(&task,&view.id,&first,&discover("Shared Window Title"),1001).unwrap();
        let proof=r#"[{"ObservedWindowHwnd":303,"ObservedWindowPid":4400,"ObservedWindowProcessStartTicks":"6389134567890"}]"#;
        store.record_audited_read(&task,&view.id,&first,proof).unwrap();
        let second=uuid();
        store.consume(&task,&view.id,&second,&find("Shared Window Title"),1002).unwrap();
        let recycled=r#"[{"ObservedWindowHwnd":303,"ObservedWindowPid":4400,"ObservedWindowProcessStartTicks":"6389149999999"}]"#;
        assert!(store.record_audited_read(&task,&view.id,&second,recycled).is_err());
        assert!(store.consume(&task,&view.id,&uuid(),&find("Shared Window Title"),1003).is_err());
        let other=store.issue(&task,&uuid(),&discover("Other"),1004).unwrap();
        let id=uuid();
        store.consume(&task,&other.id,&id,&find("Other"),1005).unwrap();
        assert!(store.record_audited_read(&task,&other.id,&id,"[]").is_err());
        assert!(store.consume(&task,&other.id,&uuid(),&find("Other"),1006).is_err());
    }
    #[test]
    fn spoofed_attestation_and_mixed_ui_roots_fail_closed(){
        assert!(observed_identity(r#"[{"ObservedWindowHwnd":22,"ObservedWindowPid":888}]"#).is_err());
        assert!(observed_identity(r#"[{"ObservedWindowHwnd":22,"ObservedWindowPid":888,"ObservedWindowProcessStartTicks":"fake"}]"#).is_err());
        let mixed=r#"[{"ObservedWindowHwnd":22,"ObservedWindowPid":888,"ObservedWindowProcessStartTicks":"1234"},{"ObservedWindowHwnd":23,"ObservedWindowPid":888,"ObservedWindowProcessStartTicks":"1234"}]"#;
        assert!(observed_identity(mixed).is_err());
        assert!(observed_identity(r#"{"ObservedWindowHwnd":22}"#).is_err());
    }
    #[test]
    fn no_mutation_replay_expiry_or_cross_window_scope(){
        let mut s=Store::default();let task=uuid();let origin=uuid();
        let v=s.issue(&task,&origin,&find("Blender"),1000).unwrap();
        assert!(s.consume(&task,&v.id,&uuid(),
            &crate::ToolAction::UiClick{name:Some("Save".into()),
                automation_id:None,window:Some("Blender".into())},1001).is_err());
        assert!(s.consume(&task,&v.id,&uuid(),&discover("Blender"),1000+TTL_MS).is_err());
        s.revoke_action(&origin);
        assert!(s.consume(&task,&v.id,&uuid(),&discover("Blender"),1002).is_err());
        let other=s.issue(&task,&uuid(),&discover("Blender"),1003).unwrap();
        s.revoke_task(&task);
        assert!(s.consume(&task,&other.id,&uuid(),&discover("Blender"),1004).is_err());
        assert!(s.issue(&task,&uuid(),&crate::ToolAction::UiWindows,1004).is_err());
        assert!(s.issue(&task,&uuid(),&discover(""),1004).is_err());
    }
}
