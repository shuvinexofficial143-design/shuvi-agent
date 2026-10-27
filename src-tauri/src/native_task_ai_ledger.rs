//! Per-task paid AI request receipts. Durable requests, not a billing estimate.
//! A failed/unknown response permanently consumes a request identity.
use serde::{Serialize,Deserialize};
use std::{fs::{self,File,OpenOptions},io::{Read,Write,Seek,SeekFrom},path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
use uuid::Uuid;
static LOCK:Mutex<()>=Mutex::new(());
const MAX_BYTES:usize=131072;
const MAX_ROWS:usize=256;
const MAX_LINE:usize=640;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Receipt {
 pub version:u8,pub task_id:String,pub request_id:String,pub index:u32,
 pub provider:String,pub model:String,pub status:String,
 pub input_tokens:Option<u64>,pub output_tokens:Option<u64>,pub total_tokens:Option<u64>,
 // USD is deliberately unknown: provider usage is not a verified bill.
 pub usd_billed:Option<String>,
}
fn uuid(s:&str)->bool{Uuid::parse_str(s).map(|u|u.to_string()==s).unwrap_or(false)}
fn valid(r:&Receipt)->bool{
 r.version==1&&uuid(&r.task_id)&&uuid(&r.request_id)&&
 (1..=49).contains(&r.index)&&!r.provider.is_empty()&&r.provider.len()<=40&&
 r.provider.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')&&
 !r.model.is_empty()&&r.model.len()<=128&&!r.model.chars().any(char::is_control)&&
 r.usd_billed.is_none()&&match r.status.as_str(){
 "reserved"|"unknown"=>r.input_tokens.is_none()&&r.output_tokens.is_none()&&r.total_tokens.is_none(),
 "reported"=>(r.input_tokens.is_none()&&r.output_tokens.is_none()&&r.total_tokens.is_none())||
   (r.input_tokens.is_some()&&r.output_tokens.is_some()&&r.total_tokens.is_some()),
 _=>false
 }
}
fn parse(bytes:&[u8])->Result<Vec<Receipt>,String>{
 if bytes.len()>MAX_BYTES{return Err("AI ledger exceeds byte limit.".into());}
 if bytes.is_empty(){return Ok(vec![]);}
 if bytes.last()!=Some(&b'\n'){return Err("AI ledger has incomplete record.".into());}
 let mut rows=Vec::new();
 for line in bytes.split_inclusive(|c|*c==b'\n'){
  if line.len()>MAX_LINE||rows.len()==MAX_ROWS{return Err("AI ledger record size invalid.".into());}
  let r:Receipt=serde_json::from_slice(&line[..line.len()-1])
   .map_err(|_|"AI ledger record JSON invalid.".to_string())?;
  if !valid(&r){return Err("AI ledger receipt invalid.".into());}
  rows.push(r);
 }
 let mut last=std::collections::HashMap::<String,u32>::new();
 let mut unfinished=std::collections::HashMap::<String,bool>::new();
 let mut ids=std::collections::HashMap::<String,&Receipt>::new();
 for row in &rows{
  if row.status=="reserved"{
   let n=last.get(&row.task_id).copied().unwrap_or(0);
   if row.index!=n+1||ids.contains_key(&row.request_id)||
       unfinished.get(&row.task_id)==Some(&true){
    return Err("AI ledger duplicate, skipped or unresolved request.".into());
   }
   last.insert(row.task_id.clone(),row.index);
   unfinished.insert(row.task_id.clone(),true);
   ids.insert(row.request_id.clone(),row);
  }else{
   let original=ids.get(&row.request_id).ok_or("AI receipt has no reservation.")?;
   if original.task_id!=row.task_id||original.index!=row.index||
     original.provider!=row.provider||original.model!=row.model||
     unfinished.get(&row.task_id)!=Some(&true){
    return Err("AI ledger outcome identity conflict.".into());
   }
   unfinished.insert(row.task_id.clone(),false);
  }
 }
 Ok(rows)
}
fn is_redirected(m:&fs::Metadata)->bool{
 #[cfg(windows)]{
  use std::os::windows::fs::MetadataExt;
  m.is_symlink()||m.file_attributes()&0x400!=0
 }
 #[cfg(not(windows))]{m.is_symlink()}
}
fn file(app:&AppHandle)->Result<PathBuf,String>{
 let dir=app.path().app_data_dir().map_err(|_|"Task AI ledger folder unavailable.")?;
 fs::create_dir_all(&dir).map_err(|_|"Task AI ledger folder cannot be created.")?;
 let meta=fs::symlink_metadata(&dir).map_err(|_|"Task AI ledger folder cannot be inspected.")?;
 if !meta.is_dir()||is_redirected(&meta){return Err("Task AI ledger folder redirected.".into());}
 Ok(dir.join("native-task-ai-ledger.jsonl"))
}
fn open(path:&Path)->Result<File,String>{
 match fs::symlink_metadata(path){
  Ok(m) if m.is_file()&&!is_redirected(&m)=>{},
  Ok(_)=>return Err("Task AI ledger file is redirected.".into()),
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
  Err(_)=>return Err("Task AI ledger file inaccessible.".into())
 }
 let mut opts=OpenOptions::new();opts.read(true).append(true).create(true);
 #[cfg(windows)]{
  use std::os::windows::fs::OpenOptionsExt;
  opts.share_mode(0).custom_flags(0x0020_0000);
 }
 let handle=opts.open(path).map_err(|_|"Task AI ledger is locked or unwritable.")?;
 let m=handle.metadata().map_err(|_|"Task AI ledger metadata unavailable.")?;
 if !m.is_file()||is_redirected(&m){return Err("Task AI ledger handle redirected.".into());}
 Ok(handle)
}
fn transaction<R>(path:&Path,op:impl FnOnce(&[Receipt])->Result<(R,Option<Receipt>),String>)->Result<R,String>{
 let _lock=LOCK.lock().map_err(|_|"Task AI ledger lock poisoned.")?;
 let mut handle=open(path)?;
 handle.seek(SeekFrom::Start(0)).map_err(|_|"Task AI ledger rewind failed.")?;
 let mut bytes=Vec::new();
 (&mut handle).take((MAX_BYTES+1) as u64).read_to_end(&mut bytes)
  .map_err(|_|"Task AI ledger read failed.")?;
 let rows=parse(&bytes)?;
 let (result,next)=op(&rows)?;
 if let Some(next)=next{
  let mut line=serde_json::to_vec(&next).map_err(|_|"Task AI receipt encode failed.")?;
  line.push(b'\n');
  // A reservation must leave disk headroom for its eventual terminal receipt.
  // Never bill first and discover that the ledger could not record the outcome.
  let terminal_headroom=if next.status=="reserved"{MAX_LINE}else{0};
  if line.len()>MAX_LINE||rows.len()>=MAX_ROWS||
     bytes.len().saturating_add(line.len()).saturating_add(terminal_headroom)>MAX_BYTES{
   return Err("Task AI ledger full; refuse paid request.".into());
  }
  handle.write_all(&line).map_err(|_|"Task AI receipt append failed.")?;
  handle.sync_all().map_err(|_|"Task AI receipt sync failed.")?;
 }
 Ok(result)
}
pub(crate) fn reserve_at(path:&Path,task:&str,id:&str,index:u32,
 provider:&str,model:&str)->Result<(),String>{
 let next=Receipt{version:1,task_id:task.into(),request_id:id.into(),index,
  provider:provider.into(),model:model.into(),status:"reserved".into(),
  input_tokens:None,output_tokens:None,total_tokens:None,usd_billed:None};
 if !valid(&next){return Err("Invalid native task AI request.".into());}
 transaction(path,|rows|{
  let prior=rows.iter().filter(|r|r.task_id==task&&r.status=="reserved").count();
  if prior+1!=index as usize||rows.iter().any(|r|r.request_id==id)||
     rows.len()+2>MAX_ROWS||
     rows.iter().rev().find(|r|r.task_id==task).is_some_and(|r|r.status=="reserved"){
   return Err("Task AI request is duplicate, over budget or unresolved.".into());
  }
  Ok(((),Some(next)))
 })
}
pub(crate) fn complete_at(path:&Path,id:&str,
 usage:Option<(u64,u64,u64)>,ok:bool)->Result<(),String>{
 transaction(path,|rows|{
  let reserved=rows.iter().find(|r|r.request_id==id&&r.status=="reserved")
   .ok_or("Task AI receipt reservation missing.")?;
  if rows.iter().any(|r|r.request_id==id&&r.status!="reserved"){
   return Err("Task AI request already has an outcome.".into());
  }
  let mut receipt=reserved.clone();
  receipt.status=if ok{"reported"}else{"unknown"}.into();
  if ok{if let Some((i,o,t))=usage{
    receipt.input_tokens=Some(i);receipt.output_tokens=Some(o);receipt.total_tokens=Some(t);
  }}
  if !valid(&receipt){return Err("Invalid provider-reported tokens.".into());}
  Ok(((),Some(receipt)))
 })
}

