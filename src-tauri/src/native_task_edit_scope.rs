//! Shuvi42 M1: opt-in, in-memory, exact-file task editing scope.
//! Never a read grant, paid model permission, or blanket Windows automation.
//! A native owner click must nominate an already PREPARED filesystem action.
use serde::Serialize;
use sha2::{Digest,Sha256};
use std::{collections::{HashMap, HashSet},fs,io::Read,path::{Component,Path,PathBuf}};
use uuid::Uuid;

const TTL_MS:u64=10*60*1000;
const MAX_ACTIONS:u8=4;
const MAX_SCOPES:usize=8;
const MAX_SNAPSHOT_BYTES:u64=2_097_152;
const ALLOWED:&[&str]=&["write_file","replace_text"];
const EXTENSIONS:&[&str]=&["txt","md","json","css","html","js","ts","jsx","tsx"];

#[derive(Clone)]
struct Scope {
    task_id:String,
    origin_action_id:String,
    tool:String,
    exact_file:PathBuf,
    workspace:PathBuf,
    file_snapshot:Option<([u8;32],u64)>,
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
    // Windows streams/device aliases are not ordinary files; reject these
    // spellings before any canonicalization or creation can occur.
    for part in path.components().filter_map(|c|match c {Component::Normal(n)=>Some(n),_=>None}){
        let segment=part.to_string_lossy();
        if segment.ends_with(' ')||segment.ends_with('.')||segment.contains(':'){
            return Err("Scoped edit forbids Windows stream or ambiguous filename.".into());
        }
        let stem=segment.split('.').next().unwrap_or("").to_ascii_lowercase();
        if matches!(stem.as_str(),"con"|"prn"|"aux"|"nul"|
            "com1"|"com2"|"com3"|"com4"|"com5"|"com6"|"com7"|"com8"|"com9"|
            "lpt1"|"lpt2"|"lpt3"|"lpt4"|"lpt5"|"lpt6"|"lpt7"|"lpt8"|"lpt9"){
            return Err("Scoped edit forbids reserved Windows device filename.".into());
        }
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_))){
            return Err("Scoped edits require a local drive, never UNC or device namespace.".into());
        }
    }
    let extension=path.extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
    let leaf=path.file_name().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
    let stem=path.file_stem().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
    // Owner-delegated editing cannot silently rewrite security/auth/payment
    // code, package scripts, deployment settings or credential files. Those
    // remain separately reviewable with the ordinary one-action approval.
    if leaf.starts_with(".env")||
       ["package.json","package-lock.json","pnpm-lock.yaml","yarn.lock",
        "next.config.js","next.config.ts","vite.config.ts","vite.config.js",
        "tsconfig.json","vercel.json","netlify.toml","wrangler.json",
        "wrangler.jsonc"].contains(&leaf.as_str())||
       ["auth","authentication","authorization","security","permission",
        "permissions","billing","payment","payments","checkout","secret",
        "secrets","credential","credentials","private_key","token","tokens",
        "oauth","middleware","policy","policies"].contains(&stem.as_str()){
        return Err("Sensitive project configuration, identity or payment file needs a separate Allow once.".into());
    }
    if !EXTENSIONS.contains(&extension.as_str()){
        return Err("This file type requires a separate Allow once approval.".into());
    }
    for segment in path.components(){
        let component=segment.as_os_str().to_string_lossy().to_ascii_lowercase();
        if [".git",".github",".husky",".ssh",".aws",".azure",".vscode",
            "node_modules",".shuvi-release","secrets","credentials",
            "certificates","private_keys"].contains(&component.as_str()){
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
fn checked_workspace(raw:&str)->Result<PathBuf,String>{
    if raw.is_empty()||raw.len()>2048||raw.chars().any(|c|c.is_control()){
        return Err("Selected workspace path is missing or invalid.".into());
    }
    let path=Path::new(raw);
    if !path.is_absolute()||path.components().any(|c|matches!(c,Component::CurDir|Component::ParentDir)){
        return Err("Selected workspace must be an unambiguous absolute project directory.".into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_))){
            return Err("Task scope workspace must use a local drive.".into());
        }
    }
    for ancestor in path.ancestors(){
        let meta=fs::symlink_metadata(ancestor)
            .map_err(|_|"Cannot inspect selected workspace ancestor.")?;
        if !meta.is_dir()||redirected(&meta){
            return Err("Selected workspace cannot include a symlink or junction.".into());
        }
    }
    let canonical=fs::canonicalize(path).map_err(|_|"Selected workspace unavailable.")?;
    // Never allow a drive/filesystem root to be a task editing project.
    if canonical.parent().is_none(){
        return Err("Filesystem root is too broad for autonomous editing.".into());
    }
    Ok(canonical)
}
// A file approved before a later outside editor change must not be silently
// overwritten under a ten-minute scope. This is an observation, NOT proof
// of a successful edit; authoritative success still comes from native audit.
fn snapshot(path:&Path)->Result<Option<([u8;32],u64)>,String>{
    let meta=match fs::symlink_metadata(path){
        Ok(meta)=>meta,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
        Err(_)=>return Err("Scoped file snapshot cannot be inspected.".into()),
    };
    if !meta.is_file()||redirected(&meta)||meta.len()>MAX_SNAPSHOT_BYTES{
        return Err("Scoped file must be an ordinary bounded text file.".into());
    }
    let file=fs::File::open(path).map_err(|_|"Scoped file cannot be opened for fingerprint.")?;
    let mut bytes=Vec::new();
    file.take(MAX_SNAPSHOT_BYTES+1).read_to_end(&mut bytes)
        .map_err(|_|"Scoped file fingerprint read failed.")?;
    if bytes.len() as u64>MAX_SNAPSHOT_BYTES{
        return Err("Scoped file fingerprint exceeded text-edit size budget.".into());
    }
    let sha:[u8;32]=Sha256::digest(&bytes).into();
    Ok(Some((sha,bytes.len() as u64)))
}
/// A string UUID from the renderer is never sufficient to issue editing
/// authority. Match the latest fsynced native task+action checkpoint first.
pub(crate) fn owner_checkpoint_allows(
    record:Option<&crate::native_recovery::NativeRecoveryRecord>,
    task_id:&str,action_id:&str,phase:&str,now:u64,
)->Result<(),String>{
    if !valid_uuid(task_id)||!valid_uuid(action_id)||
       !matches!(phase,"awaiting_approval"|"executing")||now==0{
        return Err("Invalid owner task scope checkpoint request.".into());
    }
    let r=record.ok_or("Rust owner task journal missing; editing scope denied.")?;
    if r.version!=2||r.revision.is_none()||
       r.task_id.as_deref()!=Some(task_id)||
       r.action_id.as_deref()!=Some(action_id)||
       r.phase!=phase||
       r.model_requests==0||r.staged_actions==0||
       now>=r.expires_at{
        return Err("Native task scope does not match the latest owner-approved action phase.".into());
    }
    Ok(())
}
impl TaskEditScopeStore{
    fn prune(&mut self,now:u64){
        self.scopes.retain(|_,s|now<s.expires_at_ms&&s.remaining>0);
    }
    pub(crate) fn issue(&mut self,task_id:&str,action_id:&str,
        tool:&str,path:&str,workspace:&str,now:u64)->Result<EditScopeView,String>{
        if !valid_uuid(task_id)||!valid_uuid(action_id)||now==0||
            now.checked_add(TTL_MS).is_none()||!ALLOWED.contains(&tool){
            return Err("Task editing scope requires an exact prepared, eligible action.".into());
        }
        let exact_file=checked_file(path)?;
        let selected_workspace=checked_workspace(workspace)?;
        let file_snapshot=snapshot(&exact_file)?;
        if !exact_file.starts_with(&selected_workspace){
            return Err("Exact edit file is outside the owner-selected project.".into());
        }
        self.prune(now);
        if self.scopes.values().any(|scope|scope.task_id==task_id){
            return Err("This task already owns an immutable editing scope; owner must revoke it before new authorization.".into());
        }
        if self.scopes.len()>=MAX_SCOPES{return Err("Too many unexpired task scopes.".into());}
        let id=Uuid::new_v4().to_string();
        let project_root=&selected_workspace;
        let view=EditScopeView{
            id:id.clone(),task_id:task_id.to_owned(),app:"filesystem".into(),
            project_root:project_root.to_string_lossy().into_owned(),
            exact_path:exact_file.to_string_lossy().into_owned(),
            allowed_tools:vec![tool.to_owned()],
            expires_at_ms:now+TTL_MS,remaining_actions:MAX_ACTIONS,
            authorized_paid_requests:0,
        };
        self.scopes.insert(id,Scope{task_id:task_id.into(),origin_action_id:action_id.into(),tool:tool.into(),
            exact_file,workspace:selected_workspace,file_snapshot,expires_at_ms:now+TTL_MS,
            remaining:MAX_ACTIONS,dispatched:HashSet::new()});
        Ok(view)
    }
    /// Called under the existing native execution/pending locks BEFORE durable
    /// worker start. Grant ID alone has no power to change tool or path.
    pub(crate) fn consume(&mut self,task_id:&str,scope_id:&str,action_id:&str,
        tool:&str,path:&str,workspace:&str,now:u64)->Result<(),String>{
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
        let selected_workspace=checked_workspace(workspace)?;
        if selected_workspace!=s.workspace||checked!=s.exact_file ||
            !checked.starts_with(&selected_workspace){
            return Err("Scoped edit target is outside the exact owner-approved file.".into());
        }
        if snapshot(&checked)?!=s.file_snapshot{
            return Err("Scoped file changed after authorization; refresh owner approval.".into());
        }
        s.dispatched.insert(action_id.to_owned());
        s.remaining-=1;
        Ok(())
    }
    /// Only after the caller recorded the exact successful native audit may
    /// the file fingerprint advance for a DIFFERENT, newly prepared action.
    /// If file readback fails the scope remains bound to its old fingerprint.
    pub(crate) fn record_audited_success(&mut self,task_id:&str,scope_id:&str,
        action_id:&str,path:&str,workspace:&str)->Result<(),String>{
        let scope=self.scopes.get_mut(scope_id)
            .ok_or("Previously issued edit scope is no longer active.")?;
        if scope.task_id!=task_id||!scope.dispatched.contains(action_id){
            return Err("Cannot advance edit scope without its exact execution identity.".into());
        }
        let checked=checked_file(path)?;
        let selected_workspace=checked_workspace(workspace)?;
        if checked!=scope.exact_file||selected_workspace!=scope.workspace{
            return Err("Audited edit scope file or project changed.".into());
        }
        scope.file_snapshot=snapshot(&checked)?;
        Ok(())
    }
    pub(crate) fn revoke_task(&mut self,task_id:&str){
        self.scopes.retain(|_,s|s.task_id!=task_id);
    }
    pub(crate) fn revoke_action(&mut self,action_id:&str){
        self.scopes.retain(|_,s|s.origin_action_id!=action_id&&
            !s.dispatched.contains(action_id));
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
        let grant=store.issue(&task,&prepared,"write_file",&path,&dir.to_string_lossy(),10).unwrap();
        assert_eq!(grant.app,"filesystem");assert_eq!(grant.authorized_paid_requests,0);
        assert_eq!(grant.allowed_tools,vec!["write_file"]);
        assert!(store.consume(&Uuid::new_v4().to_string(),&grant.id,&prepared,"write_file",&path,&dir.to_string_lossy(),11).is_err());
        assert!(store.consume(&task,&grant.id,&prepared,"replace_text",&path,&dir.to_string_lossy(),11).is_err());
        let other=dir.join("other.md").to_string_lossy().into_owned();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&other,&dir.to_string_lossy(),11).is_err());
        store.consume(&task,&grant.id,&prepared,"write_file",&path,&dir.to_string_lossy(),11).unwrap();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&path,&dir.to_string_lossy(),12).is_err());
        let second=Uuid::new_v4().to_string();
        store.record_audited_success(&task,&grant.id,&prepared,&path,&dir.to_string_lossy()).unwrap();
        store.consume(&task,&grant.id,&second,"write_file",&path,&dir.to_string_lossy(),12).unwrap();
        store.revoke_task(&task);
        assert!(store.consume(&task,&grant.id,&Uuid::new_v4().to_string(),"write_file",&path,&dir.to_string_lossy(),13).is_err());
        let grant=store.issue(&task,&prepared,"write_file",&path,&dir.to_string_lossy(),100).unwrap();
        assert!(store.consume(&task,&grant.id,&prepared,"write_file",&path,&dir.to_string_lossy(),100+TTL_MS).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn never_scope_shell_export_git_push_or_unsafe_target(){
        let (dir,path)=fixture();let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        for op in ["powershell","git_push","ui_click","run_project_task","browser_dom_click","apply_patch"] {
            assert!(store.issue(&t,&a,op,&path,&dir.to_string_lossy(),100).is_err());
        }
        let escaped=dir.join("..").join("other.md").to_string_lossy().into_owned();
        assert!(store.issue(&t,&a,"write_file",&escaped,&dir.to_string_lossy(),100).is_err());
        assert!(store.issue(&t,&a,"write_file",&dir.join(".env").to_string_lossy(),&dir.to_string_lossy(),100).is_err());
        let hidden=dir.join("linked.md");
        #[cfg(unix)] {
            std::os::unix::fs::symlink(dir.join("project.md"),&hidden).unwrap();
            assert!(store.issue(&t,&a,"write_file",&hidden.to_string_lossy(),&dir.to_string_lossy(),100).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn denial_of_original_prepared_action_revokes_scope_before_any_dispatch(){
        let (dir,path)=fixture();
        let task=Uuid::new_v4().to_string();let origin=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let grant=store.issue(&task,&origin,"write_file",&path,&dir.to_string_lossy(),100).unwrap();
        store.revoke_action(&origin);
        assert!(store.consume(&task,&grant.id,&origin,"write_file",&path,&dir.to_string_lossy(),101).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn owner_journal_identity_phase_and_deadline_are_required(){
        let id=Uuid::new_v4().to_string();let action=Uuid::new_v4().to_string();
        let record=crate::native_recovery::NativeRecoveryRecord{
            version:2,task_id:Some(id.clone()),revision:Some(3),max_actions:8,
            staged_actions:1,model_requests:1,expires_at:10_000,updated_at:100,
            phase:"awaiting_approval".into(),action_id:Some(action.clone()),
        };
        assert!(owner_checkpoint_allows(Some(&record),&id,&action,"awaiting_approval",200).is_ok());
        assert!(owner_checkpoint_allows(Some(&record),&Uuid::new_v4().to_string(),&action,"awaiting_approval",200).is_err());
        assert!(owner_checkpoint_allows(Some(&record),&id,&Uuid::new_v4().to_string(),"awaiting_approval",200).is_err());
        assert!(owner_checkpoint_allows(Some(&record),&id,&action,"executing",200).is_err());
        assert!(owner_checkpoint_allows(Some(&record),&id,&action,"awaiting_approval",10_000).is_err());
        assert!(owner_checkpoint_allows(None,&id,&action,"awaiting_approval",200).is_err());
    }
    #[test]
    fn stop_revokes_entire_scope_without_unknown_worker_replay(){
        let (dir,path)=fixture();let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let view=store.issue(&t,&a,"write_file",&path,&dir.to_string_lossy(),100).unwrap();
        store.consume(&t,&view.id,&a,"write_file",&path,&dir.to_string_lossy(),101).unwrap();
        store.revoke_action(&a);
        assert!(store.consume(&t,&view.id,&Uuid::new_v4().to_string(),"write_file",&path,&dir.to_string_lossy(),102).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn changed_file_before_execution_is_denied_until_explicit_new_scope(){
        let (dir,path)=fixture();
        fs::write(&path,b"baseline").unwrap();
        let task=Uuid::new_v4().to_string();let action=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let granted=store.issue(&task,&action,"replace_text",&path,&dir.to_string_lossy(),100).unwrap();
        fs::write(&path,b"outside update").unwrap();
        assert!(store.consume(&task,&granted.id,&action,"replace_text",&path,&dir.to_string_lossy(),101).is_err());
        assert!(store.issue(&task,&action,"replace_text",&path,&dir.to_string_lossy(),102).is_err(),
            "same task cannot evade edit count/fingerprint via a new grant");
        store.revoke_task(&task);
        let next=store.issue(&task,&action,"replace_text",&path,&dir.to_string_lossy(),102).unwrap();
        store.consume(&task,&next.id,&action,"replace_text",&path,&dir.to_string_lossy(),103).unwrap();
        fs::write(&path,b"authorized edit").unwrap();
        store.record_audited_success(&task,&next.id,&action,&path,&dir.to_string_lossy()).unwrap();
        store.consume(&task,&next.id,&Uuid::new_v4().to_string(),"replace_text",&path,&dir.to_string_lossy(),104).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn task_scope_is_bound_to_selected_workspace_and_unsafe_names_fail_closed(){
        let (dir,path)=fixture();
        let nested=dir.join("nested");fs::create_dir_all(&nested).unwrap();
        let task=Uuid::new_v4().to_string();let action=Uuid::new_v4().to_string();
        let mut store=TaskEditScopeStore::default();
        let foreign=std::env::temp_dir();
        assert!(store.issue(&task,&action,"write_file",&path,&foreign.to_string_lossy(),100).is_ok(),
            "a broader chosen workspace can include file, but exact file remains pinned");
        assert!(store.issue(&task,&action,"write_file",&path,&dir.to_string_lossy(),100).is_err());
        store.revoke_task(&task);
        let view=store.issue(&task,&action,"write_file",&path,&dir.to_string_lossy(),100).unwrap();
        assert!(store.consume(&task,&view.id,&action,"write_file",&path,&foreign.to_string_lossy(),101).is_err(),
            "switching selected workspace cannot reuse an approved scope");
        assert!(store.consume(&task,&view.id,&action,"write_file",&path,&dir.to_string_lossy(),101).is_ok());
        let outside=dir.parent().unwrap().join("foreign.md").to_string_lossy().into_owned();
        assert!(store.issue(&task,&action,"write_file",&outside,&dir.to_string_lossy(),101).is_err());
        for bad in ["data.md:stream.js","con.txt","COM1.md","trailing.md."]{
            let file=dir.join(bad).to_string_lossy().into_owned();
            assert!(store.issue(&task,&action,"write_file",&file,&dir.to_string_lossy(),101).is_err(),"{bad}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sensitive_project_files_and_code_require_individual_owner_review(){
        let (dir,_path)=fixture();let task=Uuid::new_v4().to_string();
        let origin=Uuid::new_v4().to_string();let mut scopes=TaskEditScopeStore::default();
        for file in ["package.json","tsconfig.json","auth.ts","payment.ts",
                     "security.ts","middleware.ts","credentials.json",".env.ts"]{
            let path=dir.join(file).to_string_lossy().into_owned();
            assert!(scopes.issue(&task,&origin,"write_file",&path,&dir.to_string_lossy(),100).is_err(),
                "{file} should never be silently edited under a delegated scope");
        }
        for folder in [".github",".vscode",".aws","secrets"]{
            let root=dir.join(folder);fs::create_dir_all(&root).unwrap();
            let file=root.join("deployment.ts").to_string_lossy().into_owned();
            assert!(scopes.issue(&task,&origin,"write_file",&file,&dir.to_string_lossy(),100).is_err(),
                "{folder} must need Allow once");
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn owner_cannot_reissue_four_action_scope_without_explicit_revoke(){
        let (dir,path)=fixture();let task=Uuid::new_v4().to_string();let origin=Uuid::new_v4().to_string();
        let mut s=TaskEditScopeStore::default();
        let grant=s.issue(&task,&origin,"write_file",&path,&dir.to_string_lossy(),100).unwrap();
        assert!(s.issue(&task,&Uuid::new_v4().to_string(),"write_file",&path,&dir.to_string_lossy(),101).is_err());
        for index in 0..4{
            let id=if index==0{origin.clone()}else{Uuid::new_v4().to_string()};
            s.consume(&task,&grant.id,&id,"write_file",&path,&dir.to_string_lossy(),101).unwrap();
            s.record_audited_success(&task,&grant.id,&id,&path,&dir.to_string_lossy()).unwrap();
        }
        assert!(s.consume(&task,&grant.id,&Uuid::new_v4().to_string(),"write_file",&path,&dir.to_string_lossy(),102).is_err());
        // The exhausted scope cannot mint another permission without owner reauthorization.
        s.revoke_task(&task);
        assert!(s.issue(&task,&Uuid::new_v4().to_string(),"write_file",&path,&dir.to_string_lossy(),103).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

}
