use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs::{self,File},io::Read,path::Path,time::UNIX_EPOCH};

const MAX_PROJECT_BYTES:u64=512*1024*1024;
const BUFFER_BYTES:usize=128*1024;

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Fingerprint {
    pub path:String,
    pub size_bytes:u64,
    pub modified_ms:Option<u64>,
    pub fnv1a64:String,
}

pub fn fingerprint(path:&str)->Result<Fingerprint,String>{
    crate::after_effects::validate_project_path(path)?;
    let p=Path::new(path);
    let link=fs::symlink_metadata(p).map_err(|e|format!("After Effects project metadata unavailable: {e}"))?;
    if !link.is_file()||link.file_type().is_symlink()||link.len()==0||link.len()>MAX_PROJECT_BYTES{
        return Err("After Effects persistence evidence requires a non-empty regular non-symlink project within 512 MiB.".into());
    }
    let modified_ms=link.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok())
        .map(|d|d.as_millis().min(u64::MAX as u128) as u64);
    let mut file=File::open(p).map_err(|e|format!("After Effects project cannot be opened for fingerprint: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut total=0u64;
    let mut buf=vec![0u8;BUFFER_BYTES];
    loop{
        let n=file.read(&mut buf).map_err(|e|format!("After Effects project fingerprint read failed: {e}"))?;
        if n==0{break;}
        total=total.saturating_add(n as u64);
        if total>MAX_PROJECT_BYTES{return Err("After Effects project exceeded persistence evidence bound while reading.".into());}
        for b in &buf[..n]{hash^=*b as u64;hash=hash.wrapping_mul(0x100000001b3);}
    }
    if total!=link.len(){return Err("After Effects project changed size while persistence evidence was collected.".into());}
    Ok(Fingerprint{path:path.into(),size_bytes:total,modified_ms,fnv1a64:format!("{hash:016x}")})
}

pub fn assess(before:&Fingerprint,after:&Fingerprint,native_accepted:bool,reported_path:&str)->Value{
    let same_path=before.path==after.path&&after.path==reported_path;
    let size_changed=before.size_bytes!=after.size_bytes;
    let content_changed=before.fnv1a64!=after.fnv1a64;
    let modified_advanced=match(before.modified_ms,after.modified_ms){(Some(a),Some(b))=>b>a,_=>false};
    let write_observed=same_path&&after.size_bytes>0&&(size_changed||content_changed||modified_advanced);
    let verified=native_accepted&&write_observed;
    json!({
        "native_accepted":native_accepted,
        "same_exact_project_path":same_path,
        "before":before,
        "after":after,
        "size_changed":size_changed,
        "content_fingerprint_changed":content_changed,
        "modified_time_advanced":modified_advanced,
        "independent_file_write_observed":write_observed,
        "persistence_verified":verified,
        "edit_semantics_verified":false,
        "verification_status":if verified{"verified_file_persistence"}else{"accepted_unverified"},
        "fingerprint_algorithm":"fnv1a64_noncryptographic_change_detector",
        "retry_safe":false,
        "note":"Observed .aep/.aepx file change proves a disk write after save acceptance, not semantic correctness of every prior edit."
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn exact_changed_aep_can_prove_file_write(){
        let dir=std::env::temp_dir().join(format!("shuvi-ae-save-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join("edit.aep");fs::write(&file,b"before").unwrap();
        let before=fingerprint(file.to_str().unwrap()).unwrap();
        fs::write(&file,b"after-more-bytes").unwrap();
        let after=fingerprint(file.to_str().unwrap()).unwrap();
        let evidence=assess(&before,&after,true,file.to_str().unwrap());
        assert_eq!(evidence["persistence_verified"],true);
        assert_eq!(evidence["edit_semantics_verified"],false);
        let _=fs::remove_dir_all(dir);
    }
    #[test]fn unchanged_file_never_promotes_native_acceptance(){
        let dir=std::env::temp_dir().join(format!("shuvi-ae-save-same-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join("edit.aepx");fs::write(&file,b"same").unwrap();
        let before=fingerprint(file.to_str().unwrap()).unwrap();
        let after=fingerprint(file.to_str().unwrap()).unwrap();
        assert_eq!(assess(&before,&after,true,file.to_str().unwrap())["persistence_verified"],false);
        let _=fs::remove_dir_all(dir);
    }
}
