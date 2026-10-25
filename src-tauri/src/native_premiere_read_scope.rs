//! Owner-approved Premiere opening readback delegation.
//! It NEVER delegates launching, UI mutation, model spending or arbitrary IO.
//! Each successor is freshly prepared, audit-bound and scoped to a single task.
use std::collections::{HashMap,HashSet};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;
const TTL_MS:u64=180_000;
const MAX_SCOPES:usize=8;
#[derive(Debug,Clone,PartialEq,Eq)]
struct Identity{title:String,hwnd:u64,pid:u32,start:String}
struct Scope{
 task:String,origin:String,expires:u64,step:u8,pending:Option<String>,
 used:HashSet<String>,bound:Option<Identity>
}
#[derive(Default)]
pub(crate) struct Store{scopes:HashMap<String,Scope>}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct View{
 pub id:String,pub task_id:String,pub allowed_tools:Vec<String>,
 pub expires_at_ms:u64,pub remaining_actions:u8,pub authorized_paid_requests:u8
}
fn uuid(s:&str)->bool{Uuid::parse_str(s).is_ok_and(|u|u.to_string()==s)}
fn title(s:&str)->bool{!s.is_empty()&&s.len()<=160&&s.trim()==s&&!s.chars().any(char::is_control)}
fn identity(stdout:&str)->Result<Identity,String>{
 if stdout.len()>250000{return Err("Premiere window inventory oversized.".into());}
 let value:Value=serde_json::from_str(stdout).map_err(|_|"Premiere window inventory invalid.")?;
 let rows=value.as_array().ok_or("Premiere window inventory must be an array.")?;
 if rows.is_empty()||rows.len()>200{return Err("Premiere window inventory count invalid.".into());}
 let mut selected=None;
 let mut handles=HashSet::new();
 for row in rows {
  let h=row.get("NativeWindowHandle").and_then(Value::as_u64)
   .filter(|n|*n>0).ok_or("Invalid native window handle.")?;
  if !handles.insert(h){return Err("Duplicate HWND in Premiere inventory.".into());}
  let process=row.get("ProcessName").and_then(Value::as_str).unwrap_or("");
  let name=row.get("Name").and_then(Value::as_str).unwrap_or("");
  if !process.to_ascii_lowercase().contains("premiere")||
    !name.to_ascii_lowercase().contains("premiere"){continue;}
  let pid=row.get("ProcessId").and_then(Value::as_u64)
   .filter(|n|*n>0&&*n<=u32::MAX as u64).ok_or("Invalid Premiere OS PID.")? as u32;
  let start=row.get("ProcessStartTicks").and_then(Value::as_str)
   .filter(|s|s.len()<=19&&!s.is_empty()&&s.starts_with(|c:char|('1'..='9').contains(&c))
     &&s.bytes().all(|b|b.is_ascii_digit())).ok_or("Missing Premiere process birth.")?;
  if !title(name){return Err("Ambiguous Premiere window title.".into());}
  if selected.replace(Identity{title:name.into(),hwnd:h,pid,start:start.into()}).is_some(){
   return Err("More than one Premiere window needs owner selection.".into());
  }
 }
 selected.ok_or("No unique OS-attributed Premiere window.".into())
}
fn check_controls(stdout:&str,expected:&Identity)->Result<(),String>{
 if stdout.len()>250000{return Err("UI control observation oversized.".into());}
 let value:Value=serde_json::from_str(stdout).map_err(|_|"UI control observation invalid.")?;
 let rows=value.as_array().ok_or("Control inventory not an array.")?;
 if rows.is_empty()||rows.len()>150{return Err("Control inventory count invalid.".into());}
 let mut observed=HashSet::new();
 for row in rows{
  if row.get("ObservedWindowHwnd").and_then(Value::as_u64)!=Some(expected.hwnd)||
   row.get("ObservedWindowPid").and_then(Value::as_u64)!=Some(expected.pid as u64)||
   row.get("ObservedWindowProcessStartTicks").and_then(Value::as_str)!=Some(expected.start.as_str()){
   return Err("Premiere native root identity changed during scoped inspection.".into());
  }
  let rid=row.get("ControlRuntimeId").and_then(Value::as_array)
   .filter(|r|!r.is_empty()&&r.len()<=64).ok_or("Invalid UI control RuntimeId.")?;
  let mut key=Vec::new();
  for item in rid{
   let n=item.as_i64().filter(|x|*x>=i32::MIN as i64&&*x<=i32::MAX as i64)
    .ok_or("Invalid bounded UIA RuntimeId integer.")?;
   key.push(n);
  }
  if !observed.insert(key){return Err("Duplicate UI control RuntimeId.".into());}
 }
 Ok(())
}
impl Store{
 pub(crate) fn issue(&mut self,task:&str,origin:&str,action:&crate::ToolAction,now:u64)->Result<View,String>{
  if !uuid(task)||!uuid(origin)||now==0||now.checked_add(TTL_MS).is_none()||
   !matches!(action,crate::ToolAction::PremiereLaunch{project:None}){
   return Err("Delegated Premiere readback requires a prepared project-free launch.".into());
  }
  self.scopes.retain(|_,s|now<s.expires&&s.step<2);
  if self.scopes.values().any(|s|s.task==task)||self.scopes.len()>=MAX_SCOPES{
   return Err("Cannot duplicate or enlarge an existing Premiere opening grant.".into());
  }
  let id=Uuid::new_v4().to_string();
  self.scopes.insert(id.clone(),Scope{task:task.into(),origin:origin.into(),
   expires:now+TTL_MS,step:0,pending:None,used:HashSet::new(),bound:None});
  Ok(View{id,task_id:task.into(),allowed_tools:vec!["ui_windows".into(),"ui_discover".into()],
   expires_at_ms:now+TTL_MS,remaining_actions:2,authorized_paid_requests:0})
 }
 pub(crate) fn origin(&self,task:&str,id:&str,now:u64)->Result<String,String>{
  let s=self.scopes.get(id).ok_or("Premiere opening read scope absent.")?;
  if s.task!=task||now>=s.expires||s.step>=2{return Err("Premiere read scope expired or exhausted.".into());}
  Ok(s.origin.clone())
 }
 pub(crate) fn consume(&mut self,task:&str,id:&str,action_id:&str,action:&crate::ToolAction,now:u64)->Result<(),String>{
  if !uuid(task)||!uuid(id)||!uuid(action_id)||now==0{return Err("Invalid read scope identity.".into());}
  let s=self.scopes.get_mut(id).ok_or("Premiere opening read scope absent.")?;
  if s.task!=task||now>=s.expires||s.step>=2||s.pending.is_some()||s.used.contains(action_id){
   return Err("Premiere opening read scope expired, duplicate or already active.".into());
  }
  let allowed=match (s.step,action){
   (0,crate::ToolAction::UiWindows)=>true,
   (1,crate::ToolAction::UiDiscover{window})=>s.bound.as_ref().is_some_and(|w|w.title==*window),
   _=>false
  };
  if !allowed{return Err("Premiere opening scope never authorizes this tool or window.".into());}
  s.pending=Some(action_id.into());s.used.insert(action_id.into());Ok(())
 }
 pub(crate) fn confirm(&mut self,task:&str,id:&str,action_id:&str,stdout:&str)->Result<(),String>{
  let scope=self.scopes.get_mut(id).ok_or("Premiere grant missing.")?;
  let verify=(||{
   if scope.task!=task||scope.pending.as_deref()!=Some(action_id){
    return Err("Scoped native readback did not match its action UUID.".to_string());
   }
   match scope.step{
    0=>{scope.bound=Some(identity(stdout)?);scope.step=1;},
    1=>{check_controls(stdout,scope.bound.as_ref().ok_or("Missing pinned Premiere window.")?)?;
       scope.step=2;},
    _=>return Err("Premiere scope used after completion.".into())
   }
   scope.pending=None;Ok(())
  })();
  if verify.is_err(){self.scopes.remove(id);}
  verify
 }
 pub(crate) fn revoke_task(&mut self,task:&str){self.scopes.retain(|_,s|s.task!=task);}
 pub(crate) fn revoke_action(&mut self,action_id:&str){
  self.scopes.retain(|_,s|s.origin!=action_id&&s.pending.as_deref()!=Some(action_id));
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 fn id()->String{Uuid::new_v4().to_string()}
 fn launch()->crate::ToolAction{crate::ToolAction::PremiereLaunch{project:None}}
 fn snapshot()->String{r#"[{"Name":"Adobe Premiere Pro 2026","ProcessName":"Adobe Premiere Pro","ProcessId":88,"NativeWindowHandle":1090,"ProcessStartTicks":"638962980000000000"}]"#.into()}
 fn controls()->String{r#"[{"ObservedWindowHwnd":1090,"ObservedWindowPid":88,"ObservedWindowProcessStartTicks":"638962980000000000","ControlRuntimeId":[1,2,3]}]"#.into()}
 #[test]
 fn scope_is_project_free_owner_issued_and_allows_two_exact_reads(){
  let task=id();let action=id();let mut s=Store::default();
  let grant=s.issue(&task,&action,&launch(),100).unwrap();
  assert_eq!(grant.remaining_actions,2);
  assert!(s.issue(&task,&id(),&launch(),101).is_err());
  assert!(s.issue(&id(),&id(),&crate::ToolAction::UiWindows,101).is_err());
  assert!(s.consume(&task,&grant.id,&id(),&launch(),101).is_err());
  let window=id();
  s.consume(&task,&grant.id,&window,&crate::ToolAction::UiWindows,101).unwrap();
  assert!(s.consume(&task,&grant.id,&id(),&crate::ToolAction::UiWindows,102).is_err());
  s.confirm(&task,&grant.id,&window,&snapshot()).unwrap();
  let next=id();
  s.consume(&task,&grant.id,&next,&crate::ToolAction::UiDiscover{window:"Adobe Premiere Pro 2026".into()},102).unwrap();
  s.confirm(&task,&grant.id,&next,&controls()).unwrap();
  assert!(s.consume(&task,&grant.id,&id(),&crate::ToolAction::UiWindows,103).is_err());
 }
 #[test]
 fn foreign_app_recycled_window_unknown_or_stop_never_grants_replay(){
  let task=id();let owner=id();let mut s=Store::default();
  let g=s.issue(&task,&owner,&launch(),100).unwrap();
  assert!(s.origin(&id(),&g.id,101).is_err());
  assert!(s.consume(&task,&g.id,&id(),&crate::ToolAction::UiWindows,100+TTL_MS).is_err());
  let first=id();
  s.consume(&task,&g.id,&first,&crate::ToolAction::UiWindows,102).unwrap();
  let false_window=r#"[{"Name":"Premiere","ProcessName":"Notepad","ProcessId":88,"NativeWindowHandle":1090,"ProcessStartTicks":"638962980000000000"}]"#;
  assert!(s.confirm(&task,&g.id,&first,false_window).is_err());
  assert!(s.origin(&task,&g.id,103).is_err());
  let g=s.issue(&task,&owner,&launch(),104).unwrap();s.revoke_task(&task);
  assert!(s.origin(&task,&g.id,105).is_err());
 }
}
