//! Owner-entered Windows commands. Durable admission is NOT execution
//! authority. An interrupted claim is never automatically replayed.
use serde::{Deserialize,Serialize};
use std::{fs,fs::OpenOptions,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
use uuid::Uuid;

const MAX_BYTES:usize=32_768;
const MAX_ITEMS:usize=8;
static LOCK:Mutex<()>=Mutex::new(());

struct CrossProcessLock(fs::File);
impl CrossProcessLock {
 fn take(path:&Path)->Result<Self,String>{
  let lock=path.with_extension("queue.lock");
  #[cfg(windows)]{
   use std::os::windows::fs::{OpenOptionsExt,MetadataExt};
   let f=OpenOptions::new().read(true).write(true).create(true).share_mode(0)
    .custom_flags(0x0020_0000).open(&lock)
    .map_err(|_|"Other Shuvi process owns command queue.".to_string())?;
   if !f.metadata().map_err(|_|"Queue lock metadata unavailable.")?.is_file()||
      f.metadata().map_err(|_|"Queue lock metadata unavailable.")?.file_attributes()&0x400!=0{
    return Err("Queue lock is a reparse point.".into());
   }
   Ok(Self(f))
  }
  #[cfg(unix)]{
   use std::os::fd::AsRawFd;
   unsafe extern "C" {fn flock(fd:i32,operation:i32)->i32;}
   let f=OpenOptions::new().read(true).write(true).create(true).open(&lock)
    .map_err(|_|"Queue OS lock unavailable.".to_string())?;
   if unsafe{flock(f.as_raw_fd(),2|4)}!=0{return Err("Queue is in use by another process.".into());}
   Ok(Self(f))
  }
  #[cfg(not(any(windows,unix)))]{Err("Native OS queue lock unsupported.".into())}
 }
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct QueuedCommand{
 pub id:String,
 pub thread_id:String,
 pub prompt_index:u32,
 pub text:String,
 pub phase:String,
 pub queued_at_ms:u64,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Queue{version:u32,items:Vec<QueuedCommand>}
fn valid(q:&Queue)->Result<(),String>{
 if q.version!=1||q.items.len()>MAX_ITEMS{return Err("Command queue size/version invalid.".into());}
 let mut ids=std::collections::HashSet::new();
 for (i,x) in q.items.iter().enumerate(){
  if Uuid::parse_str(&x.id).map(|u|u.to_string()!=x.id).unwrap_or(true)||
   !ids.insert(x.id.as_str())||x.thread_id.is_empty()||x.thread_id.len()>128||
   !x.thread_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')||
   x.prompt_index>1_000_000||x.text.trim().is_empty()||x.text.len()>2500||
   x.text.chars().any(|c|c.is_control()&&!matches!(c,'\n'|'\r'|'\t'))||
   !matches!(x.phase.as_str(),"queued"|"claimed")||x.queued_at_ms==0||
   (i>0&&x.phase=="claimed"){
   return Err("Command queue contains unsafe or replayable entry.".into());
  }
 }
 Ok(())
}
fn read_at(path:&Path)->Result<Queue,String>{
 let backup=path.with_extension("json.bak");
 if !path.exists()&&!backup.exists(){return Ok(Queue{version:1,items:vec![]});}
 let read=|file:&Path|->Result<Queue,String>{
  let bytes=crate::read_file_bytes_bounded(file,MAX_BYTES,"queued command")?;
  let q:Queue=serde_json::from_slice(&bytes).map_err(|_|"Command queue JSON invalid.")?;
  valid(&q)?;Ok(q)
 };
 // Queue claims are one-shot side-effect boundaries. A backup may still
 // contain a pre-claim "queued" state: falling back could buy another AI
 // request or duplicate a Premiere mutation after a partial disk write.
 // Corrupt/missing primary with a backup is quarantined, NEVER replayed.
 if !path.exists(){return Err("Native command queue primary missing; old backup cannot authorize replay.".into());}
 read(path)
}
fn store(path:&Path,q:&Queue)->Result<(),String>{
 valid(q)?;
 let bytes=serde_json::to_vec(q).map_err(|_|"Cannot encode command queue.")?;
 crate::premiere_store::replace(path,&bytes,MAX_BYTES,|b|{
  let v:Queue=serde_json::from_slice(b).map_err(|_|"Command queue bytes invalid.")?;
  valid(&v)
 })
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
 let dir=app.path().app_data_dir().map_err(|_|"Queue app directory unavailable.")?;
 fs::create_dir_all(&dir).map_err(|_|"Queue directory unavailable.")?;
 Ok(dir.join("native-command-queue.json"))
}
fn with_queue<T>(file:&Path,apply:impl FnOnce(&mut Queue)->Result<(T,bool),String>)->Result<T,String>{
 let _g=LOCK.lock().map_err(|_|"Command queue state poisoned.")?;
 let _os=CrossProcessLock::take(file)?;
 let mut q=read_at(file)?;
 let (result,changed)=apply(&mut q)?;
 if changed{store(file,&q)?;}
 Ok(result)
}
fn add_at(file:&Path,thread_id:&str,prompt_index:u32,text:&str,now:u64)
 ->Result<QueuedCommand,String>{
 with_queue(file,|q|{
  if now==0||q.items.len()>=MAX_ITEMS{return Err("Queued Windows command limit reached.".into());}
  let cmd=QueuedCommand{id:Uuid::new_v4().to_string(),thread_id:thread_id.into(),
   prompt_index,text:text.into(),phase:"queued".into(),queued_at_ms:now};
  q.items.push(cmd.clone());valid(q)?;Ok((cmd,true))
 })
}
fn first_at(file:&Path)->Result<Option<QueuedCommand>,String>{
 with_queue(file,|q|Ok((q.items.first().cloned(),false)))
}
fn claim_at(file:&Path,id:&str)->Result<QueuedCommand,String>{
 with_queue(file,|q|{
  let x=q.items.first_mut().ok_or("No queued command.")?;
  if x.id!=id||x.phase!="queued"{return Err("Command already claimed or queue identity mismatch.".into());}
  x.phase="claimed".into();Ok((x.clone(),true))
 })
}
fn finish_at(file:&Path,id:&str)->Result<(),String>{
 with_queue(file,|q|{
  let x=q.items.first().ok_or("No claimed command.")?;
  if x.id!=id||x.phase!="claimed"{return Err("Cannot retire unclaimed or foreign command.".into());}
  q.items.remove(0);Ok(((),true))
 })
}
#[tauri::command]
pub(crate) fn enqueue_native_command(text:String,thread_id:String,prompt_index:u32,app:AppHandle)
 ->Result<QueuedCommand,String>{
 add_at(&path(&app)?,&thread_id,prompt_index,&text,crate::now_ms())
}
#[tauri::command]
pub(crate) fn peek_native_command(app:AppHandle)->Result<Option<QueuedCommand>,String>{
 first_at(&path(&app)?)
}
#[tauri::command]
pub(crate) fn claim_native_command(id:String,app:AppHandle)->Result<QueuedCommand,String>{
 claim_at(&path(&app)?,&id)
}
#[tauri::command]
pub(crate) fn finish_native_command(id:String,app:AppHandle)->Result<(),String>{
 finish_at(&path(&app)?,&id)
}
#[cfg(test)]
mod tests{
 use super::*;
 fn file()->PathBuf{std::env::temp_dir().join(format!("shuvi-command-{}.json",Uuid::new_v4()))}
 fn cleanup(p:&Path){let _=fs::remove_file(p);let _=fs::remove_file(p.with_extension("json.bak"));let _=fs::remove_file(p.with_extension("queue.lock"));}
 #[test]
 fn pending_command_survives_restart_and_claim_cannot_replay(){
  let p=file();let a=add_at(&p,"chat_1",0,"Premiere editing",100).unwrap();
  assert_eq!(first_at(&p).unwrap().unwrap().id,a.id);
  assert_eq!(claim_at(&p,&a.id).unwrap().phase,"claimed");
  assert!(claim_at(&p,&a.id).is_err());
  assert_eq!(first_at(&p).unwrap().unwrap().phase,"claimed");
  finish_at(&p,&a.id).unwrap();
  assert!(first_at(&p).unwrap().is_none());cleanup(&p);
 }
 #[test]
 fn queue_keeps_fifo_and_blocks_bad_or_foreign_completions(){
  let p=file();let a=add_at(&p,"chat_1",1,"First command",1).unwrap();
  let b=add_at(&p,"chat_1",2,"Second command",2).unwrap();
  assert_eq!(first_at(&p).unwrap().unwrap().id,a.id);
  assert!(finish_at(&p,&a.id).is_err());
  assert!(claim_at(&p,&b.id).is_err());
  claim_at(&p,&a.id).unwrap();
  assert!(finish_at(&p,&b.id).is_err());
  finish_at(&p,&a.id).unwrap();
  assert_eq!(first_at(&p).unwrap().unwrap().id,b.id);cleanup(&p);
 }
 #[test]
 fn corrupt_primary_never_resurrects_older_queued_backup(){
  let p=file();let item=add_at(&p,"restart_1",0,"Premiere edit",100).unwrap();
  claim_at(&p,&item.id).unwrap();
  // A corrupt latest claim MUST NOT restore backup's earlier "queued" state.
  fs::write(&p,b"corrupt").unwrap();
  assert!(first_at(&p).is_err());
  cleanup(&p);
 }
 #[test]
 fn rejection_preserves_queue_and_never_stages_native_action(){
  let p=file();assert!(add_at(&p,"bad thread",0,"edit",1).is_err());
  assert!(add_at(&p,"valid",0,"\u{0007}",1).is_err());
  assert!(first_at(&p).unwrap().is_none());cleanup(&p);
 }
}
