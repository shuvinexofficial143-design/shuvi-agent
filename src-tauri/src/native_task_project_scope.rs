//! Shuvi42 owner-granted, immutable selected-project root inventory scope.
//! No content reads, mutations, shell, arbitrary child roots, or AI billings.
use serde::Serialize;
use std::{collections::{HashMap,HashSet},fs,path::{Component,Path,PathBuf}};
use uuid::Uuid;
const TTL_MS:u64=180_000;
const MAX_READS:u8=8;
const MAX_SCOPES:usize=8;
struct Grant{
 task:String,origin:String,root:PathBuf,expires:u64,remaining:u8,used:HashSet<String>,
}
#[derive(Default)]
pub(crate) struct Store{
 active:HashMap<String,Grant>,
 // Expired and spent task grants require a fresh explicit owner revoke
 // instead of a silent new grant while continuing an old task.
 retired_tasks:HashSet<String>,
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct View{
 pub id:String,pub task_id:String,pub exact_path:String,pub allowed_tools:Vec<String>,
 pub expires_at_ms:u64,pub remaining_actions:u8,pub authorized_paid_requests:u8,
}
fn valid_uuid(s:&str)->bool{
 Uuid::parse_str(s).map(|u|u.to_string()==s).unwrap_or(false)
}
fn action_root(action:&crate::ToolAction)->Result<&str,String>{
 match action{
  crate::ToolAction::ListDirectory{path}|
  crate::ToolAction::WorkspaceScan{path}=>Ok(path),
  _=>Err("Owner project inventory grant authorizes only list_directory and workspace_scan.".into()),
 }
}
fn selected_root(path:&str,workspace:&str)->Result<PathBuf,String>{
 if path.is_empty()||workspace.is_empty()||path.trim()!=path||
    workspace.trim()!=workspace||path.chars().any(char::is_control)||
    workspace.chars().any(char::is_control){
  return Err("Invalid project inventory root.".into());
 }
 let requested=Path::new(path);let selected=Path::new(workspace);
 if requested.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir))||
    selected.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)){
  return Err("Project root cannot use relative traversal components.".into());
 }
 if !requested.is_absolute()||!selected.is_absolute(){
  return Err("Project root must be absolute.".into());
 }
 let metadata=fs::symlink_metadata(requested).map_err(|_|"Project root missing.")?;
 let owner_metadata=fs::symlink_metadata(selected).map_err(|_|"Selected owner workspace missing.")?;
 if metadata.file_type().is_symlink()||owner_metadata.file_type().is_symlink()||
    !metadata.is_dir()||!owner_metadata.is_dir(){
  return Err("Project scope refuses symlink root or non-directory.".into());
 }
 // Symlinked ancestor directories on Unix and Windows reparse points on
 // Windows can redirect the owner-selected root even when its last component
 // is an ordinary directory. Check every ancestor before accepting a grant.
 for ancestor in requested.ancestors().chain(selected.ancestors()){
  let meta=fs::symlink_metadata(ancestor)
   .map_err(|_|"Project root ancestor cannot be inspected.")?;
  if meta.file_type().is_symlink()||!meta.is_dir(){
   return Err("Project inventory refuses redirected or missing root ancestors.".into());
  }
  #[cfg(windows)]
  {
   use std::os::windows::fs::MetadataExt;
   if meta.file_attributes()&0x400!=0{
    return Err("Project inventory refuses Windows junction/reparse ancestors.".into());
   }
  }
 }
 let actual=requested.canonicalize().map_err(|_|"Inventory target cannot be canonicalized.")?;
 let bound=selected.canonicalize().map_err(|_|"Owner workspace cannot be canonicalized.")?;
 if actual!=bound{
  return Err("Inventory must target EXACT selected owner workspace root, not a child or sibling.".into());
 }
 Ok(bound)
}
impl Store{
 pub(crate) fn issue(&mut self,task:&str,origin:&str,action:&crate::ToolAction,
  workspace:&str,now:u64)->Result<View,String>{
  if !valid_uuid(task)||!valid_uuid(origin)||now==0||now.checked_add(TTL_MS).is_none(){
   return Err("Project grant identity or clock invalid.".into());
  }
  let path=action_root(action)?;
  let root=selected_root(path,workspace)?;
  let retired:Vec<String>=self.active.values()
   .filter(|x|x.expires<=now||x.remaining==0)
   .map(|x|x.task.clone()).collect();
  self.retired_tasks.extend(retired);
  self.active.retain(|_,x|x.expires>now&&x.remaining>0);
  if self.retired_tasks.contains(task){
   return Err("Expired project grant needs an explicit owner revoke before reauthorization.".into());
  }
  if self.active.values().any(|x|x.task==task){
   return Err("A task cannot enlarge or reissue an existing project grant.".into());
  }
  if self.active.len()>=MAX_SCOPES{
   return Err("Active project inventory grant capacity exhausted.".into());
  }
  let id=Uuid::new_v4().to_string();let expires=now+TTL_MS;
  self.active.insert(id.clone(),Grant{task:task.into(),origin:origin.into(),
   root,expires,remaining:MAX_READS,used:HashSet::new()});
  Ok(View{id,task_id:task.into(),exact_path:path.into(),
   allowed_tools:vec!["list_directory".into(),"workspace_scan".into()],
   expires_at_ms:expires,remaining_actions:MAX_READS,authorized_paid_requests:0})
 }
 pub(crate) fn consume(&mut self,task:&str,id:&str,action_id:&str,
  action:&crate::ToolAction,workspace:&str,now:u64)->Result<(),String>{
  if !valid_uuid(task)||!valid_uuid(id)||!valid_uuid(action_id)||now==0{
   return Err("Invalid project inventory dispatch identity.".into());
  }
  let root=selected_root(action_root(action)?,workspace)?;
  let grant=self.active.get_mut(id).ok_or("No current project inventory authority.")?;
  if grant.task!=task||grant.root!=root||now>=grant.expires||
     grant.remaining==0||grant.used.contains(action_id){
   return Err("Project inventory task, target, expiry or action mismatch.".into());
  }
  grant.used.insert(action_id.into());grant.remaining-=1;
  Ok(())
 }
 pub(crate) fn confirm(&mut self,task:&str,id:&str,
  action_id:&str,workspace:&str)->Result<(),String>{
  let actual=selected_root(workspace,workspace);
  let verdict=(||{
   let root=actual?;
   let grant=self.active.get(id).ok_or("Project grant revoked.")?;
   if grant.task!=task||grant.root!=root||!grant.used.contains(action_id){
    return Err("Selected workspace root changed during native inspection.".into());
   }
   Ok(())
  })();
  if verdict.is_err(){self.active.remove(id);}
  verdict
 }
 pub(crate) fn revoke_task(&mut self,task:&str){
  self.active.retain(|_,x|x.task!=task);
  self.retired_tasks.remove(task);
 }
 pub(crate) fn revoke_action(&mut self,action:&str){
  self.active.retain(|_,x|x.origin!=action&&!x.used.contains(action));
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 fn id()->String{Uuid::new_v4().to_string()}
 fn listing(s:&str)->crate::ToolAction{crate::ToolAction::ListDirectory{path:s.into()}}
 fn scan(s:&str)->crate::ToolAction{crate::ToolAction::WorkspaceScan{path:s.into()}}
 #[test]
 fn only_root_eight_actions_and_no_duplicate(){
  let root=std::env::temp_dir().join(format!("shuvi-project-{}",id()));
  fs::create_dir_all(root.join("inside")).unwrap();
  let path=root.to_str().unwrap();
  let mut s=Store::default();let task=id();let origin=id();
  let v=s.issue(&task,&origin,&listing(path),path,1000).unwrap();
  assert_eq!(v.remaining_actions,8);assert_eq!(v.authorized_paid_requests,0);
  assert!(s.issue(&task,&id(),&scan(path),path,1001).is_err());
  assert!(s.consume(&id(),&v.id,&id(),&scan(path),path,1001).is_err());
  assert!(s.consume(&task,&v.id,&id(),
   &listing(root.join("inside").to_str().unwrap()),path,1001).is_err());
  for i in 0..8{
   let action=if i==0{origin.clone()}else{id()};
   s.consume(&task,&v.id,&action,&scan(path),path,1002).unwrap();
   s.confirm(&task,&v.id,&action,path).unwrap();
   assert!(s.consume(&task,&v.id,&action,&scan(path),path,1002).is_err());
  }
  assert!(s.consume(&task,&v.id,&id(),&listing(path),path,1003).is_err());
  fs::remove_dir_all(root).unwrap();
 }
 #[test]
 fn no_mutating_tools_no_cross_workspace_or_expired_permission(){
  let p=std::env::temp_dir().join(format!("shuvi-project-{}",id()));
  let q=std::env::temp_dir().join(format!("shuvi-project-{}",id()));
  fs::create_dir_all(&p).unwrap();fs::create_dir_all(&q).unwrap();
  let a=p.to_str().unwrap();let b=q.to_str().unwrap();let task=id();let origin=id();
  let mut s=Store::default();let v=s.issue(&task,&origin,&scan(a),a,1000).unwrap();
  assert!(s.consume(&task,&v.id,&id(),&listing(a),b,1001).is_err());
  assert!(s.consume(&task,&v.id,&id(),&crate::ToolAction::ReadFile{path:a.into()},a,1001).is_err());
  assert!(s.consume(&task,&v.id,&id(),&crate::ToolAction::UiWindows,a,1001).is_err());
  assert!(s.consume(&task,&v.id,&id(),&listing(a),a,1000+TTL_MS).is_err());
  s.revoke_action(&origin);
  assert!(s.consume(&task,&v.id,&id(),&listing(a),a,1002).is_err());
  fs::remove_dir_all(p).unwrap();fs::remove_dir_all(q).unwrap();
 }
 #[test]
 fn expired_or_spent_grant_needs_explicit_owner_revoke_before_reissue(){
  let root=std::env::temp_dir().join(format!("shuvi-project-{}",id()));
  fs::create_dir_all(&root).unwrap();let path=root.to_str().unwrap();
  let mut s=Store::default();let task=id();let origin=id();
  let grant=s.issue(&task,&origin,&listing(path),path,1000).unwrap();
  assert!(s.issue(&task,&id(),&listing(path),path,1000+TTL_MS).is_err());
  assert!(s.issue(&task,&id(),&listing(path),path,1000+TTL_MS+1).is_err());
  s.revoke_task(&task);
  let second=s.issue(&task,&id(),&scan(path),path,1000+TTL_MS+2).unwrap();
  for _ in 0..8{
   s.consume(&task,&second.id,&id(),&scan(path),path,1000+TTL_MS+3).unwrap();
  }
  assert!(s.issue(&task,&id(),&scan(path),path,1000+TTL_MS+4).is_err());
  s.revoke_task(&task);
  assert!(s.issue(&task,&id(),&scan(path),path,1000+TTL_MS+5).is_ok());
  assert_ne!(grant.id,second.id);
  fs::remove_dir_all(root).unwrap();
 }
 #[cfg(unix)]
 #[test]
 fn selected_project_refuses_symlinked_ancestor_even_if_root_is_real_directory(){
  use std::os::unix::fs::symlink;
  let parent=std::env::temp_dir().join(format!("shuvi-project-{}",id()));
  let real=parent.join("real");let alias=parent.join("redirect");
  fs::create_dir_all(real.join("project")).unwrap();
  symlink(&real,&alias).unwrap();
  let redirected=alias.join("project").to_string_lossy().into_owned();
  let mut s=Store::default();let task=id();let origin=id();
  assert!(s.issue(&task,&origin,&listing(&redirected),&redirected,1000).is_err());
  fs::remove_dir_all(parent).unwrap();
 }

}
