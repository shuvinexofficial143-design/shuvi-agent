//! Isolated OS-backed read-only process lane (not the desktop GUI lane).
//! IMPORTANT: This is an internal worker primitive, NOT yet an authorized
//! scheduler dispatch route. Never feed executable/args from an AI request.
//! An actual adapter must enforce approved typed action + output/resource
//! authorization and supply the existing combined host-RAM watchdog.
#![cfg(windows)]
use std::{
    ffi::OsString,
    fs::{self,File,OpenOptions},
    io::Write,
    os::windows::fs::{MetadataExt,OpenOptionsExt},
    path::{Path,PathBuf},
    time::{Duration,Instant},
};
use serde::{Serialize,Deserialize};
#[path = "native_windows_job.rs"]
mod contained;
#[path = "native_background_admission.rs"]
mod admission;
#[path = "native_background_hash_readback.rs"]
mod hash_readback;
// M52 bounded durable admission for separate approved parent SHA jobs.
// Internal only; the exclusive desktop DAG and public IPC remain unchanged.
#[path = "native_background_parent_queue.rs"]
pub(crate) mod parent_queue;
use contained::OwnedChild;

const MAX_BACKGROUND_WORKERS:usize=2;
const READ_ONLY_JOB_CAP:u64=512*1024*1024;
const MAX_RUNTIME:Duration=Duration::from_secs(600);
const OPEN_REPARSE_POINT:u32=0x0020_0000;
const MAX_RECEIPT_BYTES:usize=1024;