// BUG-028: the historical single file remains IMMUTABLE for legacy audit and
// replay detection. New owner task UUIDs get a separate <=32-row journal per
// task, and each globally unique request UUID gets a permanent create_new
// marker. No deletion, truncation, or archive reset of paid authority.
// This keeps 256 rows a per-task limit, never an application lifetime limit.
fn private_subdir(root:&Path,name:&str)->Result<PathBuf,String>{
 let dir=root.join(name);
 fs::create_dir_all(&dir).map_err(|_|"Task AI shard folder unavailable.")?;
 let m=fs::symlink_metadata(&dir).map_err(|_|"Task AI shard folder metadata unavailable.")?;
 if !m.is_dir()||is_redirected(&m){return Err("Task AI shard folder redirected.".into());}
 Ok(dir)
}
fn scoped_task_path(root:&Path,task:&str)->Result<PathBuf,String>{
 if !uuid(task){return Err("Invalid scoped AI task ID.".into());}
 Ok(private_subdir(root,"native-task-ai-tasks")?.join(format!("{task}.jsonl")))
}
fn scoped_marker_path(root:&Path,id:&str)->Result<PathBuf,String>{
 if !uuid(id){return Err("Invalid scoped AI request ID.".into());}
 Ok(private_subdir(root,"native-task-ai-requests")?.join(format!("{id}.ref")))
}
fn read_marker(path:&Path)->Result<Option<String>,String>{
 match fs::symlink_metadata(path) {
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
  Err(_)=>return Err("AI marker metadata inaccessible.".into()),
  Ok(m) if !m.is_file()||is_redirected(&m)||m.len()>64 =>
   return Err("AI request marker redirected or malformed.".into()),
  Ok(_)=>{}
 };
 let bytes=fs::read(path).map_err(|_|"AI request marker inaccessible.")?;
 let task=std::str::from_utf8(&bytes).map_err(|_|"AI marker text corrupt.")?;
 let task=task.strip_suffix('\n').ok_or("AI marker incomplete.")?;
 if !uuid(task){return Err("AI marker task identity corrupt.".into());}
 Ok(Some(task.to_string()))
}
fn reserve_scoped_at(root:&Path,task:&str,id:&str,index:u32,
 provider:&str,model:&str)->Result<(),String>{
 if !uuid(task)||!uuid(id)||index==0||index>16{
  return Err("Invalid scoped task AI request identity or index.".into());
 }
 // Old v1 requests stay exactly as written; an old task UUID must not
 // escape its original chain/index by starting a fresh shard.
 let legacy=root.join("native-task-ai-ledger.jsonl");
 transaction(&legacy,|rows|{
  if rows.iter().any(|r|r.request_id==id||r.task_id==task){
   return Err("Existing legacy AI task/request must not be reissued.".into());
  }
  Ok(((),None))
 })?;
 let marker=scoped_marker_path(root,id)?;
 // Marker is written BEFORE the reservation. An interrupted write consumes
 // this request ID permanently, but never authorizes a provider call.
 // O_EXCL/create_new is the cross-process anti-replay admission point.
 let mut opts=OpenOptions::new();opts.create_new(true).write(true);
 #[cfg(windows)]{
  use std::os::windows::fs::OpenOptionsExt;
  opts.share_mode(0).custom_flags(0x0020_0000);
 }
 let mut file=opts.open(&marker)
  .map_err(|_|"AI request ID exists or its replay marker cannot be created.")?;
 file.write_all(format!("{task}\n").as_bytes())
  .map_err(|_|"AI request replay marker write failed.")?;
 file.sync_all().map_err(|_|"AI request replay marker sync failed.")?;
 drop(file);
 // Each owner task is bounded to 16 requests => <=32 journal rows.
 // Per-task transaction retains the original all-or-nothing, duplicate,
 // sequence and unresolved request checks. Never erase markers on failure.
 reserve_at(&scoped_task_path(root,task)?,task,id,index,provider,model)
}
fn complete_scoped_at(root:&Path,id:&str,
 usage:Option<(u64,u64,u64)>,ok:bool)->Result<(),String>{
 let marker=scoped_marker_path(root,id)?;
 match read_marker(&marker)?{
  Some(task)=>complete_at(&scoped_task_path(root,&task)?,id,usage,ok),
  None=>complete_at(&root.join("native-task-ai-ledger.jsonl"),id,usage,ok)
 }
}
fn read_scoped_at(root:&Path)->Result<Vec<Receipt>,String>{
 let legacy=transaction(&root.join("native-task-ai-ledger.jsonl"),
  |rows|Ok((rows.iter().rev().take(40).cloned().collect::<Vec<_>>(),None)))?;
 let mut all=Vec::new();
 let dir=private_subdir(root,"native-task-ai-tasks")?;
 let mut files=Vec::new();
 for entry in fs::read_dir(dir).map_err(|_|"AI task shards unavailable.")? {
  let entry=entry.map_err(|_|"AI task shard entry inaccessible.")?;
  let name=entry.file_name().into_string()
   .map_err(|_|"AI task shard name invalid.")?;
  let id=name.strip_suffix(".jsonl").ok_or("Unexpected AI task shard entry.")?;
  if !uuid(id){return Err("AI task shard name is invalid.".into());}
  let m=fs::symlink_metadata(entry.path()).map_err(|_|"AI task shard metadata inaccessible.")?;
  if !m.is_file()||is_redirected(&m)||m.len()>MAX_BYTES as u64{
   return Err("AI task shard redirected or oversized.".into());
  }
  files.push((m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),entry.path()));
 }
 // Recent modified shards first; old rows remain on disk, never destroyed.
 files.sort_by(|a,b|b.0.cmp(&a.0));
 for (_,path) in files.into_iter().take(40) {
  let bytes=fs::read(&path).map_err(|_|"AI task shard read failed.")?;
  all.extend(parse(&bytes)?.into_iter().rev().take(40));
 }
 all.extend(legacy); // Legacy entries are historical; recent task shards take precedence.
 all.truncate(40);
 Ok(all)
}

