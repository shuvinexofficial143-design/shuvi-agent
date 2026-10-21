//! Owner-selected per-task HARD PAID REQUEST COUNT, not a USD price cap.
//! In-memory task authority is never resurrected from a recovery checkpoint.
//! Durable ledger independently prevents duplicate paid request IDs.
use std::collections::HashMap;
use uuid::Uuid;
const ALLOWED:&[u8]=&[2,4,8,16];
#[derive(Clone)]
struct Quota{max:u8,expires_at:u64}
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
  self.active.insert(task.to_owned(),Quota{max,expires_at:expiry});
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
