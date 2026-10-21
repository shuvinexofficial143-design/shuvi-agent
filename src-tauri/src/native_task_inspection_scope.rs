//! M1 opt-in native, same-window, READ-ONLY inspection; NEVER authority for
//! mutating UI controls, filesystem actions, model requests or old checkpoints.
use std::collections::{HashMap,HashSet};
use serde::Serialize;
use uuid::Uuid;
const TTL_MS:u64=180_000;
const MAX_ACTIONS:u8=8;
const MAX_SCOPES:usize=8;
#[derive(Clone)]
struct Scope{
    task:String,origin:String,window:String,expires:u64,remaining:u8,
    consumed:HashSet<String>,
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
            window:window.into(),expires,remaining:MAX_ACTIONS,consumed:HashSet::new()});
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
        assert!(s.consume(&task,&view.id,&root,&discover("Premiere"),1003).is_err());
        for _ in 1..8{s.consume(&task,&view.id,&uuid(),&find("Premiere"),1003).unwrap();}
        assert!(s.consume(&task,&view.id,&uuid(),&find("Premiere"),1003).is_err());
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
