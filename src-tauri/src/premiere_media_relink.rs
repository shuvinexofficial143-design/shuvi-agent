//! Independent, bounded file identity for a permissioned Premiere media relink.
 //! This hashes local files but never writes their bytes or assumes Adobe played them.
use sha2::{Digest,Sha256};
use serde::{Deserialize,Serialize};
use std::{fs::{self,File},io::Read,path::Path,time::UNIX_EPOCH};

const MAX_MEDIA_BYTES:u64=4*1024*1024*1024;
const BLOCK:usize=64*1024;

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct MediaFingerprint{
    pub path:String,
    pub size_bytes:u64,
    pub modified_ms:Option<u64>,
    pub sha256:String,
}
pub fn fingerprint(path:&str)->Result<MediaFingerprint,String>{
    if path.trim()!=path||path.len()>4096||path.chars().any(|c|c.is_control()){
        return Err("Relink media path is malformed or oversized.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute(){return Err("Relink source must be an absolute file path.".into());}
    let before=fs::symlink_metadata(p).map_err(|e|format!("Relink source unavailable: {e}"))?;
    if !before.is_file()||before.file_type().is_symlink()||before.len()==0||before.len()>MAX_MEDIA_BYTES{
        return Err("Relink source must be a nonempty regular non-symlink file of at most 4 GiB.".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if before.file_attributes() & 0x400 != 0 {
            return Err("Relink source is a Windows reparse point.".into());
        }
    }
    let mut file=File::open(p).map_err(|e|format!("Relink source cannot be opened: {e}"))?;
    let opened=file.metadata().map_err(|e|e.to_string())?;
    if !opened.is_file()||opened.len()!=before.len(){return Err("Relink source changed before hashing.".into());}
    let mut hash=Sha256::new();
    let mut total=0u64;
    let mut buffer=[0u8;BLOCK];
    loop{
        let n=file.read(&mut buffer).map_err(|e|format!("Relink media hash read failed: {e}"))?;
        if n==0{break;}
        total=total.checked_add(n as u64).ok_or("Relink source byte count overflow.")?;
        if total>MAX_MEDIA_BYTES{return Err("Relink source exceeds 4 GiB proof bound.".into());}
        hash.update(&buffer[..n]);
    }
    let after=fs::symlink_metadata(p).map_err(|e|e.to_string())?;
    let after_open=file.metadata().map_err(|e|e.to_string())?;
    if !after.is_file()||after.file_type().is_symlink()||after.len()!=before.len()
        ||after_open.len()!=before.len()||total!=before.len()
        ||before.modified().ok()!=after.modified().ok()
        ||before.modified().ok()!=after_open.modified().ok(){
        return Err("Relink source changed during hashing; outcome requires inspection.".into());
    }
    let modified_ms=after.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok())
        .map(|t|t.as_millis().min(u64::MAX as u128) as u64);
    Ok(MediaFingerprint{path:path.to_string(),size_bytes:total,
        modified_ms,sha256:format!("{:x}",hash.finalize())})
}
pub fn same_file(a:&MediaFingerprint,b:&MediaFingerprint)->bool{
    a==b && a.size_bytes>0
}
/// Read-only proof for a *previously opened* Adobe project. This does not
/// trigger a reopen or claim which application session loaded the bytes.
pub fn assess_saved_media(
    expected_project_path:&str,expected_project_guid:&str,expected_project_fnv1a64:&str,
    expected_item_id:&str,expected_media_path:&str,expected_media_sha256:&str,
    context:&serde_json::Value,
    project:&crate::premiere_project_persistence::ProjectFileFingerprint,
    media:&MediaFingerprint,item:&serde_json::Value
)->serde_json::Value{
    use serde_json::{json,Value};
    let normalized=|path:&str|path.replace('/',"\\").to_ascii_lowercase();
    let host_identity=context.get("projectGuid").and_then(Value::as_str)==Some(expected_project_guid)
        &&context.get("projectPath").and_then(Value::as_str)
            .is_some_and(|p|normalized(p)==normalized(expected_project_path));
    let disk_matches=normalized(&project.path)==normalized(expected_project_path)
        &&project.fnv1a64.eq_ignore_ascii_case(expected_project_fnv1a64)
        &&project.size_bytes>0;
    let media_hash_matches=normalized(&media.path)==normalized(expected_media_path)
        &&media.sha256.eq_ignore_ascii_case(expected_media_sha256)
        &&media.size_bytes>0;
    let host_item_matches=item.get("itemId").and_then(Value::as_str)==Some(expected_item_id)
        &&item.get("mediaPath").and_then(Value::as_str)
            .is_some_and(|p|normalized(p)==normalized(expected_media_path))
        &&item.get("offline").and_then(Value::as_bool)==Some(false);
    let verified=host_identity&&disk_matches&&media_hash_matches&&host_item_matches;
    json!({"saved_media_verified":verified,
        "host_project_identity_matches":host_identity,
        "disk_project_fingerprint_matches":disk_matches,
        "media_source_sha256_matches":media_hash_matches,
        "host_media_item_online_matches":host_item_matches,
        "fresh_session_proven":false,
        "project_path":expected_project_path,"item_id":expected_item_id,
        "note":"All four checks are read-only evidence for the currently opened Premiere project. Fresh-session provenance must come from a separately audited open action; decoded frames and export are not verified."})
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn unchanged_media_is_verified_and_mutation_invalidates_hash(){
        let dir=std::env::temp_dir().join(format!("shuvi40-relink-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();let file=dir.join("video.mp4");
        fs::write(&file,b"clip-1").unwrap();
        let a=fingerprint(file.to_str().unwrap()).unwrap();
        assert_eq!(a.sha256.len(),64);
        let b=fingerprint(file.to_str().unwrap()).unwrap();assert!(same_file(&a,&b));
        fs::write(&file,b"clip-2-different").unwrap();
        let c=fingerprint(file.to_str().unwrap()).unwrap();assert!(!same_file(&a,&c));
        fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test] fn restored_project_verification_rejects_identity_hash_or_offline_mismatch(){
        let project=crate::premiere_project_persistence::ProjectFileFingerprint{
            path:"C:\\Project\\edit.prproj".into(),size_bytes:100,modified_ms:Some(5),fnv1a64:"0011223344556677".into()
        };
        let media=MediaFingerprint{path:"C:\\Media\\new.mp4".into(),size_bytes:25,
            modified_ms:Some(7),sha256:"a".repeat(64)};
        let context=serde_json::json!({"projectGuid":"P","projectPath":"C:\\Project\\edit.prproj"});
        let item=serde_json::json!({"itemId":"item-1","mediaPath":"C:\\Media\\new.mp4","offline":false});
        let assess=|j:&serde_json::Value,hash:&str|{
            assess_saved_media("C:\\Project\\edit.prproj","P","0011223344556677",
                "item-1","C:\\Media\\new.mp4",hash,&context,&project,&media,j)
        };
        assert_eq!(assess(&item,&"a".repeat(64))["saved_media_verified"],true);
        assert_eq!(assess(&item,&"b".repeat(64))["saved_media_verified"],false);
        let offline=serde_json::json!({"itemId":"item-1","mediaPath":"C:\\Media\\new.mp4","offline":true});
        assert_eq!(assess(&offline,&"a".repeat(64))["saved_media_verified"],false);
    }
    #[test] fn empty_and_relative_sources_are_rejected(){
        assert!(fingerprint("../missing.mp4").is_err());
        let dir=std::env::temp_dir().join(format!("shuvi40-relink-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();let file=dir.join("empty.mov");
        fs::write(&file,b"").unwrap();
        assert!(fingerprint(file.to_str().unwrap()).is_err());
        fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
