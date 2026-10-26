//! Shuvi 37 — in-memory, exact-argument, owner-triggered read grants.
//! A grant is NOT a native approval for mutations, does not survive restart,
//! never schedules or replays a native action, and is consumed under the same
//! Rust pending-action lock as the existing single-worker lease.
// M1.1 is compiled and Rust-tested through this already wired native module.
// It is not yet an execution grant; no legacy Allow once is bypassed.
#[path = "native_task_authorization.rs"]
pub(crate) mod task_authorization;
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::collections::HashMap;
use uuid::Uuid;

const TTL_MS:u64=5*60*1000;
const MAX_USES:u8=8;
const MAX_GRANTS:usize=24;
const MAX_SIGNATURE_INPUT:usize=4096;
const READ_TOOLS:&[&str]=&[
    "read_file","list_directory","ui_find","list_processes",
    "browser_dom_read","workspace_scan","search_text","git_status",
    "git_diff","premiere_bridge_status","premiere_context","premiere_list_items"
];
#[derive(Debug,Clone)]
struct Grant {
    task_id:String,
    signature:String,
    expires_at_ms:u64,
    remaining:u8,
}
#[derive(Default)]
pub(crate) struct TaskReadGrantStore {
    entries:HashMap<String,Grant>,
}
fn valid_task_id(s:&str)->bool {
    Uuid::parse_str(s).map(|v|v.to_string()==s).unwrap_or(false)
}
pub(crate) fn read_signature(tool:&str,arguments:&Value)->Option<String>{
    if !READ_TOOLS.contains(&tool) || !arguments.is_object(){return None;}
    let raw=serde_json::to_vec(arguments).ok()?;
    if raw.len()>MAX_SIGNATURE_INPUT{return None;}
    let mut hasher=Sha256::new();
    hasher.update(tool.as_bytes());
    hasher.update([0u8]);
    hasher.update(&raw);
    Some(format!("{tool}:{:x}",hasher.finalize()))
}
impl TaskReadGrantStore {
    fn prune(&mut self,now:u64) {
        self.entries.retain(|_,grant|now<grant.expires_at_ms && grant.remaining>0);
    }
    /// This must be called by the *owner click* only, from a real prepared,
    /// low-risk action. Caller checks the native stage risk and signature.
    pub(crate) fn issue(&mut self,task_id:&str,signature:&str,now:u64)->Result<String,String>{
        if !valid_task_id(task_id) || now==0 || now>u64::MAX-TTL_MS
            ||signature.len()>180 ||!READ_TOOLS.iter().any(|tool|signature.starts_with(&format!("{tool}:")))
        {return Err("Task read grant identity or exact typed request is invalid.".into());}
        self.prune(now);
        // Prevent even valid task owners from accumulating excessive grants.
        if self.entries.len()>=MAX_GRANTS {
            return Err("Task read grant limit reached; revoke old grants first.".into());
        }
        let id=Uuid::new_v4().to_string();
        self.entries.insert(id.clone(),Grant{
            task_id:task_id.into(),signature:signature.into(),
            expires_at_ms:now+TTL_MS,remaining:MAX_USES,
        });
        Ok(id)
    }
    /// Claims an exact matching authorization. Different arguments, another
    /// task or a revoked/expired/used-up grant always fail CLOSED.
    pub(crate) fn consume(&mut self,task_id:&str,grant_id:&str,
        signature:&str,now:u64)->Result<(),String>{
        if !valid_task_id(task_id)||!valid_task_id(grant_id)||now==0{
            return Err("Invalid task read grant or action identity.".into());
        }
        self.prune(now);
        let grant=self.entries.get_mut(grant_id)
            .ok_or("No active Rust read grant for this prepared action.")?;
        if grant.task_id!=task_id || grant.signature!=signature {
            return Err("Rust read grant does not match task, tool and exact arguments.".into());
        }
        if now>=grant.expires_at_ms||grant.remaining==0{
            return Err("Rust read grant expired or exhausted.".into());
        }
        grant.remaining-=1;
        if grant.remaining==0 {self.entries.remove(grant_id);}
        Ok(())
    }
    pub(crate) fn revoke(&mut self,task_id:&str){
        self.entries.retain(|_,grant|grant.task_id!=task_id);
    }
    #[cfg(test)]
    fn remaining(&self,id:&str)->Option<u8>{self.entries.get(id).map(|g|g.remaining)}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task()->String{Uuid::new_v4().to_string()}
    #[test]
    fn exact_typed_read_arguments_must_match() {
        let a=read_signature("read_file",&serde_json::json!({"path":"C:/a.txt"})).unwrap();
        let reordered=read_signature("read_file",&serde_json::json!({"path":"C:/a.txt"})).unwrap();
        let other=read_signature("read_file",&serde_json::json!({"path":"C:/b.txt"})).unwrap();
        assert_eq!(a,reordered);assert_ne!(a,other);
        assert!(read_signature("write_file",&serde_json::json!({"path":"C:/a.txt"})).is_none());
        assert!(read_signature("powershell",&serde_json::json!({})).is_none());
        assert!(read_signature("ui_click",&serde_json::json!({})).is_none());
        assert!(read_signature("read_file",&serde_json::json!([1,2])).is_none());
    }
    #[test]
    fn owner_task_exact_match_no_reuse_after_exhaustion() {
        let t=task();let other=task();
        let mut store=TaskReadGrantStore::default();
        let sig=read_signature("read_file",&serde_json::json!({"path":"C:/a"})).unwrap();
        let grant=store.issue(&t,&sig,100).unwrap();
        assert!(store.consume(&other,&grant,&sig,101).is_err());
        assert!(store.consume(&t,&grant,"read_file:not-the-same",101).is_err());
        assert_eq!(store.remaining(&grant),Some(8));
        for n in 0..8 {store.consume(&t,&grant,&sig,101+n).unwrap();}
        assert!(store.consume(&t,&grant,&sig,110).is_err());
    }
    #[test]
    fn revoke_and_expiry_cannot_restore_authority() {
        let t=task();let sig=read_signature("ui_find",&serde_json::json!({"name":"Save"})).unwrap();
        let mut store=TaskReadGrantStore::default();
        let id=store.issue(&t,&sig,100).unwrap();
        store.revoke(&t);assert!(store.consume(&t,&id,&sig,101).is_err());
        let id=store.issue(&t,&sig,100).unwrap();
        assert!(store.consume(&t,&id,&sig,100+TTL_MS).is_err());
    }
    #[test]
    fn no_invalid_or_unbounded_grants() {
        let t=task();let mut store=TaskReadGrantStore::default();
        assert!(store.issue("not-uuid","read_file:hash",123).is_err());
        assert!(store.issue(&t,"write_file:hash",123).is_err());
        let sig=read_signature("list_processes",&serde_json::json!({})).unwrap();
        for _ in 0..MAX_GRANTS {assert!(store.issue(&t,&sig,200).is_ok());}
        assert!(store.issue(&t,&sig,200).is_err());
    }
}
