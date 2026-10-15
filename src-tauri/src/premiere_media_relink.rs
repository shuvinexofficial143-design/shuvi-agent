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
    #[test] fn empty_and_relative_sources_are_rejected(){
        assert!(fingerprint("../missing.mp4").is_err());
        let dir=std::env::temp_dir().join(format!("shuvi40-relink-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();let file=dir.join("empty.mov");
        fs::write(&file,b"").unwrap();
        assert!(fingerprint(file.to_str().unwrap()).is_err());
        fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