pub(crate) fn reserve(app:&AppHandle,task:&str,id:&str,index:u32,
 provider:&str,model:&str)->Result<(),String>{
 let original=file(app)?;
 let root=original.parent().ok_or("AI ledger folder unavailable.")?;
 reserve_scoped_at(root,task,id,index,provider,model)
}
pub(crate) fn complete(app:&AppHandle,id:&str,
 usage:Option<(u64,u64,u64)>,ok:bool)->Result<(),String>{
 let original=file(app)?;
 let root=original.parent().ok_or("AI ledger folder unavailable.")?;
 complete_scoped_at(root,id,usage,ok)
}
pub(crate) fn read(app:&AppHandle)->Result<Vec<Receipt>,String>{
 let original=file(app)?;
 let root=original.parent().ok_or("AI ledger folder unavailable.")?;
 read_scoped_at(root)
}
#[cfg(test)]
mod tests {
 use super::*;
 fn tmp()->PathBuf{std::env::temp_dir().join(format!("shuvi-cost-{}.jsonl",Uuid::new_v4()))}
 #[test]
 fn reservations_and_provider_uncertainty_are_not_replayed(){
  let p=tmp();let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
  reserve_at(&p,&t,&a,1,"openrouter","a").unwrap();
  assert!(reserve_at(&p,&t,&a,1,"openrouter","a").is_err());
  let b=Uuid::new_v4().to_string();
  assert!(reserve_at(&p,&t,&b,2,"openrouter","a").is_err());
  complete_at(&p,&a,None,false).unwrap();
  reserve_at(&p,&t,&b,2,"openrouter","a").unwrap();
  complete_at(&p,&b,Some((5,3,8)),true).unwrap();
  assert!(complete_at(&p,&b,None,false).is_err());
  let receipts=transaction(&p,|r|Ok((r.to_vec(),None))).unwrap();
  assert_eq!(receipts.len(),4);
  assert!(receipts.iter().all(|x|x.usd_billed.is_none()));
  fs::remove_file(p).unwrap();
 }

