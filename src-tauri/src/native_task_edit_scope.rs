//! Shuvi42 M1: opt-in, in-memory, exact-file task editing scope.
//! Never a read grant, paid model permission, or blanket Windows automation.
//! A native owner click must nominate an already PREPARED filesystem action.
use serde::Serialize;
use std::{collections::{HashMap, HashSet},fs,path::{Component,Path,PathBuf}};
use uuid::Uuid;

const TTL_MS:u64=10*60*1000;
const MAX_ACTIONS:u8=4;
const MAX_SCOPES:usize=8;
const ALLOWED:&[&str]=&["write_file","replace_text"];
const EXTENSIONS:&[&str]=&["txt","md","json","css","html","js","ts","jsx","tsx"];

#[derive(Clone)]
struct Scope {
    task_id:String,
    tool:String,
    exact_file:PathBuf,
    expires_at_ms:u64,
    remaining:u8,
    dispatched:HashSet<String>,
}
#[derive(Default)]
pub(crate) struct TaskEditScopeStore {
    scopes:HashMap<String,Scope>,
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct EditScopeView {
    pub id:String,
    pub task_id:String,
    pub app:String,
    pub project_root:String,
    pub exact_path:String,
    pub allowed_tools:Vec<String>,
    pub expires_at_ms:u64,
    pub remaining_actions:u8,
    pub authorized_paid_requests:u8,
}
fn valid_uuid(id:&str)->bool{
    Uuid::parse_str(id).map(|u|u.to_string()==id).unwrap_or(false)
}
fn redirected(meta:&fs::Metadata)->bool{
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.is_symlink() || meta.file_attributes()&0x400!=0
    }
    #[cfg(not(windows))]
    {meta.file_type().is_symlink()}
}
fn checked_file(raw:&str)->Result<PathBuf,String>{
    if raw.is_empty() || raw.len()>2048 || raw.chars().any(|c|c=='\0'||c=='\r'||c=='\n'){
        return Err("Scoped edit path is invalid.".into());
    }
    let path=Path::new(raw);
    if !path.is_absolute() ||
        path.components().any(|c|matches!(c,Component::CurDir|Component::ParentDir)){
        return Err("Scoped edit requires an absolute unambiguous file path.".into());
    }
    let extension=path.extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()){
        return Err("This file type requires a separate Allow once approval.".into());
    }
    for segment in path.components(){
        let component=segment.as_os_str().to_string_lossy().to_ascii_lowercase();
        if [".git",".ssh","node_modules",".shuvi-release"].contains(&component.as_str()){
            return Err("Protected internal directory cannot be task-scoped.".into());
        }
    }
    // Check every existing parent before canonicalization; do not silently
    // follow a junction, symlink or other Windows reparse point.
    let parent=path.parent().ok_or("Scoped edit has no parent folder.")?;
    for ancestor in parent.ancestors(){
        let meta=fs::symlink_metadata(ancestor)
            .map_err(|_|"Cannot inspect exact scoped project parent.")?;
        if !meta.is_dir() || redirected(&meta){
            return Err("Scoped project ancestor is redirected or not a directory.".into());
        }
    }
    let root=fs::canonicalize(parent)
        .map_err(|_|"Scoped project folder is inaccessible.")?;
    let filename=path.file_name().ok_or("Scoped edit has no filename.")?;
    let checked=root.join(filename);
    match fs::symlink_metadata(&checked){
        Ok(meta) if meta.is_file()&&!redirected(&meta)=>{},
        Ok(_)=>return Err("Scoped edit target cannot be a junction, symlink or non-file.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
        Err(_)=>return Err("Scoped edit target cannot be inspected.".into()),
    }
    Ok(checked)
}
impl TaskEditScopeStore{
    fn prune(&mut self,now:u64){
        self.scopes.retain(|_,s|now<s.expires_at_ms&&s.remaining>0);
    }
    pub(crate) fn issue(&mut self,task_id:&str,action_id:&str,
        tool:&str,path:&str,now:u64)->Result<EditScopeView,String>{
        if !valid_uuid(task_id)||!valid_uuid(action_id)||now==0||
            now.checked_add(TTL_MS).is_none()||!ALLOWED.contains(&tool){
            return Err("Task editing scope requires an exact prepared, eligible action.".into());
        }
        let exact_file=checked_file(path)?;
        self.prune(now);
        if self.scopes.len()>=MAX_SCOPES{return Err("Too many unexpired task scopes.".into());}
        let id=Uuid::new_v4().to_string();
        let project_root=exact_file.parent().ok_or("Scoped edit has no project folder.")?;
        let view=EditScopeView{
            id:id.clone(),task_id:task_id.to_owned(),app:"filesystem".into(),
            project_root:project_root.to_string_lossy().into_owned(),
            exact_path:exact_file.to_string_lossy().into_owned(),
            allowed_tools:vec![tool.to_owned()],
            expires_at_ms:now+TTL_MS,remaining_actions:MAX_ACTIONS,
            authorized_paid_requests:0,
        };
        self.scopes.insert(id,Scope{task_id:task_id.into(),tool:tool.into(),
            exact_file,expires_at_ms:now+TTL_MS,
            remaining:MAX_ACTIONS,dispatched:HashSet::new()});
        Ok(view)
    }
    /// Called under the existing native execution/pending locks BEFORE durable
    /// worker start. Grant ID alone has no power to change tool or path.
    pub(crate) fn consume(&mut self,task_id:&str,scope_id:&str,action_id:&str,
        tool:&str,path:&str,now:u64)->Result<(),String>{
        if !valid_uuid(task_id)||!valid_uuid(scope_id)||!valid_uuid(action_id)||now==0||
            !ALLOWED.contains(&tool){
            return Err("Invalid task editing authority.".into());
        }
        self.prune(now);
        let s=self.scopes.get_mut(scope_id)
            .ok_or("Task edit scope missing, expired, revoked or exhausted.")?;
        if s.task_id!=task_id||s.tool!=tool||s.remaining==0||
            now>=s.expires_at_ms||s.dispatched.contains(action_id){
            return Err("Scoped edit does not match task/tool or repeats a dispatched action.".into());
        }
        let checked=checked_file(path)?;
        if checked!=s.exact_file{
            return Err("Scoped edit target is outside the exact owner-approved file.".into());
        }
        s.dispatched.insert(action_id.to_owned());
        s.remaining-=1;
        Ok(())
    }
    pub(crate) fn revoke_task(&mut self,task_id:&str){
        self.scopes.retain(|_,s|s.task_id!=task_id);
    }
    pub(crate) fn revoke_action(&mut self,action_id:&str){
        self.scopes.retain(|_,s|!s.dispatched.contains(action_id));
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(PathBuf,String){
        let p=std::env::temp_dir().join(format!("shuvi42-scope-{}",Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        let file=p.join("project.md").to_string_lossy().into_owned();
        (p,file)
    }
    #[test]
    fn scoped_file_one_tool_one_task_expiry_revoke_and_no_duplicate(){
        let (dir,path)=fixture();let task=Uuid::new_v4().to_string();
        let prepared=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let grant=store.issue(&task,&prepared,"write_file",&path,10).unwrap();
        assert_eq!(grant.app,"filesystem");assert_eq!(grant.authorized_paid_requests,0);
        assert_eq!(grant.allowed_tools,vec!["write_file"]);
        assert!(store.consume(&Uuid::new_v4().to_string(),&grant.id,&prepared,"write_file",&path,11).is_err());
        assert!(store.consume(&task,&grant.id,&prepared,"replace_text",&path,11).is_err());
        let other=dir.join("other.md").to_string_lossy().into_owned();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&other,11).is_err());
        store.consume(&task,&grant.id,&prepared,"write_file",&path,11).unwrap();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&path,12).is_err());
        let second=Uuid::new_v4().to_string();
        store.consume(&task,&grant.id,&second,"write_file",&path,12).unwrap();
        store.revoke_task(&task);
        assert!(store.consume(&task,&grant.id,&Uuid::new_v4().to_string(),"write_file",&path,13).is_err());
        let grant=store.issue(&task,&prepared,"write_file",&path,100).unwrap();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&path,100+TTL_MS).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn never_scope_shell_export_git_push_or_unsafe_target(){
        let (dir,path)=fixture();let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        for op in ["powershell","git_push","ui_click","run_project_task","browser_dom_click","apply_patch"] {
            assert!(store.issue(&t,&a,op,&path,100).is_err());
        }
        let escaped=dir.join("..").join("other.md").to_string_lossy().into_owned();
        assert!(store.issue(&t,&a,"write_file",&escaped,100).is_err());
        assert!(store.issue(&t,&a,"write_file",&dir.join(".env").to_string_lossy(),100).is_err());
        let hidden=dir.join("linked.md");
        #[cfg(unix)] {
            std::os::unix::fs::symlink(dir.join("project.md"),&hidden).unwrap();
            assert!(store.issue(&t,&a,"write_file",&hidden.to_string_lossy(),100).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stop_revokes_entire_scope_without_unknown_worker_replay(){
        let (dir,path)=fixture();let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let view=store.issue(&t,&a,"write_file",&path,100).unwrap();
        store.consume(&t,&view.id,&a,"write_file",&path,101).unwrap();
        store.revoke_action(&a);
        assert!(store.consume(&t,&view.id,&Uuid::new_v4().to_string(),"write_file",&path,102).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