#[derive(Serialize,Deserialize,Clone,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Receipt{
    version:u32,
    action_id:String,
    class:String,
    phase:String,
    pid:Option<u32>,
    exit_code:Option<i32>,
    app_verified:bool,
}
fn valid_uuid(id:&str)->bool{
    uuid::Uuid::parse_str(id).map(|u|u.to_string()==id).unwrap_or(false)
}
fn valid_receipt(record:&Receipt)->Result<(),String>{
    if record.version!=1||!valid_uuid(&record.action_id)
        ||record.class!="read_only_native_verifier"||record.app_verified
        ||!matches!((record.phase.as_str(),record.pid,record.exit_code),
            ("launch_pending",None,None)
            |("os_running",Some(1..),None)
            |("os_exited_unverified",Some(1..),Some(_))
            |("os_cancelled_unverified",Some(1..),Some(_))
            |("os_timed_out_unverified",Some(1..),Some(_))){
        return Err("Malformed or forged read-only OS worker receipt.".into());
    }
    Ok(())
}
fn encoded(record:&Receipt)->Result<Vec<u8>,String>{
    valid_receipt(record)?;
    let bytes=serde_json::to_vec(record).map_err(|_|"Cannot encode background receipt.")?;
    if bytes.len()>MAX_RECEIPT_BYTES{return Err("Background receipt too large.".into());}
    Ok(bytes)
}
fn regular_root(dir:&Path)->Result<(),String>{
    let meta=fs::symlink_metadata(dir).map_err(|_|"Read-only worker root unavailable.")?;
    if !meta.is_dir()||meta.file_type().is_symlink()
        ||meta.file_attributes()&0x400!=0{
        return Err("Read-only worker root may not be redirected.".into());
    }
    Ok(())
}
fn receipt_path(dir:&Path,id:&str)->PathBuf{
    dir.join(format!("native-bg-readonly-{id}.json"))
}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct StopIntent {
    version:u32,
    action_id:String,
    request:String,
}
fn stop_intent_path(root:&Path,id:&str)->PathBuf{
    root.join(format!("native-bg-stop-{id}.json"))
}
fn inspect_stop_intent(root:&Path,id:&str)->Result<bool,String>{
    if !valid_uuid(id){return Err("Invalid exact background Stop UUID.".into());}
    let path=stop_intent_path(root,id);
    match fs::symlink_metadata(&path){
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(false),
        Err(_)=>return Err("Cannot inspect background Stop request.".into()),
        Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
            && meta.file_attributes()&0x400==0 && meta.len()>0 &&meta.len()<=256=>{},
        Ok(_)=>return Err("Background Stop request redirected or malformed.".into()),
    };
    let raw=crate::read_file_bytes_bounded(&path,256,"background Stop request")?;
    let record:StopIntent=serde_json::from_slice(&raw)
        .map_err(|_|"Background Stop request JSON malformed.")?;
    if record.version!=1||record.action_id!=id||record.request!="owner_stop"{
        return Err("Background Stop request does not match exact UUID.".into());
    }
    Ok(true)
}
/// Only called by the already authorized owner-facing cancel_running_action
/// after checking that parent UUID is actively executing the SHA pair.
/// Durable create-new request is NOT proof of process termination.
pub(crate) fn request_stop_for_child(root:&Path,id:&str)->Result<bool,String>{
    regular_root(root)?;
    if !valid_uuid(id){return Err("Background stop requires exact worker UUID.".into());}
    let claims=admission::snapshot_detailed_at(root)?;
    let matched=claims.iter().find(|x|x.action_id==id)
        .ok_or("No owned background worker admission for Stop UUID.")?;
    if matched.phase!="os_running"{
        return Ok(false); // Terminal/reserved/unknown is not a live stop target.
    }
    if inspect_stop_intent(root,id)?{return Ok(true);}
    let payload=serde_json::to_vec(&StopIntent{
        version:1,action_id:id.into(),request:"owner_stop".into(),
    }).map_err(|_|"Cannot encode durable background Stop request.")?;
    let path=stop_intent_path(root,id);
    let mut file=OpenOptions::new().write(true).create_new(true)
        .custom_flags(OPEN_REPARSE_POINT).open(&path)
        .map_err(|_|"Cannot atomically record exact background Stop request.")?;
    file.write_all(&payload).and_then(|_|file.sync_all())
        .map_err(|_|"Cannot flush background Stop request to disk.")?;
    Ok(true)
}
/// A launch intent is irreversible without an explicit future owner-review
/// path. No TTL unlock, overwrite, or same-UUID automatic retry.
fn create_intent(path:&Path,id:&str)->Result<(),String>{
    let receipt=Receipt{
        version:1,action_id:id.into(),class:"read_only_native_verifier".into(),
        phase:"launch_pending".into(),pid:None,exit_code:None,app_verified:false,
    };
    let bytes=encoded(&receipt)?;
    let mut file=OpenOptions::new().write(true).create_new(true)
        .custom_flags(OPEN_REPARSE_POINT).open(path)
        .map_err(|_|"Read-only action UUID already launched or receipt path unsafe.")?;
    file.write_all(&bytes).and_then(|_|file.sync_all())
        .map_err(|_|"Cannot durably persist read-only launch intent.".to_string())
}
fn publish(path:&Path,receipt:&Receipt)->Result<(),String>{
    let bytes=encoded(receipt)?;
    // The original receipt is required; an interrupted/corrupt publication
    // is never interpreted as an empty slot or verified application success.
    let previous=fs::read(path).map_err(|_|"Background receipt disappeared.")?;
    let old:Receipt=serde_json::from_slice(&previous)
        .map_err(|_|"Interrupted background receipt requires owner review.")?;
    valid_receipt(&old)?;
    if old.action_id!=receipt.action_id||old.class!=receipt.class
        ||!matches!((old.phase.as_str(),receipt.phase.as_str()),
            ("launch_pending","os_running")
            |("os_running","os_exited_unverified")
            |("os_running","os_cancelled_unverified")
            |("os_running","os_timed_out_unverified")){
        return Err("Background receipt transition is not monotonic.".into());
    }
    crate::premiere_store::replace(path,&bytes,MAX_RECEIPT_BYTES,|raw|{
        let r:Receipt=serde_json::from_slice(raw)
            .map_err(|_|"Background receipt serialization invalid.".to_string())?;
        valid_receipt(&r)
    })
}
struct Slot(File);
impl Slot{
    fn take(dir:&Path)->Result<Self,String>{
        regular_root(dir)?;
        for i in 0..MAX_BACKGROUND_WORKERS{
            let path=dir.join(format!("native-bg-os-slot-{i}.oslock"));
            match fs::symlink_metadata(&path){
                Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
                    && meta.file_attributes()&0x400==0=>{},
                Ok(_)=>return Err("Background slot is redirected or not a file.".into()),
                Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
                Err(_)=>return Err("Background slot cannot be inspected.".into()),
            }
            let opened=OpenOptions::new().read(true).write(true).create(true)
                .share_mode(0).custom_flags(OPEN_REPARSE_POINT).open(&path);
            let file=match opened{Ok(f)=>f,Err(_)=>continue};
            let meta=file.metadata().map_err(|_|"Background slot handle unavailable.")?;
            if !meta.is_file()||meta.file_attributes()&0x400!=0{
                return Err("Background slot resolved to unsafe target.".into());
            }
            return Ok(Self(file));
        }
        Err("Both owned background OS process slots are busy.".into())
    }
}
/// Every live object holds one kernel-backed cross-instance worker slot and
/// one Windows Job Object; it is never allowed to release the slot merely
/// because the launcher parent exited while descendants remain alive.
pub(super) struct BackgroundOwned{
    // Closing/terminating the Job Object must precede OS-slot release.
    child:OwnedChild,
    _slot:Option<Slot>,
    id:String,
    receipt:Receipt,
    path:PathBuf,
    start:Instant,
    terminal:bool,
    admitted:bool,
}
/// Trusted backend-only launch seam. Production approval/typed tool binding
/// is intentionally not connected: there is no new Tauri IPC or model launch.
#[allow(dead_code)]
pub(super) fn spawn_internal_readonly(
    root:&Path,id:&str,exe:&Path,args:&[OsString],cwd:&Path
)->Result<BackgroundOwned,String>{
    if !valid_uuid(id)||!exe.is_absolute()||!cwd.is_absolute()
        ||args.len()>16||args.iter().any(|a|a.is_empty()||a.len()>1024){
        return Err("Background verification process has invalid bounded identity.".into());
    }
    regular_root(root)?;
    let exe_meta=fs::symlink_metadata(exe)
        .map_err(|_|"Internal background executable cannot be inspected.")?;
    let cwd_meta=fs::symlink_metadata(cwd)
        .map_err(|_|"Internal background cwd cannot be inspected.")?;
    if !exe_meta.is_file()||exe_meta.file_type().is_symlink()
        ||exe_meta.file_attributes()&0x400!=0
        ||!cwd_meta.is_dir()||cwd_meta.file_type().is_symlink()
        ||cwd_meta.file_attributes()&0x400!=0{
        return Err("Internal background program or cwd redirected.".into());
    }
    let _slot=Slot::take(root)?;
    let path=receipt_path(root,id);
    create_intent(&path,id)?;
    let child=OwnedChild::spawn_readonly_capped(exe,args,cwd,READ_ONLY_JOB_CAP)?;
    let receipt=Receipt{
        version:1,action_id:id.into(),class:"read_only_native_verifier".into(),
        phase:"os_running".into(),pid:Some(child.id()),exit_code:None,
        app_verified:false,
    };
    publish(&path,&receipt)?;
    Ok(BackgroundOwned{child,_slot:Some(_slot),id:id.into(),receipt,path,
        start:Instant::now(),terminal:false,admitted:false})
}
/// Internal trusted Rust-only integration seam. Authoritative owner approval
/// and fixed allowlisted worker executable must be checked BEFORE this call.
/// A reserved UUID/input is durable BEFORE the child can be spawned; if the
/// launch or PID journal fails, the claim stays quarantined for review.
#[allow(dead_code)]
pub(super) fn spawn_admitted_readonly(
    root:&Path,id:&str,input:&Path,expected_sha256:&str,
    exe:&Path,args:&[OsString],cwd:&Path
)->Result<BackgroundOwned,String>{
    admission::reserve_at(root,id,input,expected_sha256)?;
    let mut owned=spawn_internal_readonly(root,id,exe,args,cwd)?;
    admission::started_at(root,id,owned.child.id())?;
    owned.admitted=true;
    Ok(owned)
}
#[allow(dead_code)]
pub(super) fn read_admissions(root:&Path)->Result<Vec<(String,String)>,String>{
    admission::snapshot_at(root)
}
/// Non-mutating snapshot: a recorded OS exit or stored sha256_verified
/// is not durable proof that a file has remained unchanged since that audit.
#[derive(Clone,Debug,PartialEq,Eq,serde::Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ReadOnlyWorkerHealth{
    pub action_id:String,
    pub recorded_phase:String,
    pub evidence_health:String,
    pub current_file_rehashed:bool,
    pub safe_to_auto_retry:bool,
    pub stop_requested:bool,
}
fn inspect_receipt(root:&Path,id:&str)->Result<Option<Receipt>,String>{
    let path=receipt_path(root,id);
    match fs::symlink_metadata(&path){
        Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
            && meta.file_attributes()&0x400==0=>{},
        Ok(_)=>return Err("Background OS receipt redirected or forged.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{
            if path.with_extension("json.bak").exists()||path.with_extension("json.tmp").exists(){
                return Err("Background OS receipt interrupted and needs owner review.".into());
            }
            return Ok(None);
        },
        Err(_)=>return Err("Cannot inspect background OS receipt.".into()),
    }
    if path.with_extension("json.tmp").exists(){
        return Err("Interrupted background OS receipt publication needs owner review.".into());
    }
    let bytes=crate::read_file_bytes_bounded(&path,MAX_RECEIPT_BYTES,"background OS receipt")?;
    let value:Receipt=serde_json::from_slice(&bytes)
        .map_err(|_|"Background OS receipt malformed.")?;
    valid_receipt(&value)?;
    if value.action_id!=id {
        return Err("Background OS receipt belongs to another UUID.".into());
    }
    Ok(Some(value))
}
/// Never updates journals, frees held inputs, or retries interrupted children.
/// If a source changes AFTER a successful hash, status detects drift by
/// independently re-reading CURRENT file bytes; caller must NOT cache this
/// status as permanent acceptance of the source.
#[allow(dead_code)]
pub(crate) fn inspect_readonly_health(root:&Path)->Result<Vec<ReadOnlyWorkerHealth>,String>{
    regular_root(root)?;
    let claims=admission::snapshot_detailed_at(root)?;
    let mut observed=Vec::with_capacity(claims.len());
    for claim in claims{
        let receipt=inspect_receipt(root,&claim.action_id)?;
        let coherent=match receipt.as_ref(){
            None=>claim.phase=="reserved",
            Some(r) if claim.phase=="reserved"=>
                r.phase=="launch_pending"&&r.pid.is_none(),
            Some(r) if claim.phase=="os_running"=>
                r.phase=="os_running"&&r.pid==claim.pid,
            Some(r) if claim.phase=="sha256_verified"=>
                r.phase=="os_exited_unverified"&&r.pid==claim.pid
                    &&r.exit_code==Some(0)&&claim.exit_code==Some(0),
            Some(r) if claim.phase=="os_exited_unverified"
                ||claim.phase=="os_cancelled_unverified"
                ||claim.phase=="os_timed_out_unverified"=>
                r.phase==claim.phase&&r.pid==claim.pid
                    &&r.exit_code==claim.exit_code,
            Some(_) if claim.phase=="owner_reviewed_unknown"=>true,
            _=>false,
        };
        let (health,reverified)=if !coherent{
            ("journal_receipt_mismatch_owner_review_required",false)
        }else if claim.phase=="sha256_verified"{
            let result=result_path_for_inspection(root,&claim.action_id);
            match hash_readback::verify(
                &result,&claim.action_id,Path::new(&claim.input_path),
                &claim.expected_sha256){
                Ok(_)=>("independent_current_sha_verified",true),
                Err(_)=>("sha_artifact_missing_or_changed_owner_review_required",false)
            }
        }else if claim.phase=="reserved"||claim.phase=="os_running"{
            ("work_or_crash_liveness_not_authenticated",false)
        }else{
            ("unverified_os_outcome_requires_owner_review",false)
        };
        let stop_requested=inspect_stop_intent(root,&claim.action_id)?;
        observed.push(ReadOnlyWorkerHealth{
            action_id:claim.action_id,recorded_phase:claim.phase,
            evidence_health:health.into(),current_file_rehashed:reverified,
            safe_to_auto_retry:false,stop_requested,
        });
    }
    Ok(observed)
}
fn result_path_for_inspection(root:&Path,id:&str)->PathBuf{
    root.join(format!("native-bg-hash-{id}.json"))
}
/// Only a trusted internal adapter with an already validated owner-approved
/// read-only action is permitted to call this. This is intentionally NOT a
/// Tauri command, and no AI-provided program/argument is accepted.
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct VerifiedReadOnlyHash{
    pub action_id:String,
    pub sha256:String,
    pub bytes:u64,
    pub os_pid:u32,
}
/// Fixed-purpose sidecar is located NEXT TO the installed desktop binary.
/// Never resolve a model-chosen executable, PATH search or shell command.
/// Build/package configuration must ship it explicitly; if not installed,
/// this entrypoint fails BEFORE reservation and no work is performed.
const MAX_TRUSTED_SIDECAR_BYTES:u64=32*1024*1024;
/// File handle is held through CreateProcess admission: deny WRITE/DELETE
/// shares so a normal user process cannot replace the executable after
/// verifying its digest but before the OS starts its fixed worker.
struct PinnedSidecar{
    path:PathBuf,
    _verified_handle:File,
}
/// Installer SHA is compiled INTO the main Rust binary from the separately
/// prepared build input. A bare developer/CI build has no pin and MUST refuse
/// running even a well-named same-folder executable.
fn trusted_sidecar()->Result<PinnedSidecar,String>{
    use sha2::{Digest,Sha256};
    let expected=option_env!("SHUVI_PINNED_SHA_SIDECAR")
        .ok_or("This Shuvi build has no trusted SHA sidecar pin; installer build required.")?;
    if expected.len()!=64||!expected.bytes().all(|b|
        b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("The embedded SHA sidecar build pin is malformed.".into());
    }
    let exe=std::env::current_exe()
        .map_err(|_|"Cannot identify installed Shuvi process.")?;
    let dir=exe.parent().ok_or("Installed Shuvi executable has no directory.")?;
    let m=fs::symlink_metadata(dir).map_err(|_|"Shuvi installation directory inaccessible.")?;
    if !m.is_dir()||m.file_type().is_symlink()||m.file_attributes()&0x400!=0{
        return Err("Shuvi installed executable directory redirected.".into());
    }
    let sidecar=dir.join("shuvi-readonly-hash-worker.exe");
    let m=fs::symlink_metadata(&sidecar)
        .map_err(|_|"Pinned fixed-purpose internal SHA sidecar not installed.")?;
    if !m.is_file()||m.file_type().is_symlink()||m.file_attributes()&0x400!=0
        ||m.len()<1024||m.len()>MAX_TRUSTED_SIDECAR_BYTES{
        return Err("Installed SHA sidecar is redirected, missing or outside trusted size limit.".into());
    }
    let mut handle=OpenOptions::new().read(true).share_mode(1)
        .custom_flags(OPEN_REPARSE_POINT).open(&sidecar)
        .map_err(|_|"Cannot hold trusted SHA sidecar handle against replacement.")?;
    let observed=handle.metadata().map_err(|_|"SHA sidecar handle metadata unavailable.")?;
    if !observed.is_file()||observed.file_attributes()&0x400!=0
        ||observed.len()!=m.len()||observed.len()>MAX_TRUSTED_SIDECAR_BYTES{
        return Err("SHA sidecar changed identity during trusted open.".into());
    }
    // A second hardlink can mutate the inode without renaming this pathname.
    // M46's Win32 BY_HANDLE_FILE_INFORMATION check rejects link-count !=1.
    super::background_os_workers::admission::require_single_link(&sidecar)?;
    let mut digest=Sha256::new();let mut buf=[0u8;65536];let mut count=0u64;
    loop{
        let n=std::io::Read::read(&mut handle,&mut buf)
            .map_err(|_|"Cannot hash installed SHA sidecar.")?;
        if n==0{break;}
        count=count.checked_add(n as u64).ok_or("Sidecar hash accounting overflow.")?;
        if count>MAX_TRUSTED_SIDECAR_BYTES{
            return Err("SHA sidecar changed beyond pinned file budget.".into());
        }
        digest.update(&buf[..n]);
    }
    if count!=observed.len()||format!("{:x}",digest.finalize())!=expected{
        return Err("Installed SHA worker digest differs from main binary's embedded installer pin.".into());
    }
    Ok(PinnedSidecar{path:sidecar,_verified_handle:handle})
}
fn result_path(root:&Path,id:&str)->Result<PathBuf,String>{
    if !valid_uuid(id){return Err("Read-only SHA result UUID is malformed.".into());}
    regular_root(root)?;
    let path=root.join(format!("native-bg-hash-{id}.json"));
    match fs::symlink_metadata(&path){
        Ok(_)=>Err("Prior/foreign SHA worker evidence exists; do not overwrite.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(path),
        Err(_)=>Err("Cannot inspect SHA result path.".into()),
    }
}
#[allow(dead_code)]
pub(super) fn run_trusted_sha256_with_guard<F>(
    root:&Path,id:&str,input:&Path,expected_sha256:&str,mut host_ram_over_limit:F
)->Result<VerifiedReadOnlyHash,String>
where F:FnMut()->Result<bool,String>{
    let executable=trusted_sidecar()?;
    let output=result_path(root,id)?;
    let args:Vec<OsString>=vec![
        "--shuvi-readonly-sha256".into(),
        id.into(),input.as_os_str().to_os_string(),
        expected_sha256.into(),output.as_os_str().to_os_string(),
    ];
    // Persist durable admission BEFORE launch. Any failure after this point
    // retains the UUID/input and requires explicit owner reconciliation.
    let mut worker=spawn_admitted_readonly(
        root,id,input,expected_sha256,&executable.path,&args,root)?;
    let pid=worker.child.id();
    let exit_code=worker.wait_with_host_guard(||host_ram_over_limit())?;
    if exit_code!=0{
        return Err("Owned read-only SHA worker exited nonzero; no verification committed.".into());
    }
    // Completely separate host rehash is indispensable: OS exit zero and
    // JSON emitted by the worker alone must never certify application work.
    let bytes=hash_readback::verify(&output,id,input,expected_sha256)?;
    // Only THIS independent host readback can upgrade OS-exit-unverified
    // to SHA-verified. This does NOT certify any application/UI action.
    admission::verified_sha_at(root,id,pid)?;
    Ok(VerifiedReadOnlyHash{
        action_id:id.into(),sha256:expected_sha256.into(),bytes,os_pid:pid,
    })
}
/// A fixed task descriptor supplied ONLY by an internal Rust adapter after
/// owner authorization. These fields do not constitute approval themselves;
/// this module does not mint user approval or expose an IPC command.
pub(crate) struct PreparedReadOnlySha<'a>{
    pub action_id:&'a str,
    pub input:&'a Path,
    pub expected_sha256:&'a str,
}
/// Runs exactly two genuinely independent Windows SHA subprocesses. Each
/// retains its own Job Object, exact PID, admission record and OS slot.
/// Never allows these non-GUI workers into the exclusive desktop lane.
///
/// The caller MUST have separately verified owner approval for *both*
/// exact UUID+path+digest claims, and MUST provide Shuvi's combined host-RAM
/// observation. Deny missing/unavailable host observation, never assume safe.
/// Results stay separate: one successful hash cannot bless a failed worker.
#[allow(dead_code)]
pub(crate) fn run_internal_readonly_pair<F>(
    root:&Path,
    jobs:[PreparedReadOnlySha<'_>;2],
    host_over_limit:&F
)->[Result<VerifiedReadOnlyHash,String>;2]
where F:Fn()->Result<bool,String>+Sync{
    let [first,second]=jobs;
    // Prevent false independence, duplicated evidence names, or two claims
    // for the same path before either worker can launch.
    if !valid_uuid(first.action_id)||!valid_uuid(second.action_id)
        ||first.action_id==second.action_id
        ||first.input==second.input{
        return [
            Err("Duplicate/malformed read-only pair identity or source.".into()),
            Err("Duplicate/malformed read-only pair identity or source.".into())
        ];
    }
    std::thread::scope(|scope|{
        let a=scope.spawn(||run_trusted_sha256_with_guard(
            root,first.action_id,first.input,first.expected_sha256,||host_over_limit()));
        let b=scope.spawn(||run_trusted_sha256_with_guard(
            root,second.action_id,second.input,second.expected_sha256,||host_over_limit()));
        let left=a.join().unwrap_or_else(|_|Err(
            "First background SHA supervisor panicked; retained disk claims need owner review.".into()));
        let right=b.join().unwrap_or_else(|_|Err(
            "Second background SHA supervisor panicked; retained disk claims need owner review.".into()));
        [left,right]
    })
}
#[allow(dead_code)]
impl BackgroundOwned{
    fn finish(&mut self,phase:&str,code:i32)->Result<(),String>{
        if self.terminal||self.child.active_processes()?!=0{
            return Err("Background process tree is not terminal.".into());
        }
        let mut record=self.receipt.clone();
        record.phase=phase.into();
        record.exit_code=Some(code);
        publish(&self.path,&record)?;
        if self.admitted {
            let root=self.path.parent().ok_or("Background receipt root unavailable.")?;
            admission::terminal_at(root,&self.id,self.child.id(),phase,code)?;
        }
        self.receipt=record;
        self.terminal=true;
        Ok(())
    }
    /// Host memory sampling must come from existing Shuvi-wide RAM guard.
    /// The callback returning unknown is a stop condition, never a bypass.
    fn wait_with_host_guard<F>(&mut self,mut over_hard_limit:F)->Result<i32,String>
        where F:FnMut()->Result<bool,String>{
        loop{
            if self.terminal{return Err("Read-only worker already finished.".into());}
            let root=self.path.parent().ok_or("Owned read-only worker root unavailable.")?;
            // A forged/malformed stop marker is also a fail-closed condition.
            // Termination is performed only by this exact owned Job Object.
            match inspect_stop_intent(root,&self.id){
                Ok(false)=>{},
                Ok(true)=>{
                    self.cancel_exact(&self.id.clone())?;
                    return Err("Owner Stop request terminated owned SHA process; output unverified.".into());
                },
                Err(_)=>{
                    self.cancel_exact(&self.id.clone())?;
                    return Err("Background Stop identity corrupted; owned process terminated for review.".into());
                }
            }
            match over_hard_limit(){
                Ok(false)=>{},
                Ok(true)=>{self.cancel_exact(&self.id.clone())?;
                    return Err("Host RAM ceiling exceeded; read-only process terminated.".into());},
                Err(_)=>{self.cancel_exact(&self.id.clone())?;
                    return Err("Host RAM could not be verified; worker terminated.".into());}
            }
            let exited=self.child.try_wait()?;
            if let Some(code)=exited{
                if self.child.active_processes()?==0{
                    self.finish("os_exited_unverified",code)?;
                    return Ok(code);
                }
            }
            if self.start.elapsed()>=MAX_RUNTIME{
                let code=self.child.terminate_tree()?.ok_or("Background root exit unknown.")?;
                self.finish("os_timed_out_unverified",code)?;
                return Err("Read-only OS worker timed out; application result unverified.".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    fn cancel_exact(&mut self,id:&str)->Result<(),String>{
        if id!=self.id||self.terminal{
            return Err("Cannot cancel a foreign or terminal background OS worker.".into());
        }
        let code=self.child.terminate_tree()?.ok_or("Background stop exit unavailable.")?;
        self.finish("os_cancelled_unverified",code)
    }
}
impl Drop for BackgroundOwned{
    fn drop(&mut self){
        // A dropped live worker is never a successful audit. Job Object
        // KILL_ON_JOB_CLOSE still contains descendants if explicit stop fails.
        if !self.terminal {
            match self.child.terminate_tree(){
                Ok(Some(code)) if self.child.active_processes().ok()==Some(0)=>{
                    if self.finish("os_cancelled_unverified",code).is_err(){
                        // Missing durable terminal confirmation: reserve the
                        // kernel slot for the rest of this Shuvi process.
                        if let Some(slot)=self._slot.take(){std::mem::forget(slot);}
                    }
                },
                _=>{
                    // Never hand a slot to a third worker if descendant
                    // termination could not be verified.
                    if let Some(slot)=self._slot.take(){std::mem::forget(slot);}
                }
            }
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    use std::thread;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    const C:&str="3ac5c21a-8407-4ed7-b4b7-f51ba437a491";
    fn root()->PathBuf{
        let d=std::env::temp_dir().join(format!("shuvi-bg-os-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();d
    }
    fn launch(dir:&Path,id:&str)->BackgroundOwned{
        let exe=std::env::current_exe().unwrap();
        spawn_internal_readonly(dir,id,&exe,&[
            "--ignored".into(),"--exact".into(),
            "native_scheduler::background_os_workers::tests::fixture_sleep".into(),
        ],&std::env::temp_dir()).unwrap()
    }
    #[test]
    #[ignore="internal Windows read-only OS worker fixture"]
    fn fixture_sleep(){thread::sleep(Duration::from_secs(4));}
    #[test]
    fn two_real_independent_background_pids_and_third_denied(){
        let dir=root();
        let mut one=launch(&dir,A);
        let mut two=launch(&dir,B);
        assert_ne!(one.child.id(),two.child.id());
        assert!(one.child.active_processes().unwrap()>0);
        assert!(two.child.active_processes().unwrap()>0);
        assert!(spawn_internal_readonly(&dir,C,&std::env::current_exe().unwrap(),
            &[],&std::env::temp_dir()).is_err());
        assert!(!receipt_path(&dir,C).exists());
        assert!(two.cancel_exact(A).is_err());
        one.cancel_exact(A).unwrap();
        two.cancel_exact(B).unwrap();
        let first:Receipt=serde_json::from_slice(&fs::read(receipt_path(&dir,A)).unwrap()).unwrap();
        assert_eq!(first.phase,"os_cancelled_unverified");
        assert!(!first.app_verified);
        drop(one);drop(two); // release BOTH kernel slots before the replay check
        assert!(launch_again_denied(&dir,A));
        // A different UUID may still acquire a freed slot after terminal Stop.
        let mut fresh=launch(&dir,C);
        fresh.cancel_exact(C).unwrap();
        drop(fresh);
        fs::remove_dir_all(dir).unwrap();
    }
    fn launch_again_denied(root:&Path,id:&str)->bool{
        let exe=std::env::current_exe().unwrap();
        spawn_internal_readonly(root,id,&exe,&[],&std::env::temp_dir()).is_err()
    }
    #[test]
    fn two_owned_pids_follow_separate_durable_admission_and_exact_terminal_receipts(){
        let dir=root();
        let input_a=dir.join("a.bin");
        let input_b=dir.join("b.bin");
        let input_c=dir.join("c.bin");
        for p in [&input_a,&input_b,&input_c]{
            fs::write(p,b"verification input").unwrap();
        }
        let exe=std::env::current_exe().unwrap();
        let args=[
            "--ignored".into(),"--exact".into(),
            "native_scheduler::background_os_workers::tests::fixture_sleep".into()
        ];
        let mut a=spawn_admitted_readonly(&dir,A,&input_a,&"a".repeat(64),
            &exe,&args,&std::env::temp_dir()).unwrap();
        let mut b=spawn_admitted_readonly(&dir,B,&input_b,&"b".repeat(64),
            &exe,&args,&std::env::temp_dir()).unwrap();
        assert_ne!(a.child.id(),b.child.id());
        assert!(spawn_admitted_readonly(&dir,C,&input_c,&"c".repeat(64),
            &exe,&args,&std::env::temp_dir()).is_err());
        assert_eq!(read_admissions(&dir).unwrap().iter().filter(|v|v.1=="os_running").count(),2);
        a.cancel_exact(A).unwrap();
        assert_eq!(read_admissions(&dir).unwrap().iter().find(|v|v.0==A).unwrap().1,"os_cancelled_unverified");
        // Terminal OS result frees admission capacity, NOT the UUID or input.
        assert!(spawn_admitted_readonly(&dir,C,&input_a,&"c".repeat(64),
            &exe,&args,&std::env::temp_dir()).is_err());
        drop(a); // the original process slot is freed only after OS tree termination
        let mut c=spawn_admitted_readonly(&dir,C,&input_c,&"c".repeat(64),
            &exe,&args,&std::env::temp_dir()).unwrap();
        b.cancel_exact(B).unwrap();c.cancel_exact(C).unwrap();
        drop(b);drop(c);
        let snap=read_admissions(&dir).unwrap();
        assert_eq!(snap.len(),3);
        assert!(snap.iter().all(|e|e.1=="os_cancelled_unverified"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reserved_input_survives_failed_spawn_without_unsafe_auto_retry(){
        let dir=root();
        let input=dir.join("input.bin");fs::write(&input,b"read only").unwrap();
        let missing=dir.join("missing.exe");
        assert!(spawn_admitted_readonly(&dir,A,&input,&"a".repeat(64),
            &missing,&[],&std::env::temp_dir()).is_err());
        assert_eq!(read_admissions(&dir).unwrap(),vec![(A.into(),"reserved".into())]);
        let exe=std::env::current_exe().unwrap();
        assert!(spawn_admitted_readonly(&dir,A,&input,&"a".repeat(64),
            &exe,&[],&std::env::temp_dir()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn prior_result_path_or_foreign_directory_cannot_be_overwritten(){
        let d=root();
        let r=result_path(&d,A).unwrap();
        fs::write(&r,b"old output").unwrap();
        assert!(result_path(&d,A).is_err());
        fs::remove_file(&r).unwrap();
        fs::create_dir(&r).unwrap();
        assert!(result_path(&d,A).is_err());
        assert!(result_path(&d,"not-a-uuid").is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn missing_installed_sidecar_cannot_reserve_a_native_readonly_uuid(){
        let d=root();let file=d.join("input.bin");
        fs::write(&file,b"read-only fixture").unwrap();
        // The trust boundary intentionally requires an installed sidecar
        // beside the running binary. Tests cannot fabricate a signed one.
        // The malformed UUID check is deterministic even if a user happened
        // to install the sidecar alongside the test executable.
        assert!(run_trusted_sha256_with_guard(&d,"bad-id",&file,&"a".repeat(64),||Ok(false)).is_err());
        assert!(read_admissions(&d).unwrap().is_empty());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn batch_pair_rejects_duplicate_uuid_without_starting_or_reusing_a_worker(){
        let dir=root();let file=dir.join("input.bin");
        fs::write(&file,b"fixture").unwrap();
        let pair=run_internal_readonly_pair(&dir,[
            PreparedReadOnlySha{action_id:A,input:&file,expected_sha256:&"a".repeat(64)},
            PreparedReadOnlySha{action_id:A,input:&file,expected_sha256:&"a".repeat(64)},
        ],&||Err("unavailable".into()));
        assert!(pair[0].is_err()&&pair[1].is_err());
        assert!(read_admissions(&dir).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn two_background_workers_cannot_bypass_fail_closed_shared_memory_guard(){
        let dir=root();
        let f=dir.join("one.bin");let g=dir.join("two.bin");
        fs::write(&f,b"fixture").unwrap();fs::write(&g,b"fixture").unwrap();
        let pair=run_internal_readonly_pair(&dir,[
            PreparedReadOnlySha{action_id:A,input:&f,expected_sha256:&"a".repeat(64)},
            PreparedReadOnlySha{action_id:B,input:&g,expected_sha256:&"a".repeat(64)},
        ],&||Err("independent host sampler unavailable".into()));
        assert!(pair[0].is_err()&&pair[1].is_err());
        // Where the release sidecar is absent, launch refuses the work
        // BEFORE it reserves a UUID. If present, host guard kills each tree
        // without claiming a verified digest. Neither path can be declared
        // successful without independent rehash and a durable terminal.
        assert!(read_admissions(&dir).unwrap().iter()
            .all(|(_,phase)|phase!="sha256_verified"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn read_only_snapshot_never_promotes_crash_pending_or_claims_process_liveness(){
        let dir=root();let f=dir.join("input.bin");
        fs::write(&f,b"fixture").unwrap();
        admission::reserve_at(&dir,A,&f,&"a".repeat(64)).unwrap();
        let status=inspect_readonly_health(&dir).unwrap();
        assert_eq!(status.len(),1);
        assert_eq!(status[0].recorded_phase,"reserved");
        assert!(!status[0].current_file_rehashed);
        assert!(!status[0].safe_to_auto_retry);
        create_intent(&receipt_path(&dir,A),A).unwrap();
        assert_eq!(inspect_readonly_health(&dir).unwrap()[0].evidence_health,
            "work_or_crash_liveness_not_authenticated");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn cross_checked_terminal_sha_snapshot_rehashes_current_bytes_and_flags_tamper(){
        use sha2::{Digest,Sha256};
        let dir=root();let f=dir.join("input.bin");
        fs::write(&f,b"version-one").unwrap();
        let digest=format!("{:x}",Sha256::digest(b"version-one"));
        admission::reserve_at(&dir,A,&f,&digest).unwrap();
        admission::started_at(&dir,A,445).unwrap();
        admission::terminal_at(&dir,A,445,"os_exited_unverified",0).unwrap();
        admission::verified_sha_at(&dir,A,445).unwrap();
        create_intent(&receipt_path(&dir,A),A).unwrap();
        let running=Receipt{version:1,action_id:A.into(),
            class:"read_only_native_verifier".into(),phase:"os_running".into(),
            pid:Some(445),exit_code:None,app_verified:false};
        publish(&receipt_path(&dir,A),&running).unwrap();
        let done=Receipt{phase:"os_exited_unverified".into(),
            exit_code:Some(0),..running};
        publish(&receipt_path(&dir,A),&done).unwrap();
        fs::write(result_path_for_inspection(&dir,A),serde_json::json!({
            "version":1,"actionId":A,"inputSha256":digest,"inputBytes":11,
            "source":"owned_windows_sha256_sidecar"
        }).to_string()).unwrap();
        assert!(inspect_readonly_health(&dir).unwrap()[0].current_file_rehashed);
        fs::write(&f,b"version-two").unwrap();
        let stale=inspect_readonly_health(&dir).unwrap();
        assert!(!stale[0].current_file_rehashed);
        assert!(stale[0].evidence_health.contains("owner_review_required"));
        assert!(!stale[0].safe_to_auto_retry);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn owner_stop_intent_terminates_the_exact_owned_job_tree_and_records_unverified_os_exit(){
        let dir=root();let input=dir.join("approved-input.bin");
        fs::write(&input,b"some immutable test bytes").unwrap();
        let exe=std::env::current_exe().unwrap();
        let args=[
            "--ignored".into(),"--exact".into(),
            "native_scheduler::background_os_workers::tests::fixture_sleep".into()
        ];
        let mut worker=spawn_admitted_readonly(
            &dir,A,&input,&"a".repeat(64),
            &exe,&args,&std::env::temp_dir()
        ).unwrap();
        assert!(request_stop_for_child(&dir,A).unwrap());
        let err=worker.wait_with_host_guard(||Ok(false)).unwrap_err();
        assert!(err.contains("Owner Stop request terminated owned SHA process"));
        let observation=inspect_readonly_health(&dir).unwrap();
        assert_eq!(observation.len(),1);
        assert_eq!(observation[0].recorded_phase,"os_cancelled_unverified");
        assert!(observation[0].stop_requested);
        assert!(!observation[0].current_file_rehashed);
        assert!(!observation[0].safe_to_auto_retry);
        drop(worker);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stop_marker_exact_uuid_idempotent_and_never_stops_foreign_or_terminal(){
        let dir=root();let f=dir.join("a.bin");let g=dir.join("b.bin");
        fs::write(&f,b"alpha").unwrap();fs::write(&g,b"beta").unwrap();
        admission::reserve_at(&dir,A,&f,&"a".repeat(64)).unwrap();
        admission::reserve_at(&dir,B,&g,&"b".repeat(64)).unwrap();
        assert!(!request_stop_for_child(&dir,A).unwrap()); // reserved != OS live
        admission::started_at(&dir,A,444).unwrap();
        assert!(request_stop_for_child(&dir,A).unwrap());
        assert!(request_stop_for_child(&dir,A).unwrap());
        assert!(inspect_stop_intent(&dir,A).unwrap());
        assert!(!inspect_stop_intent(&dir,B).unwrap());
        assert!(!request_stop_for_child(&dir,B).unwrap());
        let path=stop_intent_path(&dir,A);
        fs::write(&path,serde_json::json!({
            "version":1,"actionId":B,"request":"owner_stop"
        }).to_string()).unwrap();
        assert!(inspect_stop_intent(&dir,A).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn unknown_launch_intent_survives_restart_and_never_reuses_uuid(){
        let d=root();
        let path=receipt_path(&d,A);
        create_intent(&path,A).unwrap();
        assert!(launch_again_denied(&d,A));
        let rec:Receipt=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(rec.phase,"launch_pending");
        assert!(!rec.app_verified);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn forged_slot_and_redirected_root_fail_closed(){
        let d=root();
        fs::create_dir(d.join("native-bg-os-slot-0.oslock")).unwrap();
        assert!(Slot::take(&d).is_err());
        let _=fs::remove_dir_all(d);
    }
    #[test]
    fn host_ram_uncertainty_terminates_exact_worker_and_is_never_success(){
        let d=root();
        let mut owned=launch(&d,A);
        let e=owned.wait_with_host_guard(||Err("probe unavailable".into())).unwrap_err();
        assert!(e.contains("could not be verified"));
        assert!(owned.terminal);
        assert!(owned.child.active_processes().unwrap()==0);
        let rec:Receipt=serde_json::from_slice(&fs::read(receipt_path(&d,A)).unwrap()).unwrap();
        assert_eq!(rec.phase,"os_cancelled_unverified");
        drop(owned);
        fs::remove_dir_all(d).unwrap();
    }
}
