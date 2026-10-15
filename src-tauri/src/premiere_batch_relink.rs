//! Exact-source, bounded multi-item Premiere relink batch.
 //! Each Adobe mutation requires a fresh native readback; partial results are
 //! never implicitly retried or rolled back. The caller owns one checkpoint,
 //! one serialized desktop lane, and one post-batch project Save.
use crate::premiere_media_relink::{self,MediaFingerprint};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashSet,fs,path::Path};

const MAX_ITEMS:usize=24;
const MAX_BATCH_BYTES:u64=4*1024*1024*1024;

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub item_id:String,
    pub expected_previous_path:String,
    pub new_path:String,
    #[serde(default)]
    pub override_compatibility:bool,
}
fn normalized(path:&str)->String{path.replace('/',"\\").to_ascii_lowercase()}
impl Entry {
    pub fn validate(&self)->Result<(),String>{
        if self.item_id.is_empty()||self.item_id.len()>240||self.item_id!=self.item_id.trim()
            ||self.item_id.chars().any(|c|c.is_control()){
            return Err("Batch relink needs a bounded exact native item ID.".into());
        }
        for (path,label) in [(&self.expected_previous_path,"old"),(&self.new_path,"new")] {
            if path.is_empty()||path.len()>4096||path!=path.trim()||path.chars().any(|c|c.is_control())
                ||!Path::new(path).is_absolute(){
                return Err(format!("Batch relink {label} path must be a bounded absolute native path."));
            }
        }
        if normalized(&self.expected_previous_path)==normalized(&self.new_path){
            return Err("Batch relink cannot target its previously observed source.".into());
        }
        Ok(())
    }
    pub fn uxp_args(&self)->Value{
        json!({"itemId":self.item_id,"newPath":self.new_path,
            "expectedPreviousPath":self.expected_previous_path,
            "overrideCompatibility":self.override_compatibility})
    }
    pub fn host_verified(&self,response:&Value)->bool{
        let observed=response.get("observedPath").and_then(Value::as_str);
        response.get("verificationStatus").and_then(Value::as_str)==Some("verified_readback")
            &&response.get("observedId").and_then(Value::as_str)==Some(self.item_id.as_str())
            &&response.get("observedOffline").and_then(Value::as_bool)==Some(false)
            &&response.get("expectedPreviousPath").and_then(Value::as_str)
                .is_some_and(|p|normalized(p)==normalized(&self.expected_previous_path))
            &&observed.is_some_and(|p|normalized(p)==normalized(&self.new_path))
    }
    pub fn post_save_verified(&self,record:&Value)->bool{
        record.get("itemId").and_then(Value::as_str)==Some(self.item_id.as_str())
            &&record.get("offline").and_then(Value::as_bool)==Some(false)
            &&record.get("mediaPath").and_then(Value::as_str)
                .is_some_and(|p|normalized(p)==normalized(&self.new_path))
    }
}
pub fn validate_entries(entries:&[Entry])->Result<(),String>{
    if entries.is_empty()||entries.len()>MAX_ITEMS{
        return Err("Premiere relink batches require 1..24 exact items.".into());
    }
    let mut ids=HashSet::new();
    let mut bytes=0u64;
    for entry in entries{
        entry.validate()?;
        if !ids.insert(entry.item_id.to_ascii_lowercase()){
            return Err("Duplicate native Premiere item IDs in one relink batch.".into());
        }
        let p=Path::new(&entry.new_path);
        let meta=fs::symlink_metadata(p).map_err(|e|format!("Replacement media not accessible: {e}"))?;
        if !meta.is_file()||meta.file_type().is_symlink()||meta.len()==0 {
            return Err("Replacement media must be a nonempty regular non-symlink file.".into());
        }
        #[cfg(windows)]{
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("Replacement media path is a reparse point.".into());
            }
        }
        bytes=bytes.checked_add(meta.len()).ok_or("Replacement batch byte count overflow.")?;
        if bytes>MAX_BATCH_BYTES{return Err("Premiere replacement batch exceeds 4 GiB source bound.".into());}
    }
    Ok(())
}
pub fn fingerprint_sources(entries:&[Entry])->Result<Vec<MediaFingerprint>,String>{
    validate_entries(entries)?;
    entries.iter().map(|item|premiere_media_relink::fingerprint(&item.new_path)).collect()
}
pub fn same_source(entry:&Entry,before:&MediaFingerprint)->bool{
    premiere_media_relink::fingerprint(&entry.new_path).ok()
        .is_some_and(|now|premiere_media_relink::same_file(before,&now))
}
#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(std::path::PathBuf,Entry){
        let dir=std::env::temp_dir().join(format!("shuvi40-batch-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();let file=dir.join("media.mp4");
        fs::write(&file,b"bounded video fixture").unwrap();
        let entry=Entry{item_id:"id-1".into(),
            expected_previous_path:dir.join("old.mp4").to_string_lossy().into_owned(),
            new_path:file.to_string_lossy().into_owned(),override_compatibility:false};
        (dir,entry)
    }
    #[test] fn duplicate_items_and_stale_source_identity_fail_closed(){
        let (dir,entry)=fixture();
        assert!(validate_entries(&[entry.clone(),entry.clone()]).is_err());
        let proof=fingerprint_sources(&[entry.clone()]).unwrap();
        assert!(same_source(&entry,&proof[0]));
        fs::write(&entry.new_path,b"changed").unwrap();
        assert!(!same_source(&entry,&proof[0]));
        fs::remove_file(&entry.new_path).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test] fn exact_native_readback_is_not_equivalent_to_unproven_offline_or_wrong_path(){
        let (dir,entry)=fixture();
        let mut result=json!({"verificationStatus":"verified_readback",
            "observedId":"id-1","observedOffline":false,
            "expectedPreviousPath":entry.expected_previous_path,"observedPath":entry.new_path});
        assert!(entry.host_verified(&result));
        assert!(!entry.post_save_verified(&json!({"itemId":"id-1","mediaPath":entry.new_path,"offline":true})));
        result["observedOffline"]=json!(true);assert!(!entry.host_verified(&result));
        fs::remove_file(&entry.new_path).unwrap();fs::remove_dir(dir).unwrap();
    }
}
