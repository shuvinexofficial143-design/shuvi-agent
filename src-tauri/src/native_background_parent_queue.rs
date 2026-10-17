//! M52: durable bounded admission for multiple *independently approved*
//! READ-ONLY parent actions. Not a replacement for the exclusive GUI DAG.
//! No public Tauri dispatch / generic executable interface is provided.
//! A trusted integration MUST check each exact owner approval before enqueue.
//! Neither a queued parent nor a successful OS exit proves a user task succeeded.
#![cfg(windows)]
use serde::{Deserialize,Serialize};
use std::{collections::HashSet,fs::{self,OpenOptions},os::windows::fs::{MetadataExt,OpenOptionsExt},path::{Path,PathBuf},sync::Mutex};

const MAX_PARENTS:usize=48;
const MAX_BYTES:usize=131_072;
const MAX_IN_FLIGHT:usize=2;
const REPARSE:u32=0x400;
const OPEN_REPARSE_POINT:u32=0x0020_0000;
static TX:Mutex<()>=Mutex::new(());

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Parent {
    pub parent_id:String,
    pub task_class:String,
    pub input_path:String,
    pub expected_sha256:String,
    pub depends_on:Vec<String>,
    pub priority:u8,
    pub ordinal:u64,
    pub enqueued_round:u64,
    pub phase:String,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Queue {
    version:u32,
    next_ordinal:u64,
    dispatch_round:u64,
    parents:Vec<Parent>,
}
impl Default for Queue{
    fn default()->Self{Self{version:1,next_ordinal:1,dispatch_round:0,parents:Vec::new()}}
}
fn valid_sha(s:&str)->bool{
    s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))
}
fn active(p:&Parent)->bool{
    // UNKNOWN claims remain held until an independently authorized owner
    // reconciliation. No TTL, process-heartbeat or automatic re-admission.
    matches!(p.phase.as_str(),"admitted"|"outcome_unknown")
}
fn validate(q:&Queue)->Result<(),String>{
    if q.version!=1||q.parents.len()>MAX_PARENTS||q.next_ordinal==0{
        return Err("Parent queue version/count invalid.".into());
    }
    let mut seen=HashSet::<String>::new();
    let mut seen_orders=HashSet::<u64>::new();
    let mut active_paths=HashSet::<&str>::new();
    let mut active_count=0;
    let mut prior_ordinal=0u64;
    let mut prior_round=0u64;
    for p in &q.parents{
        if !super::valid_uuid(&p.parent_id)||!seen_orders.insert(p.ordinal)
            ||p.ordinal==0||p.ordinal>=q.next_ordinal
            ||p.enqueued_round>q.dispatch_round
            ||p.task_class!="read_only_sha256"
            ||!valid_sha(&p.expected_sha256)
            ||p.input_path.len()>4096||!Path::new(&p.input_path).is_absolute()
            ||p.input_path!=p.input_path.to_lowercase()
            ||p.priority>2||p.depends_on.len()>7
            ||!matches!(p.phase.as_str(),"queued"|"admitted"|"sha256_verified"|"outcome_unknown")
        {
            return Err("Parent queue identity/class/state is invalid.".into());
        }
        if p.ordinal<=prior_ordinal||p.enqueued_round<prior_round{
            return Err("Parent queue append-only ordering was altered.".into());
        }
        prior_ordinal=p.ordinal;
        prior_round=p.enqueued_round;
        if p.depends_on.windows(2).any(|x|x[0]>=x[1])
            ||p.depends_on.iter().any(|d|!seen.contains(d)){
            return Err("Parent dependencies must be distinct, sorted, earlier approved UUIDs.".into());
        }
        if p.phase!="queued" && p.depends_on.iter().any(|id|
            q.parents.iter().find(|x|x.parent_id==*id)
                .is_none_or(|x|x.phase!="sha256_verified")){
            return Err("Parent was admitted without independently verified dependencies.".into());
        }
        if active(p){
            active_count+=1;
            if !active_paths.insert(&p.input_path){
                return Err("Two held parents claim the same input resource.".into());
            }
        }
        if !seen.insert(p.parent_id.clone()){
            return Err("Parent action UUID is replayed.".into());
        }
    }
    if active_count>MAX_IN_FLIGHT{
        return Err("Parent queue exceeded two held background slots.".into());
    }
    Ok(())
}
fn check_bytes(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Parent queue exceeded durable byte limit.".into());}
    let q:Queue=serde_json::from_slice(raw)
        .map_err(|_|"Parent queue JSON corrupt.".to_string())?;
    validate(&q)
}
fn root_file(root:&Path)->Result<PathBuf,String>{
    let m=fs::symlink_metadata(root).map_err(|_|"Parent queue root missing.")?;
    if !m.is_dir()||m.file_type().is_symlink()||m.file_attributes()&REPARSE!=0{
        return Err("Parent queue root redirected.".into());
    }
    Ok(root.join("native-background-parent-queue.json"))
}
struct OsLock(fs::File);
impl OsLock{
    fn take(path:&Path)->Result<Self,String>{
        let lock=path.with_extension("json.oslock");
        match fs::symlink_metadata(&lock){
            Ok(m) if m.is_file()&&!m.file_type().is_symlink()
                &&m.file_attributes()&REPARSE==0=>{},
            Ok(_)=>return Err("Parent queue OS lock redirected.".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("Parent queue OS lock inaccessible.".into()),
        }
        let f=OpenOptions::new().read(true).write(true).create(true)
            .share_mode(0).custom_flags(OPEN_REPARSE_POINT).open(&lock)
            .map_err(|_|"Another Shuvi instance owns parent queue journal.")?;
        let m=f.metadata().map_err(|_|"Parent OS lock handle unreadable.")?;
        if !m.is_file()||m.file_attributes()&REPARSE!=0{
            return Err("Parent queue OS lock handle redirected.".into());
        }
        Ok(Self(f))
    }
}
fn load(file:&Path)->Result<Queue,String>{
    match fs::symlink_metadata(file){
        Ok(m) if m.is_file()&&!m.file_type().is_symlink()
            &&m.file_attributes()&REPARSE==0=>{},
        Ok(_)=>return Err("Parent queue primary redirected.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{
            for ext in ["json.bak","json.tmp"]{
                match fs::symlink_metadata(file.with_extension(ext)){
                    Ok(_)=>return Err("Interrupted parent queue needs owner review.".into()),
                    Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
                    Err(_)=>return Err("Parent queue recovery path inaccessible.".into()),
                }
            }
            return Ok(Queue::default());
        },
        Err(_)=>return Err("Parent queue primary inaccessible.".into()),
    }
    if fs::symlink_metadata(file.with_extension("json.tmp")).is_ok(){
        return Err("Interrupted parent queue temporary journal needs review.".into());
    }
    let raw=crate::read_file_bytes_bounded(file,MAX_BYTES,"parent queue")?;
    check_bytes(&raw)?;
    serde_json::from_slice(&raw).map_err(|_|"Parent queue cannot decode.".into())
}
fn save(file:&Path,q:&Queue)->Result<(),String>{
    validate(q)?;
    let raw=serde_json::to_vec(q).map_err(|_|"Cannot serialize parent queue.")?;
    if raw.len()>MAX_BYTES{return Err("Parent queue full.".into());}
    crate::premiere_store::replace(file,&raw,MAX_BYTES,check_bytes)
}
/// Input data is an exact, previously owner-approved descriptor as verified
/// by the trusted caller. Queue never grants permissions or chooses programs.
pub(crate) struct ApprovedParent<'a>{
    pub id:&'a str,
    pub input:&'a Path,
    pub sha256:&'a str,
    pub depends_on:&'a [&'a str],
    pub priority:u8,
}
#[allow(dead_code)]
pub(crate) fn enqueue_approved_at(root:&Path,requested:ApprovedParent<'_>)->Result<(),String>{
    if !super::valid_uuid(requested.id)||!valid_sha(requested.sha256)
        ||requested.priority>2||requested.depends_on.len()>7{
        return Err("Parent needs canonical approved UUID, SHA, and bounded class.".into());
    }
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    let mut q=load(&file)?;
    if q.parents.len()>=MAX_PARENTS||q.parents.iter().any(|p|p.parent_id==requested.id){
        return Err("Parent history full or action UUID replayed.".into());
    }
    // File identity is rechecked by the pre-existing M46 admission and M47
    // SHA sidecar again at dispatch; no alternate hard-link path is admitted.
    let input=super::admission::checked_input(requested.input)?;
    let mut deps:Vec<String>=requested.depends_on.iter().map(|x|x.to_string()).collect();
    deps.sort();
    if deps.windows(2).any(|x|x[0]==x[1])
        ||deps.iter().any(|d|!q.parents.iter().any(|p|p.parent_id==*d)){
        return Err("Dependency is duplicated, missing or newer than parent.".into());
    }
    let order=q.next_ordinal;
    q.next_ordinal=q.next_ordinal.checked_add(1)
        .ok_or("Parent queue sequence overflow.")?;
    q.parents.push(Parent{
        parent_id:requested.id.into(),task_class:"read_only_sha256".into(),
        input_path:input,expected_sha256:requested.sha256.into(),
        depends_on:deps,priority:requested.priority,ordinal:order,
        enqueued_round:q.dispatch_round,phase:"queued".into(),
    });
    save(&file,&q)
}
/// Choose independent parent fairly using bounded priority aging.
/// An old low-priority ready job eventually overtakes newer high priority.
/// A held UNKNOWN keeps both its claim and capacity; no false liveness.
fn ready_index(q:&Queue)->Option<usize>{
    if q.parents.iter().filter(|p|active(p)).count()>=MAX_IN_FLIGHT{
        return None;
    }
    let held:HashSet<&str>=q.parents.iter().filter(|p|active(p))
        .map(|p|p.input_path.as_str()).collect();
    q.parents.iter().enumerate().filter(|(_,p)|{
        p.phase=="queued"&&!held.contains(p.input_path.as_str())
        &&p.depends_on.iter().all(|id|q.parents.iter().any(|x|
            x.parent_id==*id&&x.phase=="sha256_verified"))
    }).max_by(|(_,a),(_,b)|{
        let score=|p:&Parent|{
            (p.priority as u64)*2 + q.dispatch_round
                .saturating_sub(p.enqueued_round).min(12)
        };
        score(a).cmp(&score(b)).then_with(||b.ordinal.cmp(&a.ordinal))
    }).map(|(i,_)|i)
}
// Always reverify current dependency bytes before any durable admission.
fn check_deps(root:&Path,q:&Queue,id:&str,seen:&mut HashSet<String>)
    ->Result<(),String>{
    if !seen.insert(id.to_owned()){return Ok(());}
    let parent=q.parents.iter().find(|p|p.parent_id==id)
        .ok_or("Parent dependency disappeared.")?;
    if parent.phase!="sha256_verified"{
        return Err("Parent dependency is not SHA-verified.".into());
    }
    let claim=super::admission::snapshot_detailed_at(root)?
        .into_iter().find(|x|x.action_id==id)
        .ok_or("Parent dependency has no authenticated OS record.")?;
    if claim.phase!="sha256_verified"
        ||claim.input_path!=parent.input_path
        ||claim.expected_sha256!=parent.expected_sha256{
        return Err("Parent dependency OS identity does not match.".into());
    }
    let receipt=root.join(format!("native-bg-hash-{id}.json"));
    super::hash_readback::verify(&receipt,id,Path::new(&parent.input_path),
        &parent.expected_sha256)?;
    for dep in &parent.depends_on{check_deps(root,q,dep,seen)?;}
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn claim_next_at(root:&Path)->Result<Option<Parent>,String>{
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    let mut q=load(&file)?;
    let Some(index)=ready_index(&q) else{return Ok(None)};
    // A historical sha256_verified phase is never proof of CURRENT bytes.
    // Verify EVERY transitive prerequisite against the exact OS admission
    // and independently rehash its current input before admitting work.
    let mut seen=HashSet::new();
    for dep in &q.parents[index].depends_on{
        check_deps(root,&q,dep,&mut seen)?;
    }
    // Durable parent claim BEFORE any M46 launch. Crash is UNKNOWN, not idle.
    q.parents[index].phase="admitted".into();
    q.dispatch_round=q.dispatch_round.checked_add(1)
        .ok_or("Parent dispatch sequence overflow.")?;
    let claimed=q.parents[index].clone();
    save(&file,&q)?;
    Ok(Some(claimed))
}
/// Only actual independently rehashed M47 SHA evidence can complete a parent.
/// Freshly rehash actual current bytes, and require authoritative child ledger.
fn verified_receipt(root:&Path,p:&Parent,evidence:&super::VerifiedReadOnlyHash)
    ->Result<(),String>{
    if p.parent_id!=evidence.action_id||p.expected_sha256!=evidence.sha256
        ||evidence.os_pid==0||evidence.bytes==0{
        return Err("Parent proof differs from exact approved input/action.".into());
    }
    let claim=super::admission::snapshot_detailed_at(root)?
        .into_iter().find(|x|x.action_id==p.parent_id)
        .ok_or("Approved parent has no authoritative OS admission.")?;
    if claim.phase!="sha256_verified"||claim.pid!=Some(evidence.os_pid)
        ||claim.expected_sha256!=p.expected_sha256
        ||claim.input_path!=p.input_path {
        return Err("Parent proof disagrees with durable child UUID/PID/input.".into());
    }
    let receipt=root.join(format!("native-bg-hash-{}.json",p.parent_id));
    let bytes=super::hash_readback::verify(&receipt,&p.parent_id,
        Path::new(&p.input_path),&p.expected_sha256)?;
    if bytes!=evidence.bytes {
        return Err("Parent proof byte count disagrees with current file.".into());
    }
    Ok(())
}
fn transition_at(root:&Path,id:&str,proof:Option<&super::VerifiedReadOnlyHash>)
    ->Result<(),String>{
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    let mut q=load(&file)?;
    let p=q.parents.iter_mut().find(|p|p.parent_id==id)
        .ok_or("Unknown independently approved parent.")?;
    if p.phase!="admitted"{
        return Err("Only exact admitted parent may become terminal.".into());
    }
    if let Some(e)=proof {
        verified_receipt(root,p,e)?;
        p.phase="sha256_verified".into();
    }else{
        p.phase="outcome_unknown".into();
    }
    save(&file,&q)
}
/// Internal ready-parent dispatch; separate invocations can run on distinct
/// threads and use the existing two kernel OS slots. Caller must have already
/// supplied independently verified owner approvals to enqueue_approved_at.
#[allow(dead_code)]
pub(crate) fn run_next_approved<F>(root:&Path,mut ram_over_limit:F)
    ->Result<Option<super::VerifiedReadOnlyHash>,String>
where F:FnMut()->Result<bool,String>{
    let Some(parent)=claim_next_at(root)? else{return Ok(None)};
    run_claimed_parent(root,&parent,||ram_over_limit()).map(Some)
}
// Dispatch a parent ALREADY claimed durably, never mint additional approvals.
fn run_claimed_parent<F>(root:&Path,parent:&Parent,mut ram_over_limit:F)
    ->Result<super::VerifiedReadOnlyHash,String>
where F:FnMut()->Result<bool,String>{
    let outcome=super::run_trusted_sha256_with_guard(
        root,&parent.parent_id,Path::new(&parent.input_path),
        &parent.expected_sha256,||ram_over_limit());
    match outcome{
        Ok(proof)=>{
            if let Err(e)=transition_at(root,&parent.parent_id,Some(&proof)){
                let _=transition_at(root,&parent.parent_id,None);
                return Err(e);
            }
            Ok(proof)
        },
        Err(e)=>{
            transition_at(root,&parent.parent_id,None)?;
            Err(e)
        }
    }
}
/// M54: owner approved EXACT two parent IDs. The pinned pair is claimed
/// as ONE atomic OS-locked journal transaction, or not claimed at all.
/// A new/reordered/blocked queue fails closed before any OS worker launch.
fn claim_exact_pair_at(root:&Path,ids:[&str;2])->Result<[Parent;2],String>{
    if !super::valid_uuid(ids[0])||!super::valid_uuid(ids[1])||ids[0]==ids[1]{
        return Err("Two distinct canonical owner-approved parent IDs are required.".into());
    }
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    let mut q=load(&file)?;
    let mut selected=Vec::with_capacity(2);
    for id in ids{
        let index=ready_index(&q)
            .ok_or("Pinned approved parent is no longer ready or both slots are held.")?;
        if q.parents[index].parent_id!=id {
            return Err("Pinned owner-approved parent order changed; prepare approval again.".into());
        }
        let mut seen=HashSet::new();
        for dep in &q.parents[index].depends_on {
            check_deps(root,&q,dep,&mut seen)?;
        }
        q.parents[index].phase="admitted".into();
        q.dispatch_round=q.dispatch_round.checked_add(1)
            .ok_or("Exact approved pair dispatch round overflow.")?;
        selected.push(q.parents[index].clone());
    }
    // Exactly two immutable claims, one durable replace. A validation failure
    // above leaves all parents QUEUED; no partial reserved UUID.
    save(&file,&q)?;
    let pair:[Parent;2]=selected.try_into()
        .map_err(|_|"Exact approved parent pair internal count invalid.")?;
    Ok(pair)
}
/// Executes the exact two separately OWNER-APPROVED parent UUIDs and no others.
/// Shared host callback must reserve both child 512 MiB limits within 4 GiB.
#[allow(dead_code)]
pub(crate) fn run_exact_approved_pair<F>(
    root:&Path,ids:[&str;2],host_ram_over_limit:&F
)->[Result<super::VerifiedReadOnlyHash,String>;2]
where F:Fn()->Result<bool,String>+Sync{
    let [first,second]=match claim_exact_pair_at(root,ids){
        Ok(pair)=>pair,
        Err(e)=>return [Err(e.clone()),Err(e)],
    };
    std::thread::scope(|scope|{
        let a=scope.spawn(||run_claimed_parent(root,&first,||host_ram_over_limit()));
        let b=scope.spawn(||run_claimed_parent(root,&second,||host_ram_over_limit()));
        [
            a.join().unwrap_or_else(|_|Err(
                "First pinned parent supervisor panicked; claim needs owner review.".into())),
            b.join().unwrap_or_else(|_|Err(
                "Second pinned parent supervisor panicked; claim needs owner review.".into()))
        ]
    })
}
/// M53: dispatch TWO separately owner-approved PARENT UUIDs concurrently.
/// Enqueue permissions happen per parent before this call; dispatch never
/// invents approval or accepts executable paths. The caller MUST reserve
/// BOTH 512 MiB ceilings against the original 4 GiB host guard in its
/// supplied callback (and fail closed if observation is unavailable).
///
/// Each thread independently claims its exact parent under the durable OS
/// journal lock BEFORE touching the existing M45–M52 Windows OS child slot.
/// No globally exclusive GUI/Adobe/Blender action is dispatched here.
/// Results remain separate; one failed parent cannot certify its sibling.
/// An unwinding thread preserves its admitted/OS claims for owner review.
#[allow(dead_code)]
pub(crate) fn run_two_ready_approved<F>(
    root:&Path, host_ram_over_limit:&F
)->[Result<Option<super::VerifiedReadOnlyHash>,String>;2]
where F:Fn()->Result<bool,String>+Sync{
    std::thread::scope(|scope|{
        let left=scope.spawn(||run_next_approved(root,||host_ram_over_limit()));
        let right=scope.spawn(||run_next_approved(root,||host_ram_over_limit()));
        let a=left.join().unwrap_or_else(|_|Err(
            "First approved parent dispatcher panicked; durable claim needs owner review.".into()));
        let b=right.join().unwrap_or_else(|_|Err(
            "Second approved parent dispatcher panicked; durable claim needs owner review.".into()));
        [a,b]
    })
}
/// Owner-facing controller can use this only AFTER authenticating exact owner
/// authorization for this parent UUID. It does not kill a foreign PID.
/// True = exact STOP INTENT durably requested, never verified termination.
/// If parent was claimed but OS launch has not yet been recorded, return
/// false (no fabricated stop) while its parent claim remains held.
#[allow(dead_code)]
pub(crate) fn request_exact_parent_stop_at(root:&Path,id:&str)->Result<bool,String>{
    if !super::valid_uuid(id){return Err("Stop requires exact approved parent UUID.".into());}
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    let q=load(&file)?;
    let parent=q.parents.iter().find(|p|p.parent_id==id)
        .ok_or("Owner Stop parent UUID was never queued.")?;
    if parent.phase!="admitted"{return Ok(false);}
    let claim=super::admission::snapshot_detailed_at(root)?.into_iter()
        .find(|x|x.action_id==id);
    match claim{
        Some(c) if c.phase=="os_running"&&c.input_path==parent.input_path
            &&c.expected_sha256==parent.expected_sha256=>{
                super::request_stop_for_child(root,id)
            },
        Some(c) if c.phase=="reserved"&&c.input_path==parent.input_path
            &&c.expected_sha256==parent.expected_sha256=>Ok(false),
        None=>Ok(false), // Parent durable claim exists, OS spawn not proven.
        _=>Err("Parent Stop OS identity is mismatched or terminal; owner review required.".into()),
    }
}
/// Read-only durable projection. No query implies current PID liveness.
#[allow(dead_code)]
pub(crate) fn snapshot_at(root:&Path)->Result<Vec<Parent>,String>{
    let file=root_file(root)?;
    let _local=TX.lock().map_err(|_|"Parent queue lock poisoned.")?;
    let _os=OsLock::take(&file)?;
    Ok(load(&file)?.parents)
}

#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    const C:&str="3ac5c21a-8407-4ed7-b4b7-f51ba437a491";
    const D:&str="f82ae599-ed51-4771-891e-f6a189daa457";
    fn dir()->PathBuf{
        let d=std::env::temp_dir().join(format!("shuvi-parent-queue-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();d
    }
    fn input(d:&Path,name:&str)->PathBuf{
        let file=d.join(name);fs::write(&file,b"approved fixture bytes").unwrap();file
    }
    fn add(d:&Path,id:&str,file:&Path,priority:u8,deps:&[&str])->Result<(),String>{
        enqueue_approved_at(d,ApprovedParent{
            id,input:file,sha256:&"a".repeat(64),depends_on:deps,priority,
        })
    }
    #[test]
    fn multiple_distinct_parents_are_durably_queued_prioritized_and_bounded(){
        let d=dir();let a=input(&d,"a");let b=input(&d,"b");let c=input(&d,"c");
        add(&d,A,&a,0,&[]).unwrap();add(&d,B,&b,2,&[]).unwrap();
        add(&d,C,&c,1,&[]).unwrap();
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,B);
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,C);
        assert!(claim_next_at(&d).unwrap().is_none()); // two held kernel lanes
        assert_eq!(snapshot_at(&d).unwrap().iter().filter(|x|x.phase=="admitted").count(),2);
        assert!(add(&d,A,&a,0,&[]).is_err()); // durable replay denial
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn verified_dependencies_cannot_be_invented_by_queue_or_os_exit(){
        let d=dir();let a=input(&d,"a");let b=input(&d,"b");
        assert!(add(&d,B,&b,0,&[A]).is_err());
        add(&d,A,&a,0,&[]).unwrap();
        add(&d,B,&b,0,&[A]).unwrap();
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,A);
        assert!(claim_next_at(&d).unwrap().is_none());
        assert!(transition_at(&d,A,None).is_ok());
        assert!(claim_next_at(&d).unwrap().is_none());
        assert_eq!(snapshot_at(&d).unwrap()[0].phase,"outcome_unknown");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn forged_success_without_real_sha_receipt_cannot_promote_parent(){
        let d=dir();let a=input(&d,"a");
        add(&d,A,&a,0,&[]).unwrap();claim_next_at(&d).unwrap();
        let forged=super::super::VerifiedReadOnlyHash{
            action_id:A.into(),sha256:"a".repeat(64),bytes:22,os_pid:1325
        };
        assert!(transition_at(&d,A,Some(&forged)).is_err());
        assert_eq!(snapshot_at(&d).unwrap()[0].phase,"admitted");
        assert!(transition_at(&d,B,None).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn kernel_lock_corrupt_primary_and_interrupted_recovery_fail_closed(){
        let d=dir();let a=input(&d,"a");let file=root_file(&d).unwrap();
        let guard=OsLock::take(&file).unwrap();
        assert!(add(&d,A,&a,0,&[]).is_err());drop(guard);
        fs::write(&file,b"{").unwrap();
        assert!(add(&d,A,&a,0,&[]).is_err());
        fs::remove_file(&file).unwrap();
        fs::write(file.with_extension("json.tmp"),b"interrupted").unwrap();
        assert!(claim_next_at(&d).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn same_input_stays_serialized_and_unknown_preserves_capacity(){
        let d=dir();let a=input(&d,"same");
        add(&d,A,&a,2,&[]).unwrap();add(&d,B,&a,2,&[]).unwrap();
        claim_next_at(&d).unwrap();
        assert!(claim_next_at(&d).unwrap().is_none());
        transition_at(&d,A,None).unwrap(); // unknown source retained
        assert!(claim_next_at(&d).unwrap().is_none());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn authentic_sha_parent_enables_dependency_but_tampering_revokes_readiness(){
        use sha2::{Digest,Sha256};
        let d=dir();
        let a=input(&d,"root.bin");let b=input(&d,"child.bin");
        let bytes=fs::read(&a).unwrap();
        let digest=format!("{:x}",Sha256::digest(&bytes));
        enqueue_approved_at(&d,ApprovedParent{
            id:A,input:&a,sha256:&digest,depends_on:&[],priority:1,
        }).unwrap();
        add(&d,B,&b,0,&[A]).unwrap();
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,A);
        // OS admission + independently readback-protected result fixtures.
        super::super::admission::reserve_at(&d,A,&a,&digest).unwrap();
        super::super::admission::started_at(&d,A,8234).unwrap();
        super::super::admission::terminal_at(&d,A,8234,"os_exited_unverified",0).unwrap();
        super::super::admission::verified_sha_at(&d,A,8234).unwrap();
        fs::write(d.join(format!("native-bg-hash-{A}.json")),serde_json::json!({
            "version":1,"actionId":A,"inputSha256":digest,
            "inputBytes":bytes.len(),"source":"owned_windows_sha256_sidecar"
        }).to_string()).unwrap();
        let verified=super::super::VerifiedReadOnlyHash{
            action_id:A.into(),sha256:digest.clone(),bytes:bytes.len() as u64,os_pid:8234
        };
        transition_at(&d,A,Some(&verified)).unwrap();
        assert_eq!(snapshot_at(&d).unwrap()[0].phase,"sha256_verified");
        // A stored success cannot authorize a fresh parent after source mutation.
        fs::write(&a,b"tampered bytes").unwrap();
        assert!(claim_next_at(&d).is_err());
        assert_eq!(snapshot_at(&d).unwrap()[1].phase,"queued");
        // Restoring exact bytes is independently reverified before dispatch.
        fs::write(&a,&bytes).unwrap();
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,B);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn two_independent_parent_claims_race_safely_under_os_journal_lock(){
        use std::sync::{Arc,Barrier};
        let d=dir();let a=input(&d,"independent-a");let b=input(&d,"independent-b");
        let c=input(&d,"independent-c");
        add(&d,A,&a,2,&[]).unwrap();add(&d,B,&b,1,&[]).unwrap();
        add(&d,C,&c,0,&[]).unwrap();
        let gate=Arc::new(Barrier::new(3));
        let first=Arc::clone(&gate);let second=Arc::clone(&gate);
        let left=d.clone();let right=d.clone();
        let (one,two)=std::thread::scope(|scope|{
            let a=scope.spawn(||{first.wait();claim_next_at(&left).unwrap().unwrap()});
            let b=scope.spawn(||{second.wait();claim_next_at(&right).unwrap().unwrap()});
            gate.wait();(a.join().unwrap(),b.join().unwrap())
        });
        assert_ne!(one.parent_id,two.parent_id);
        let ids=HashSet::from([one.parent_id.as_str(),two.parent_id.as_str()]);
        assert_eq!(ids,HashSet::from([A,B]));
        assert!(claim_next_at(&d).unwrap().is_none());
        transition_at(&d,&one.parent_id,None).unwrap();
        // Unknown cannot free capacity merely because a host thread exited.
        assert!(claim_next_at(&d).unwrap().is_none());
        assert_eq!(snapshot_at(&d).unwrap().iter()
            .filter(|p|active(p)).count(),2);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn bounded_priority_aging_prevents_old_low_priority_parent_starvation(){
        let mut q=Queue::default();q.dispatch_round=15;q.next_ordinal=4;
        for (id,priority,ordinal,round) in [
            (A,0,1,0),(B,2,2,14),(C,1,3,15)
        ]{
            q.parents.push(Parent{
                parent_id:id.into(),task_class:"read_only_sha256".into(),
                input_path:format!("C:\\\\queue\\\\{ordinal}.bin").to_lowercase(),
                expected_sha256:"a".repeat(64),depends_on:vec![],
                priority,ordinal,enqueued_round:round,phase:"queued".into(),
            });
        }
        validate(&q).unwrap();
        assert_eq!(q.parents[ready_index(&q).unwrap()].parent_id,A);
        // Without aging, the new high-priority B would win instead.
    }
    #[test]
    fn parent_stop_cannot_claim_process_termination_without_owned_os_pid(){
        let d=dir();let a=input(&d,"owner-stop");
        add(&d,A,&a,0,&[]).unwrap();
        assert!(!request_exact_parent_stop_at(&d,A).unwrap());
        claim_next_at(&d).unwrap();
        assert!(!request_exact_parent_stop_at(&d,A).unwrap());
        assert!(request_exact_parent_stop_at(&d,B).is_err());
        assert_eq!(snapshot_at(&d).unwrap()[0].phase,"admitted");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn m54_pinned_two_parent_claim_is_atomic_and_rejects_any_changed_owner_selection(){
        let d=dir();
        let a=input(&d,"pinned-a");let b=input(&d,"pinned-b");
        let c=input(&d,"pinned-c");
        add(&d,A,&a,0,&[]).unwrap();
        add(&d,B,&b,2,&[]).unwrap();
        add(&d,C,&c,1,&[]).unwrap();
        // Current fairness order: B then C; a stale owner selection must
        // NOT launch B alone before discovering the second ID mismatch.
        assert!(claim_exact_pair_at(&d,[B,A]).is_err());
        assert!(snapshot_at(&d).unwrap().iter().all(|p|p.phase=="queued"));
        assert!(claim_exact_pair_at(&d,[B,B]).is_err());
        assert!(claim_exact_pair_at(&d,[A,C]).is_err());
        let ids=claim_exact_pair_at(&d,[B,C]).unwrap();
        assert_eq!(ids[0].parent_id,B);
        assert_eq!(ids[1].parent_id,C);
        assert_eq!(snapshot_at(&d).unwrap().iter().filter(|p|p.phase=="admitted").count(),2);
        assert!(claim_exact_pair_at(&d,[B,C]).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn m54_same_input_or_held_unknown_cannot_be_pinned_as_distinct_resources(){
        let d=dir();
        let path=input(&d,"shared-source");
        add(&d,A,&path,2,&[]).unwrap();
        add(&d,B,&path,1,&[]).unwrap();
        assert!(claim_exact_pair_at(&d,[A,B]).is_err());
        assert!(snapshot_at(&d).unwrap().iter().all(|p|p.phase=="queued"));
        assert_eq!(claim_next_at(&d).unwrap().unwrap().parent_id,A);
        transition_at(&d,A,None).unwrap();
        assert!(claim_exact_pair_at(&d,[B,A]).is_err());
        assert_eq!(snapshot_at(&d).unwrap()[0].phase,"outcome_unknown");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn malformed_queue_cannot_resurrect_or_reorder_verified_parents(){
        let d=dir();let a=input(&d,"a");add(&d,A,&a,0,&[]).unwrap();
        let file=root_file(&d).unwrap();
        let mut raw:serde_json::Value=serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        raw["parents"][0]["phase"]=serde_json::json!("sha256_verified");
        raw["parents"][0]["dependsOn"]=serde_json::json!([C]);
        fs::write(&file,serde_json::to_vec(&raw).unwrap()).unwrap();
        assert!(snapshot_at(&d).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
