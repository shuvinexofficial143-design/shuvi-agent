use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs::{self,File},io::Read,path::Path,time::UNIX_EPOCH};

const MAX_PROJECT_BYTES:u64=256*1024*1024;
const BUFFER_BYTES:usize=64*1024;

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectFileFingerprint {
    pub path:String,
    pub size_bytes:u64,
    pub modified_ms:Option<u64>,
    pub fnv1a64:String,
}

pub fn fingerprint(path:&str)->Result<ProjectFileFingerprint,String>{
    let p=Path::new(path);
    if !p.is_absolute()||p.extension().and_then(|v|v.to_str()).map(|v|v.eq_ignore_ascii_case("prproj"))!=Some(true){
        return Err("Project persistence evidence requires an absolute .prproj path.".into());
    }
    let meta=fs::metadata(p).map_err(|e|format!("Project file metadata unavailable: {e}"))?;
    if !meta.is_file()||meta.len()==0||meta.len()>MAX_PROJECT_BYTES{
        return Err("Project file must be a non-empty regular file within the 256 MiB evidence bound.".into());
    }
    let modified_ms=meta.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok())
        .map(|d|d.as_millis().min(u64::MAX as u128) as u64);
    let mut file=File::open(p).map_err(|e|format!("Project file cannot be read for persistence evidence: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut total:u64=0;
    let mut buf=[0u8;BUFFER_BYTES];
    loop{
        let n=file.read(&mut buf).map_err(|e|format!("Project file fingerprint read failed: {e}"))?;
        if n==0{break;}
        total=total.saturating_add(n as u64);
        if total>MAX_PROJECT_BYTES{return Err("Project file changed beyond the 256 MiB evidence bound while reading.".into());}
        for byte in &buf[..n]{hash^=*byte as u64;hash=hash.wrapping_mul(0x100000001b3);}
    }
    if total!=meta.len(){return Err("Project file changed size while persistence evidence was being collected.".into());}
    Ok(ProjectFileFingerprint{path:path.into(),size_bytes:total,modified_ms,fnv1a64:format!("{hash:016x}")})
}

pub fn assess(before:&ProjectFileFingerprint,after:&ProjectFileFingerprint,native_accepted:bool,reported_path:&str)->Value{
    let same_path=before.path==after.path&&after.path==reported_path;
    let size_changed=before.size_bytes!=after.size_bytes;
    let content_changed=before.fnv1a64!=after.fnv1a64;
    let modified_advanced=match(before.modified_ms,after.modified_ms){(Some(a),Some(b))=>b>a,_=>false};
    let independent_write_observed=same_path&&after.size_bytes>0&&(size_changed||content_changed||modified_advanced);
    let verified=native_accepted&&independent_write_observed;
    json!({
        "native_accepted":native_accepted,
        "same_exact_project_path":same_path,
        "before":before,
        "after":after,
        "size_changed":size_changed,
        "content_fingerprint_changed":content_changed,
        "modified_time_advanced":modified_advanced,
        "independent_file_write_observed":independent_write_observed,
        "persistence_verified":verified,
        "edit_semantics_verified":false,
        "verification_status":if verified{"verified_file_persistence"}else{"accepted_unverified"},
        "fingerprint_algorithm":"fnv1a64_noncryptographic_change_detector",
        "retry_safe":false,
        "note":"A changed on-disk .prproj fingerprint proves an independently observed file write after save acceptance; it does not prove the semantic correctness of every in-memory edit."
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn changed_exact_project_file_can_produce_persistence_evidence(){
        let dir=std::env::temp_dir().join(format!("shuvi-project-save-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join("edit.prproj");
        fs::write(&file,b"before").unwrap();
        let before=fingerprint(file.to_str().unwrap()).unwrap();
        fs::write(&file,b"after-project-bytes").unwrap();
        let after=fingerprint(file.to_str().unwrap()).unwrap();
        let evidence=assess(&before,&after,true,file.to_str().unwrap());
        assert_eq!(evidence["persistence_verified"],true);
        assert_eq!(evidence["edit_semantics_verified"],false);
        fs::remove_file(&file).unwrap();fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn native_acceptance_without_independent_file_change_is_not_verified(){
        let dir=std::env::temp_dir().join(format!("shuvi-project-save-static-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join("edit.prproj");
        fs::write(&file,b"same").unwrap();
        let before=fingerprint(file.to_str().unwrap()).unwrap();
        let after=fingerprint(file.to_str().unwrap()).unwrap();
        let evidence=assess(&before,&after,true,file.to_str().unwrap());
        assert_eq!(evidence["persistence_verified"],false);
        fs::remove_file(&file).unwrap();fs::remove_dir(&dir).unwrap();
    }
}
