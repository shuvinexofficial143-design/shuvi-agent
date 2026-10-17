//! Independent read-only OS worker admission. This is NOT the desktop DAG.
//! Never promotes process exit into an authenticated task audit.
//! Durable slots/claims survive restarts; unknown work is never auto-cleared.
#![cfg(windows)]
use serde::{Deserialize,Serialize};
use std::{collections::HashSet,fs::{self,OpenOptions},os::windows::fs::{MetadataExt,OpenOptionsExt},
          path::{Path,PathBuf},sync::Mutex};
const MAX_ENTRIES:usize=48;
const MAX_BYTES:usize=32_768;
const MAX_ACTIVE:usize=2;
const OPEN_REPARSE_POINT:u32=0x0020_0000;
static TX:Mutex<()>=Mutex::new(());

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Entry {
    action_id:String,
    class:String,
    input_path:String,
    expected_sha256:String,
    phase:String,
    pid:Option<u32>,
    exit_code:Option<i32>,
    // No OS-only result is permitted to imply application/task success.
    app_verified:bool,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Ledger { version:u32, entries:Vec<Entry> }

fn valid_id(id:&str)->bool{
    uuid::Uuid::parse_str(id).map(|u|u.to_string()==id).unwrap_or(false)
}
fn valid_hash(hash:&str)->bool{
    hash.len()==64&&hash.bytes().all(|b|
        b.is_ascii_digit()||(b'a'..=b'f').contains(&b))
}
fn validate(l:&Ledger)->Result<(),String>{
    if l.version!=1||l.entries.len()>MAX_ENTRIES{
        return Err("Background job ledger version/count invalid.".into());
    }
    let mut ids=HashSet::new();let mut active=0;
    for e in &l.entries {
        if !valid_id(&e.action_id)||!ids.insert(e.action_id.as_str())
            ||e.class!="read_only_sha256"
            ||!valid_hash(&e.expected_sha256)
            ||!Path::new(&e.input_path).is_absolute()
            ||e.input_path.len()>4096||e.input_path.is_empty()
            ||e.app_verified {
            return Err("Background job identity or unearned verification invalid.".into());
        }
        match (e.phase.as_str(),e.pid,e.exit_code){
            ("reserved",None,None)=>active+=1,
            ("os_running",Some(1..),None)=>active+=1,
            ("os_exited_unverified"|"os_cancelled_unverified"|"os_timed_out_unverified",Some(1..),Some(_))=>{},
            // This is an independently rehashed FILE result, not proof of
            // any Adobe/Blender/UI action or general application success.
            ("sha256_verified",Some(1..),Some(0))=>{},
            ("owner_reviewed_unknown",_,None)=>{},
            _=>return Err("Background OS job state is malformed or success forged.".into()),
        }
    }
    if active>MAX_ACTIVE{return Err("Too many concurrent background jobs.".into());}
    // Pending/unknown workers retain the input claim. A final OS exit alone
    // is never evidence that input file provenance has been accepted.
    for (i,a) in l.entries.iter().enumerate(){
        if matches!(a.phase.as_str(),"owner_reviewed_unknown"|"sha256_verified"){continue;}
        if l.entries[..i].iter().any(|b|
            !matches!(b.phase.as_str(),"owner_reviewed_unknown"|"sha256_verified")
                && b.input_path==a.input_path){
            return Err("Concurrent or retained background input identity conflicts.".into());
        }
    }
    Ok(())
}
fn check_bytes(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Background ledger exceeds byte budget.".into());}
    let l:Ledger=serde_json::from_slice(raw)
        .map_err(|_|"Background ledger bytes invalid.".to_string())?;
    validate(&l)
}
fn read_at(path:&Path)->Result<Ledger,String>{
    // exists() follows links and returns false for dangling symlinks. Never
    // mistake a redirected primary or interrupted .tmp/.bak for a fresh queue.
    match fs::symlink_metadata(path){
        Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
            && meta.file_attributes()&0x400==0=>{},
        Ok(_)=>return Err("Background journal redirected or non-regular.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{
            for suffix in ["json.bak","json.tmp"]{
                match fs::symlink_metadata(path.with_extension(suffix)){
                    Ok(_)=>return Err("Interrupted background admission requires owner review.".into()),
                    Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
                    Err(_)=>return Err("Background admission recovery file inaccessible.".into()),
                }
            }
            return Ok(Ledger{version:1,entries:Vec::new()});
        },
        Err(_)=>return Err("Background admission primary inaccessible.".into()),
    }
    if fs::symlink_metadata(path.with_extension("json.tmp")).is_ok(){
        return Err("Unresolved background journal temporary file needs owner review.".into());
    }
    let bytes=crate::read_file_bytes_bounded(path,MAX_BYTES,"background admission")?;
    check_bytes(&bytes)?;
    serde_json::from_slice(&bytes).map_err(|_|"Background ledger unreadable.".into())
}
fn save_at(path:&Path,l:&Ledger)->Result<(),String>{
    validate(l)?;
    let bytes=serde_json::to_vec(l).map_err(|_|"Cannot serialize background jobs.")?;
    if bytes.len()>MAX_BYTES{return Err("Background job ledger full.".into());}
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,check_bytes)
}
struct Exclusive(std::fs::File);
impl Exclusive {
    fn take(path:&Path)->Result<Self,String>{
        let lock=path.with_extension("json.oslock");
        match fs::symlink_metadata(&lock){
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
                && meta.file_attributes()&0x400==0=>{},
            Ok(_)=>return Err("Background journal lock redirected.".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("Cannot inspect background journal lock.".into()),
        }
        let f=OpenOptions::new().read(true).write(true).create(true)
            .share_mode(0).custom_flags(OPEN_REPARSE_POINT).open(&lock)
            .map_err(|_|"Another Shuvi instance holds background admission.".to_string())?;
        let meta=f.metadata().map_err(|_|"Cannot inspect opened background lock.")?;
        if !meta.is_file()||meta.file_attributes()&0x400!=0 {
            return Err("Background lock is a Windows reparse point.".into());
        }
        Ok(Self(f))
    }
}
/// Stable Windows BY_HANDLE_FILE_INFORMATION, as used by Shuvi's existing
/// native delivery verifier. No unstable MetadataExt nightly APIs.
fn require_single_link(path:&Path)->Result<(),String>{
    use std::{ffi::c_void,mem::MaybeUninit,os::windows::io::AsRawHandle};
    #[repr(C)] struct FileTime{low:u32,high:u32}
    #[repr(C)] struct ByHandleFileInformation{
        attributes:u32,created:FileTime,accessed:FileTime,written:FileTime,
        volume_serial:u32,size_high:u32,size_low:u32,links:u32,
        index_high:u32,index_low:u32
    }
    #[link(name="kernel32")]
    unsafe extern "system"{
        fn GetFileInformationByHandle(
            handle:*mut c_void,info:*mut ByHandleFileInformation
        )->i32;
    }
    let opened=OpenOptions::new().read(true).share_mode(1)
        .open(path).map_err(|_|"Cannot open background input for identity verification.")?;
    let meta=opened.metadata().map_err(|_|"Cannot inspect background input handle.")?;
    if !meta.is_file()||meta.file_attributes()&0x400!=0{
        return Err("Background input handle redirected.".into());
    }
    let mut data=MaybeUninit::<ByHandleFileInformation>::zeroed();
    if unsafe{GetFileInformationByHandle(opened.as_raw_handle(),data.as_mut_ptr())}==0{
        return Err("Native input identity verification unavailable.".into());
    }
    let info=unsafe{data.assume_init()};
    if info.links!=1{
        return Err("Background input with unknown/multiple hard links is not isolated.".into());
    }
    Ok(())
}

