//! Durable exact-UUID project/output resource claims for approved workers.
//! Provides an admission and crash-quarantine boundary before future parallel
//! background workers. Existing Windows desktop lease and single OS process
//! lane stay exclusive; this module does NOT enable concurrent GUI execution.
use serde::{Deserialize,Serialize};
use std::{collections::HashSet,fs,fs::OpenOptions,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
use uuid::Uuid;

const MAX_BYTES:usize=131_072;
const MAX_HELD:usize=12;
const MAX_RETIRED:usize=48;
static IO:Mutex<()> = Mutex::new(());

/// The in-process mutex is not enough if two Shuvi desktop processes start.
/// Serialize every resource ledger mutation with a fixed sidecar OS lock.
/// A crash releases the OS lock while the durable held UUID remains on disk.
/// No stale timeout and no manual deletion of retained resource claims.
struct CrossProcessLedgerLock(fs::File);
impl CrossProcessLedgerLock {
    fn take(file:&Path)->Result<Self,String>{
        let lock=file.with_extension("json.oslock");
        if let Ok(metadata)=fs::symlink_metadata(&lock){
            if !metadata.is_file()||metadata.file_type().is_symlink(){
                return Err("Resource OS lock path is not a regular file.".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes()&0x400!=0{
                    return Err("Resource OS lock reparse point rejected.".into());
                }
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Windows share mode zero is an actual kernel-backed exclusive
            // open even across separate processes. No force-unlock/TTL.
            let handle=OpenOptions::new().read(true).write(true)
                .create(true).share_mode(0).open(&lock)
                .map_err(|_|"Another Shuvi process owns the native resource ledger.".to_string())?;
            return Ok(Self(handle));
        }
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            unsafe extern "C" {fn flock(fd:i32,operation:i32)->i32;}
            let handle=OpenOptions::new().read(true).write(true)
                .create(true).open(&lock)
                .map_err(|_|"Cannot open native resource OS lock.".to_string())?;
            // Unix advisory locks are sufficient because every resource
            // writer shares this authenticated path and flock() contract.
            if unsafe{flock(handle.as_raw_fd(),2|4)}!=0{
                return Err("Another Shuvi process owns the native resource ledger.".into());
            }
            return Ok(Self(handle));
        }
        #[cfg(not(any(windows,unix)))]
        {
            Err("Cross-process exclusive resource locking unavailable on this host.".into())
        }
    }
}


#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Resource {
    path:String,
    mode:String, // read source project or write output directory
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Hold {
    action_id:String,
    tool:String,
    resources:Vec<Resource>,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Ledger {
    version:u32,
    held:Vec<Hold>,
    retired_action_ids:Vec<String>,
}
impl Default for Ledger {
    fn default()->Self{
        Self{version:1,held:Vec::new(),retired_action_ids:Vec::new()}
    }
}
fn valid_uuid(s:&str)->bool{
    Uuid::parse_str(s).map(|u|u.to_string()==s).unwrap_or(false)
}
fn check(l:&Ledger)->Result<(),String>{
    if l.version!=1||l.held.len()>MAX_HELD||l.retired_action_ids.len()>MAX_RETIRED{
        return Err("Resource ledger exceeds bounded version or count.".into());
    }
    let mut ids=HashSet::new();
    for id in &l.retired_action_ids{
        if !valid_uuid(id)||!ids.insert(id.as_str()){
            return Err("Resource ledger has invalid/replayed retired UUID.".into());
        }
    }
    for h in &l.held{
        if !valid_uuid(&h.action_id)||!ids.insert(h.action_id.as_str())
            ||h.tool!="blender_run_plan"
            ||h.resources.is_empty()||h.resources.len()>2
            ||h.resources.iter().filter(|r|r.mode=="write").count()!=1 {
            return Err("Resource claim contains an invalid or duplicate action.".into());
        }
        let mut seen=HashSet::new();
        for r in &h.resources{
            if !matches!(r.mode.as_str(),"read"|"write")
                ||r.path.is_empty()||r.path.len()>4096
                ||!Path::new(&r.path).is_absolute()
                ||r.path!=r.path.to_lowercase()
                ||!seen.insert(r.path.as_str()){
                return Err("Resource claim contains a malformed canonical path.".into());
            }
        }
    }
    // An on-disk ledger containing conflicting claims must never be treated
    // as a harmless old journal after a crash/restart.
    for (i,a) in l.held.iter().enumerate(){
        for b in l.held.iter().skip(i+1){
            if conflicts(&a.resources,&b.resources){
                return Err("Resource ledger contains conflicting owned paths.".into());
            }
        }
    }
    Ok(())
}
fn verified_bytes(bytes:&[u8])->Result<(),String>{
    if bytes.len()>MAX_BYTES{return Err("Resource ownership journal oversized.".into());}
    let l:Ledger=serde_json::from_slice(bytes)
        .map_err(|_|"Resource ownership journal corrupt.".to_string())?;
    check(&l)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir()
        .map_err(|_|"Resource ownership storage inaccessible.")?;
    fs::create_dir_all(&root)
        .map_err(|_|"Cannot prepare resource ownership storage.")?;
    Ok(root.join("native-resource-ownership.json"))
}
fn read_at(file:&Path)->Result<Ledger,String>{
    if !file.exists(){
        if file.with_extension("json.bak").exists(){
            return Err("Orphaned resource ownership backup requires owner review.".into());
        }
        return Ok(Ledger::default());
    }
    let meta=fs::symlink_metadata(file)
        .map_err(|_|"Resource journal metadata unavailable.")?;
    if !meta.is_file()||meta.file_type().is_symlink(){
        return Err("Resource journal must be an ordinary file.".into());
    }
    let raw=crate::read_file_bytes_bounded(file,MAX_BYTES,"resource ownership journal")?;
    verified_bytes(&raw)?;
    serde_json::from_slice(&raw).map_err(|_|"Resource journal decode failed.".into())
}
fn persist(file:&Path,l:&Ledger)->Result<(),String>{
    check(l)?;
    let raw=serde_json::to_vec(l)
        .map_err(|_|"Cannot encode resource ownership ledger.")?;
    verified_bytes(&raw)?;
    if file.exists(){
        crate::premiere_store::replace(file,&raw,MAX_BYTES,verified_bytes)
    }else{
        crate::atomic_file::create_new_verified(file,&raw,"resource ownership journal")
    }
}
/// Only caller-vetted existing absolute project/output paths are admitted.
/// canonicalize+component comparison blocks aliases and nested-output writes.
fn canonical(p:&Path)->Result<String,String>{
    let meta=fs::metadata(p).map_err(|_|"Resource path inaccessible.")?;
    if !meta.is_file()&&!meta.is_dir(){
        return Err("Resource is not a regular path.".into());
    }
    let real=fs::canonicalize(p).map_err(|_|"Resource cannot be canonicalized.")?;
    if !real.is_absolute(){return Err("Resource is not absolute.".into());}
    let lower=real.to_str().ok_or("Resource has non-Unicode path.")?.to_lowercase();
    if lower.len()>4096{return Err("Resource canonical path too long.".into());}
    Ok(lower)
}
fn overlap(a:&str,b:&str)->bool{
    Path::new(a).starts_with(Path::new(b))
        ||Path::new(b).starts_with(Path::new(a))
}
fn conflicts(a:&[Resource],b:&[Resource])->bool{
    a.iter().any(|left|b.iter().any(|right|
        (left.mode=="write"||right.mode=="write")&&overlap(&left.path,&right.path)))
}
fn reserve_at(file:&Path,action:&str,resources:Vec<Resource>)->Result<(),String>{
    let _guard=IO.lock().map_err(|_|"Resource lock poisoned.")?;
    let _cross_process=CrossProcessLedgerLock::take(file)?;
    let mut l=read_at(file)?;
    if !valid_uuid(action)||resources.len()==0||resources.len()>2{
        return Err("Only exact prepared UUID with bounded resources is admitted.".into());
    }
    if l.held.iter().any(|h|h.action_id==action)
        ||l.retired_action_ids.iter().any(|id|id==action){
        return Err("Previously reserved resource action UUID cannot replay.".into());
    }
    if l.held.iter().any(|h|conflicts(&h.resources,&resources)){
        return Err("Project/output collision: another action retains resource ownership.".into());
    }
    l.held.push(Hold{action_id:action.into(),tool:"blender_run_plan".into(),resources});
    persist(file,&l)
}
/// Production entry: only the existing approved Blender plan under a native
/// Windows mutation lease calls this. No model-selected background lane/IPC.
pub(crate) fn reserve_blender_plan(
    app:&AppHandle,action:&str,project:Option<&str>,output:&str
)->Result<(),String>{
    let destination=Path::new(output);
    if !destination.is_absolute()||!destination.is_dir(){
        return Err("Blender resource output must be an existing absolute directory.".into());
    }
    let mut resources=vec![Resource{path:canonical(destination)?,mode:"write".into()}];
    if let Some(input)=project{
        let p=Path::new(input);
        if !p.is_absolute()||!p.is_file(){
            return Err("Blender source resource must be an existing absolute file.".into());
        }
        resources.push(Resource{path:canonical(p)?,mode:"read".into()});
    }
    reserve_at(&path(app)?,action,resources)
}
fn release_at(file:&Path,action:&str,artifact_path:&str)->Result<(),String>{
    let _guard=IO.lock().map_err(|_|"Resource lock poisoned.")?;
    let _cross_process=CrossProcessLedgerLock::take(file)?;
    let mut l=read_at(file)?;
    let index=l.held.iter().position(|h|h.action_id==action);
    let Some(index)=index else{
        if l.retired_action_ids.iter().any(|id|id==action){return Ok(());}
        // Historical actions before this module had no resource ledger.
        return Ok(());
    };
    if l.held[index].tool!="blender_run_plan"{
        return Err("Foreign tool cannot release the output reservation.".into());
    }
    let artifact=Path::new(artifact_path);
    let actual=canonical(artifact)?;
    let output=Path::new(&actual).parent()
        .ok_or("Certified artifact has no parent folder.")?;
    let confirmed=l.held[index].resources.iter().any(|r|
        r.mode=="write"&&Path::new(&r.path)==output);
    if !confirmed{
        return Err("Certified artifact does not belong to the exact owned output.".into());
    }
    l.held.remove(index);
    l.retired_action_ids.push(action.into());
    if l.retired_action_ids.len()>MAX_RETIRED{
        l.retired_action_ids.remove(0);
    }
    persist(file,&l)
}
/// Only an already durable Rust success audit AND independently rehashed UUID
/// Blender artifact certificate can free the claimed output. No OS exit,
/// heartbeat, AI response, TTL or owner-reviewed-unknown automatically does.
pub(crate) fn release_after_verified_audit(app:&AppHandle,action:&str)->Result<(),String>{
    let file=path(app)?;
    let held={
        let _guard=IO.lock().map_err(|_|"Resource lock poisoned.")?;
        let l=read_at(&file)?;
        l.held.iter().any(|h|h.action_id==action)
    };
    if !held{return Ok(());}
    let job=crate::native_worker_job::read(app)?
        .ok_or("Cannot release output without a real Rust action journal.")?;
    if job.action_id!=action||job.tool!="blender_run_plan"
        ||job.phase!="audit_verified"||job.audit_success!=Some(true){
        return Err("Unverified action audit cannot release a resource.".into());
    }
    let cert=crate::native_blender_action_artifact::read_verified(app,action)?;
    release_at(&file,action,&cert.path)
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    const C:&str="3ac5c21a-8407-4ed7-b4b7-f51ba437a491";
    fn temp()->(PathBuf,PathBuf){
        let root=std::env::temp_dir().join(format!("shuvi-resource-{}",Uuid::new_v4()));
        fs::create_dir_all(root.join("one")).unwrap();
        fs::create_dir_all(root.join("two")).unwrap();
        let journal=root.join("journal.json");
        (root,journal)
    }
    fn resource(p:&Path,mode:&str)->Resource{
        Resource{path:canonical(p).unwrap(),mode:mode.into()}
    }
    #[test]
    fn another_native_process_lock_cannot_commit_resource_claims(){
        let (root,file)=temp();
        let _host=CrossProcessLedgerLock::take(&file).unwrap();
        let denied=reserve_at(&file,A,vec![resource(&root.join("one"),"write")]);
        assert!(denied.is_err());
        assert!(!file.exists());
        drop(_host);
        reserve_at(&file,A,vec![resource(&root.join("one"),"write")]).unwrap();
        assert_eq!(read_at(&file).unwrap().held[0].action_id,A);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn competing_writer_threads_cannot_both_claim_the_same_output(){
        use std::sync::{Arc,Barrier};
        let (root,file)=temp();
        let folder=root.join("one");
        let gate=Arc::new(Barrier::new(3));
        let file_a=file.clone();
        let file_b=file.clone();
        let res_a=resource(&folder,"write");
        let res_b=res_a.clone();
        std::thread::scope(|s|{
            let first_gate=Arc::clone(&gate);
            let second_gate=Arc::clone(&gate);
            let first=s.spawn(move||{
                first_gate.wait();
                reserve_at(&file_a,A,vec![res_a]).is_ok()
            });
            let second=s.spawn(move||{
                second_gate.wait();
                reserve_at(&file_b,B,vec![res_b]).is_ok()
            });
            gate.wait();
            let count=(first.join().unwrap() as usize)+(second.join().unwrap() as usize);
            assert_eq!(count,1);
        });
        assert_eq!(read_at(&file).unwrap().held.len(),1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn disjoint_background_resources_admit_independently_but_outputs_cannot_collide(){
        let (root,file)=temp();
        let one=resource(&root.join("one"),"write");
        let two=resource(&root.join("two"),"write");
        reserve_at(&file,A,vec![one.clone()]).unwrap();
        reserve_at(&file,B,vec![two.clone()]).unwrap();
        let result=reserve_at(&file,C,vec![one.clone()]);
        assert!(result.is_err());
        assert_eq!(read_at(&file).unwrap().held.len(),2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_read_source_does_not_open_concurrent_writes_or_nested_output(){
        let (root,file)=temp();
        let project=root.join("one").join("scene.blend");
        fs::write(&project,b"BLENDER test").unwrap();
        let source=resource(&project,"read");
        reserve_at(&file,A,vec![resource(&root.join("two"),"write"),source.clone()]).unwrap();
        // A second read of same project is allowed, but no second writer to it.
        let foreign=root.join("three");
        fs::create_dir_all(&foreign).unwrap();
        reserve_at(&file,B,vec![resource(&foreign,"write"),source.clone()]).unwrap();
        assert!(reserve_at(&file,C,vec![resource(&root.join("one"),"write")]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn crash_preserves_claim_and_only_matching_certified_artifact_can_release(){
        let (root,file)=temp();
        let output=root.join("one");
        let final_file=output.join("final.blend");
        let wrong=root.join("two").join("foreign.blend");
        fs::write(&final_file,b"BLENDER saved").unwrap();
        fs::write(&wrong,b"Other").unwrap();
        reserve_at(&file,A,vec![resource(&output,"write")]).unwrap();
        // Simulate Rust process restart by re-reading disk from scratch.
        let reloaded=read_at(&file).unwrap();
        assert_eq!(reloaded.held[0].action_id,A);
        assert!(reserve_at(&file,B,vec![resource(&output,"write")]).is_err());
        assert!(release_at(&file,A,wrong.to_str().unwrap()).is_err());
        assert!(release_at(&file,B,final_file.to_str().unwrap()).is_ok());
        assert!(reserve_at(&file,B,vec![resource(&output,"write")]).is_err());
        release_at(&file,A,final_file.to_str().unwrap()).unwrap();
        reserve_at(&file,B,vec![resource(&output,"write")]).unwrap();
        assert!(reserve_at(&file,A,vec![resource(&root.join("two"),"write")]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupted_or_orphaned_disk_ownership_cannot_unlock_outputs(){
        let (root,file)=temp();
        reserve_at(&file,A,vec![resource(&root.join("one"),"write")]).unwrap();
        fs::write(&file,b"{").unwrap();
        assert!(reserve_at(&file,B,vec![resource(&root.join("two"),"write")]).is_err());
        fs::remove_file(&file).unwrap();
        fs::write(file.with_extension("json.bak"),b"{}").unwrap();
        assert!(reserve_at(&file,B,vec![resource(&root.join("two"),"write")]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn forged_overlapping_or_replayed_ledger_fails_validation(){
        let (root,file)=temp();
        let first=Hold{action_id:A.into(),tool:"blender_run_plan".into(),
            resources:vec![resource(&root.join("one"),"write")]};
        let conflicting=Hold{action_id:B.into(),tool:"blender_run_plan".into(),
            resources:vec![resource(&root.join("one"),"write")]};
        let mut ledger=Ledger{version:1,held:vec![first,conflicting],
            retired_action_ids:vec![]};
        assert!(check(&ledger).is_err());
        ledger.held.truncate(1);
        ledger.retired_action_ids.push(A.into());
        assert!(check(&ledger).is_err());
        let _=file;
        fs::remove_dir_all(root).unwrap();
    }
}
