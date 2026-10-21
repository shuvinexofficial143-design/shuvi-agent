//! Owner-selected per-task HARD PAID REQUEST COUNT, not a USD price cap.
//! In-memory task authority is never resurrected from a recovery checkpoint.
//! Durable ledger independently prevents duplicate paid request IDs.
use std::collections::HashMap;
use uuid::Uuid;
const ALLOWED:&[u8]=&[2,4,8,16];
const MAX_REQUEST_CONTEXT_BYTES:usize=256*1024;
const MAX_TASK_CONTEXT_BYTES:usize=512*1024;
#[derive(Clone)]
struct Quota{max:u8,expires_at:u64,committed_context_bytes:usize,next_request_index:u32}
#[derive(Default)]
pub(crate) struct Store{active:HashMap<String,Quota>}
fn valid_uuid(s:&str)->bool{Uuid::parse_str(s).map(|u|u.to_string()==s).unwrap_or(false)}
impl Store {
 pub(crate) fn issue(&mut self,task:&str,max:u8,expiry:u64,now:u64)->Result<(),String>{
  if !valid_uuid(task)||!ALLOWED.contains(&max)||now==0||
     expiry<=now||expiry>now.saturating_add(7_200_000){
   return Err("Task AI quota must be one finite owner-selected option.".into());
  }
  self.active.retain(|_,q|now<q.expires_at);
  if self.active.contains_key(task){
   return Err("Task AI request quota cannot be enlarged or reissued.".into());
  }
  if self.active.len()>=4{return Err("Active task AI quota capacity exhausted.".into());}
  self.active.insert(task.to_owned(),Quota{max,expires_at:expiry,committed_context_bytes:0,next_request_index:1});
  Ok(())
 }
 pub(crate) fn check(&self,task:&str,index:u32,now:u64)->Result<(),String>{
  let q=self.active.get(task)
    .ok_or("Task AI quota missing after restart or revocation; no paid request.")?;
  if now==0||now>=q.expires_at||index==0||index>q.max as u32{
   return Err("Owner's native task AI request quota exhausted or expired.".into());
  }
  Ok(())
 }
 /// Count bytes, not tokens or dollars. Fail closed BEFORE a paid provider
 /// attempt: consume context budget and a unique request index even if the
 /// upstream outcome is unknown or the durable ledger refuses admission.
 pub(crate) fn reserve_context(&mut self,task:&str,index:u32,
     bytes:usize,now:u64)->Result<(),String>{
  self.check(task,index,now)?;
  let grant=self.active.get_mut(task)
   .ok_or("Owner AI cost guard missing after restart.")?;
  if bytes==0||bytes>MAX_REQUEST_CONTEXT_BYTES||index!=grant.next_request_index{
   return Err("Task paid AI request context too large or request index replayed.".into());
  }
  let cumulative=grant.committed_context_bytes.checked_add(bytes)
   .ok_or("Owner cumulative prompt budget overflow.")?;
  if cumulative>MAX_TASK_CONTEXT_BYTES{
   return Err("Owner task cumulative paid prompt data budget exhausted.".into());
  }
  grant.committed_context_bytes=cumulative;
  grant.next_request_index=index+1;
  Ok(())
 }
 pub(crate) fn revoke(&mut self,task:&str){self.active.remove(task);}
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn owner_limit_cannot_be_extended_or_restored_by_a_different_task(){
  let t=Uuid::new_v4().to_string();let mut q=Store::default();
  q.issue(&t,4,5000,1000).unwrap();
  for i in 1..=4{assert!(q.check(&t,i,1001).is_ok());}
  assert!(q.check(&t,5,1001).is_err());
  assert!(q.issue(&t,16,5000,1001).is_err());
  assert!(q.check(&Uuid::new_v4().to_string(),1,1001).is_err());
  assert!(q.check(&t,1,5000).is_err());
  q.revoke(&t);assert!(q.check(&t,1,1001).is_err());
 }
 #[test]
 fn paid_context_bytes_are_bounded_once_per_task_even_on_failed_attempts(){
  let t=Uuid::new_v4().to_string();let mut q=Store::default();
  q.issue(&t,8,6000,1000).unwrap();
  assert!(q.reserve_context(&t,1,MAX_REQUEST_CONTEXT_BYTES+1,1001).is_err());
  q.reserve_context(&t,1,MAX_REQUEST_CONTEXT_BYTES,1001).unwrap();
  assert!(q.reserve_context(&t,1,1,1002).is_err());
  q.reserve_context(&t,2,MAX_REQUEST_CONTEXT_BYTES,1002).unwrap();
  assert!(q.reserve_context(&t,3,1,1003).is_err(),
   "owner budget must stop further paid data even though request count remains");
  q.revoke(&t);
  assert!(q.reserve_context(&t,3,1,1004).is_err());
 }
 #[test]
 fn bad_choices_clock_or_ttl_fail_closed(){
  let t=Uuid::new_v4().to_string();let mut q=Store::default();
  for max in [0,1,3,9,17,255]{
   assert!(q.issue(&t,max,5000,1000).is_err());
  }
  assert!(q.issue(&t,2,1000,1000).is_err());
  assert!(q.issue(&t,2,7_201_001,1000).is_err());
  q.issue(&t,2,5000,1000).unwrap();
 }
}