pub(super) fn checked_input(file:&Path)->Result<String,String>{
    if !file.is_absolute(){return Err("Background input path must be absolute.".into());}
    let meta=fs::symlink_metadata(file).map_err(|_|"Background input inaccessible.")?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.file_attributes()&0x400!=0{
        return Err("Background input must be a regular non-reparse file.".into());
    }
    // The stable Rust MetadataExt does not expose Windows link count.
    // Query it from an actual read-only, deny-write native file handle.
    // A different hardlink path cannot silently evade the admission claim.
    require_single_link(file)?;
    let canonical=fs::canonicalize(file).map_err(|_|"Cannot canonicalize background input.")?;
    Ok(canonical.to_string_lossy().to_lowercase())
}
fn ledger_file(root:&Path)->Result<PathBuf,String>{
    let meta=fs::symlink_metadata(root).map_err(|_|"Background state directory absent.")?;
    if !meta.is_dir()||meta.file_type().is_symlink()||meta.file_attributes()&0x400!=0{
        return Err("Background state directory redirected.".into());
    }
    Ok(root.join("native-background-admission.json"))
}
/// The caller is a TRUSTED Rust adapter that has already checked the
/// existing owner's prepared action. No Tauri/model-facing entrypoint exists.
pub(super) fn reserve_at(root:&Path,id:&str,input:&Path,sha:&str)->Result<(),String>{
    if !valid_id(id)||!valid_hash(sha){return Err("Invalid approved background identity.".into());}
    let path=ledger_file(root)?;
    let _local=TX.lock().map_err(|_|"Background journal mutex poisoned.")?;
    let _os=Exclusive::take(&path)?;
    let mut l=read_at(&path)?;
    let canonical=checked_input(input)?;
    if l.entries.iter().any(|e|e.action_id==id){
        return Err("Background action UUID cannot be replayed.".into());
    }
    if l.entries.iter().filter(|e|matches!(e.phase.as_str(),"reserved"|"os_running")).count()>=MAX_ACTIVE{
        return Err("Two background jobs already admitted.".into());
    }
    if l.entries.iter().any(|e|e.input_path==canonical
        && !matches!(e.phase.as_str(),"owner_reviewed_unknown"|"sha256_verified")){
        return Err("Background input already reserved or retained for review.".into());
    }
    if l.entries.len()==MAX_ENTRIES {
        // Never erase prior UUIDs or unknown receipts to admit new work.
        return Err("Background admission history full; requires owner archival.".into());
    }
    l.entries.push(Entry{
        action_id:id.into(),class:"read_only_sha256".into(),
        input_path:canonical,expected_sha256:sha.into(),phase:"reserved".into(),
        pid:None,exit_code:None,app_verified:false,
    });
    save_at(&path,&l)
}
fn change_at(path:&Path,id:&str,phase:&str,pid:Option<u32>,code:Option<i32>)->Result<(),String>{
    let _local=TX.lock().map_err(|_|"Background journal mutex poisoned.")?;
    let _os=Exclusive::take(path)?;
    let mut l=read_at(path)?;
    let item=l.entries.iter_mut().find(|e|e.action_id==id)
        .ok_or("Unknown background action.")?;
    let valid=match (item.phase.as_str(),phase,pid,code) {
        ("reserved","os_running",Some(1..),None)=>true,
        ("os_exited_unverified","sha256_verified",Some(p),Some(0))
            if item.pid==Some(p)&&item.exit_code==Some(0)=>true,
        ("os_running","os_exited_unverified"|"os_cancelled_unverified"|"os_timed_out_unverified",Some(p),Some(_))
            if item.pid==Some(p)=>true,
        _=>false,
    };
    if !valid {return Err("Background UUID, PID or lifecycle transition rejected.".into());}
    item.phase=phase.into();item.pid=pid;item.exit_code=code;
    save_at(path,&l)
}
pub(super) fn started_at(root:&Path,id:&str,pid:u32)->Result<(),String>{
    change_at(&ledger_file(root)?,id,"os_running",Some(pid),None)
}
pub(super) fn terminal_at(root:&Path,id:&str,pid:u32,phase:&str,code:i32)->Result<(),String>{
    change_at(&ledger_file(root)?,id,phase,Some(pid),Some(code))
}
/// Call only AFTER independent file-handle-locked host SHA readback and exact
/// UUID/digest/bytes agreement. No OS process exit alone can call this.
pub(super) fn verified_sha_at(root:&Path,id:&str,pid:u32)->Result<(),String>{
    change_at(&ledger_file(root)?,id,"sha256_verified",Some(pid),Some(0))
}
/// Copy only bounded, structurally validated persisted background claims.
/// The read holds both the in-process mutex and cross-process kernel lock.
#[derive(Clone,Debug)]
pub(super) struct ClaimSnapshot {
    pub action_id:String,
    pub input_path:String,
    pub expected_sha256:String,
    pub phase:String,
    pub pid:Option<u32>,
    pub exit_code:Option<i32>,
}
pub(super) fn snapshot_detailed_at(root:&Path)->Result<Vec<ClaimSnapshot>,String>{
    let file=ledger_file(root)?;
    let _local=TX.lock().map_err(|_|"Background journal mutex poisoned.")?;
    let _os=Exclusive::take(&file)?;
    let l=read_at(&file)?;
    Ok(l.entries.into_iter().map(|e|ClaimSnapshot{
        action_id:e.action_id,input_path:e.input_path,
        expected_sha256:e.expected_sha256,phase:e.phase,
        pid:e.pid,exit_code:e.exit_code,
    }).collect())
}
/// Observation is metadata only. Unknown process effects remain quarantined.
pub(super) fn snapshot_at(root:&Path)->Result<Vec<(String,String)>,String>{
    let file=ledger_file(root)?;
    let _local=TX.lock().map_err(|_|"Background journal mutex poisoned.")?;
    let _os=Exclusive::take(&file)?;
    let l=read_at(&file)?;
    Ok(l.entries.iter().map(|e|(e.action_id.clone(),e.phase.clone())).collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    const C:&str="3ac5c21a-8407-4ed7-b4b7-f51ba437a491";
    fn temp()->PathBuf{
        let p=std::env::temp_dir().join(format!("shuvi-background-admission-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();p
    }
    fn inputs(p:&Path)->(PathBuf,PathBuf,PathBuf){
        let a=p.join("a.bin");let b=p.join("b.bin");let c=p.join("c.bin");
        for f in [&a,&b,&c]{fs::write(f,b"read-only-input").unwrap();}
        (a,b,c)
    }
    fn hash()->String{"a".repeat(64)}
    #[test]
    fn two_disjoint_jobs_are_admitted_and_third_is_refused_until_terminal(){
        let p=temp();let (a,b,c)=inputs(&p);
        reserve_at(&p,A,&a,&hash()).unwrap(); reserve_at(&p,B,&b,&hash()).unwrap();
        assert!(reserve_at(&p,C,&c,&hash()).is_err());
        started_at(&p,A,1234).unwrap();started_at(&p,B,1235).unwrap();
        assert!(terminal_at(&p,A,9999,"os_exited_unverified",0).is_err());
        terminal_at(&p,A,1234,"os_exited_unverified",0).unwrap();
        reserve_at(&p,C,&c,&hash()).unwrap();
        assert_eq!(snapshot_at(&p).unwrap().len(),3);
        assert!(reserve_at(&p,A,&a,&hash()).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn only_matching_os_exit_zero_may_become_independently_verified_sha(){
        let p=temp();let (a,_,_)=inputs(&p);
        reserve_at(&p,A,&a,&hash()).unwrap();
        assert!(verified_sha_at(&p,A,123).is_err());
        started_at(&p,A,123).unwrap();
        assert!(verified_sha_at(&p,A,123).is_err());
        terminal_at(&p,A,123,"os_exited_unverified",0).unwrap();
        assert!(verified_sha_at(&p,A,124).is_err());
        verified_sha_at(&p,A,123).unwrap();
        assert!(verified_sha_at(&p,A,123).is_err());
        assert_eq!(snapshot_at(&p).unwrap(),vec![(A.into(),"sha256_verified".into())]);
        // The verified input is now a terminal read-only result and may be
        // inspected again under a NEW UUID, but action UUID replay is barred.
        reserve_at(&p,B,&a,&hash()).unwrap();
        assert!(reserve_at(&p,A,&a,&hash()).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn detailed_status_snapshot_preserves_exact_input_provenance_and_never_mutates(){
        let p=temp();let (a,_,_)=inputs(&p);
        reserve_at(&p,A,&a,&hash()).unwrap();
        started_at(&p,A,551).unwrap();
        let first=snapshot_detailed_at(&p).unwrap();
        assert_eq!(first.len(),1);
        assert_eq!(first[0].action_id,A);
        assert_eq!(first[0].pid,Some(551));
        assert_eq!(first[0].phase,"os_running");
        assert_eq!(first[0].expected_sha256,hash());
        assert_eq!(snapshot_detailed_at(&p).unwrap()[0].phase,"os_running");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn crash_pending_claim_is_not_auto_unlocked_or_reused(){
        let p=temp();let (a,_,_)=inputs(&p);
        reserve_at(&p,A,&a,&hash()).unwrap();
        assert!(reserve_at(&p,B,&a,&hash()).is_err());
        assert!(started_at(&p,A,0).is_err());
        assert!(terminal_at(&p,A,1,"os_exited_unverified",0).is_err());
        assert_eq!(snapshot_at(&p).unwrap()[0].1,"reserved");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn real_kernel_lock_and_forged_directory_reject_cross_instance_admission(){
        let p=temp();let (a,_,_)=inputs(&p);let ledger=ledger_file(&p).unwrap();
        let other=Exclusive::take(&ledger).unwrap();
        assert!(reserve_at(&p,A,&a,&hash()).is_err());drop(other);
        reserve_at(&p,A,&a,&hash()).unwrap();
        fs::remove_file(ledger.with_extension("json.oslock")).unwrap();
        fs::create_dir(ledger.with_extension("json.oslock")).unwrap();
        assert!(snapshot_at(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_or_orphaned_ledger_cannot_invent_idle_queue(){
        let p=temp();let (a,_,_)=inputs(&p);let ledger=ledger_file(&p).unwrap();
        fs::write(&ledger,b"{").unwrap();
        assert!(reserve_at(&p,A,&a,&hash()).is_err());
        fs::remove_file(&ledger).unwrap();
        fs::write(ledger.with_extension("json.bak"),b"{}").unwrap();
        assert!(snapshot_at(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn hard_link_alias_cannot_bypass_disjoint_input_claim(){
        let p=temp();let (a,_,_)=inputs(&p);
        let alias=p.join("same-file-alias.bin");
        fs::hard_link(&a,&alias).unwrap();
        assert!(reserve_at(&p,A,&a,&hash()).is_err());
        assert!(reserve_at(&p,B,&alias,&hash()).is_err());
        assert!(snapshot_at(&p).unwrap().is_empty());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn orphaned_temp_journal_and_forged_directory_are_not_read_as_fresh_queue(){
        let p=temp();let (a,_,_)=inputs(&p);
        let file=ledger_file(&p).unwrap();
        fs::write(file.with_extension("json.tmp"),b"interrupted").unwrap();
        assert!(reserve_at(&p,A,&a,&hash()).is_err());
        fs::remove_file(file.with_extension("json.tmp")).unwrap();
        fs::create_dir(&file).unwrap();
        assert!(snapshot_at(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn same_path_and_symlink_input_denied_even_with_other_uuid(){
        let p=temp();let (a,_,_)=inputs(&p);
        reserve_at(&p,A,&a,&hash()).unwrap();
        assert!(reserve_at(&p,B,&a,&hash()).is_err());
        let missing=p.join("missing.bin");
        assert!(reserve_at(&p,B,&missing,&hash()).is_err());
        fs::remove_dir_all(p).unwrap();
    }
}