 #[test]
 fn legacy_256_rows_do_not_block_new_owner_tasks_and_are_never_truncated(){
  let dir=std::env::temp_dir().join(format!("shuvi-shard-ledger-{}",Uuid::new_v4()));
  fs::create_dir_all(&dir).unwrap();
  let path=dir.join("native-task-ai-ledger.jsonl");
  let mut bytes=Vec::new();
  let mut old_task=String::new();
  for n in 0..128 {
   let task=Uuid::new_v4().to_string();let request=Uuid::new_v4().to_string();
   if n==0{old_task=task.clone();}
   let a=Receipt{version:1,task_id:task,request_id:request,index:1,
     provider:"openrouter".into(),model:"vision".into(),status:"reserved".into(),
     input_tokens:None,output_tokens:None,total_tokens:None,usd_billed:None};
   let mut b=a.clone();b.status="unknown".into();
   for row in [a,b]{
    bytes.extend(serde_json::to_vec(&row).unwrap());bytes.push(b'\n');
   }
  }
  fs::write(&path,&bytes).unwrap();assert_eq!(parse(&bytes).unwrap().len(),256);
  let fresh_task=Uuid::new_v4().to_string();
  let first=Uuid::new_v4().to_string();
  assert!(reserve_scoped_at(&dir,&old_task,&Uuid::new_v4().to_string(),2,
    "openrouter","vision").is_err(),"old task cannot jump journals");
  reserve_scoped_at(&dir,&fresh_task,&first,1,"openrouter","vision").unwrap();
  assert!(reserve_scoped_at(&dir,&fresh_task,&first,1,"openrouter","vision").is_err());
  assert!(reserve_scoped_at(&dir,&fresh_task,&Uuid::new_v4().to_string(),2,
   "openrouter","vision").is_err(),"unresolved first request blocks next");
  complete_scoped_at(&dir,&first,None,false).unwrap();
  let second=Uuid::new_v4().to_string();
  reserve_scoped_at(&dir,&fresh_task,&second,2,"openrouter","vision").unwrap();
  complete_scoped_at(&dir,&second,Some((20,10,30)),true).unwrap();
  assert!(complete_scoped_at(&dir,&second,None,false).is_err());
  assert_eq!(fs::read(&path).unwrap(),bytes,"legacy audit bytes must remain intact");
  let recent=read_scoped_at(&dir).unwrap();
  assert!(recent.iter().any(|row|row.request_id==second));
  // A totally new task still works after app restart; no shared row cap.
  let later=Uuid::new_v4().to_string();let id=Uuid::new_v4().to_string();
  reserve_scoped_at(&dir,&later,&id,1,"gemini","vision").unwrap();
  complete_scoped_at(&dir,&id,None,false).unwrap();
  fs::remove_dir_all(&dir).unwrap();
 }
 #[test]
 fn corrupted_request_marker_or_redirected_shard_fails_without_paid_dispatch(){
  let dir=std::env::temp_dir().join(format!("shuvi-shard-corrupt-{}",Uuid::new_v4()));
  fs::create_dir_all(&dir).unwrap();
  let task=Uuid::new_v4().to_string();let id=Uuid::new_v4().to_string();
  reserve_scoped_at(&dir,&task,&id,1,"gemini","vision").unwrap();
  let marker=scoped_marker_path(&dir,&id).unwrap();
  fs::write(&marker,b"not-an-owner-task\n").unwrap();
  assert!(complete_scoped_at(&dir,&id,None,true).is_err());
  assert!(reserve_scoped_at(&dir,&task,&id,1,"gemini","vision").is_err());
  fs::remove_dir_all(&dir).unwrap();
 }
 #[test]
 fn torn_ledger_fails_before_request(){
  let p=tmp();fs::write(&p,b"{bad").unwrap();
  let t=Uuid::new_v4().to_string();let a=Uuid::new_v4().to_string();
  assert!(reserve_at(&p,&t,&a,1,"gemini","test").is_err());
  fs::remove_file(p).unwrap();
 }
}
