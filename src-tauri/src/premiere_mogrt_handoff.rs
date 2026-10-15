//! Owner-approved After Effects/Premiere MOGRT artifact handoff.
 //! A matching hash binds bytes, NOT the Adobe producer, editable controls or appearance.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs,path::Path};
use crate::premiere_media_relink::{self,MediaFingerprint};

const MAX_MOGRT_BYTES:u64=256*1024*1024;
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct InsertRequest{
    pub path:String,
    pub expected_sha256:String,
    pub seconds:f64,
    pub video_track:u32,
    pub audio_track:u32,
}
fn clean_path(path:&str)->Result<&Path,String>{
    if path.len()<9||path.len()>4096||path.trim()!=path
        ||path.chars().any(|c|c.is_control()){
        return Err("MOGRT artifact path must be bounded and clean.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute()||p.extension().and_then(|v|v.to_str())
        .is_none_or(|v|!v.eq_ignore_ascii_case("mogrt")){
        return Err("MOGRT artifact must be an absolute .mogrt file.".into());
    }
    let meta=fs::symlink_metadata(p).map_err(|e|format!("MOGRT artifact cannot be inspected: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.len()==0
        ||meta.len()>MAX_MOGRT_BYTES{
        return Err("MOGRT artifact must be a regular nonempty non-symlink file, at most 256 MiB.".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes()&0x400!=0{
            return Err("MOGRT artifact is a reparse point.".into());
        }
    }
    Ok(p)
}
pub fn inspect(path:&str)->Result<MediaFingerprint,String>{
    clean_path(path)?;
    let item=premiere_media_relink::fingerprint(path)?;
    if item.size_bytes>MAX_MOGRT_BYTES{
        return Err("MOGRT artifact grew past the 256 MiB bound during inspection.".into());
    }
    Ok(item)
}
impl InsertRequest{
    pub fn validate(&self)->Result<(),String>{
        clean_path(&self.path)?;
        if self.expected_sha256.len()!=64
            ||!self.expected_sha256.bytes().all(|b|b.is_ascii_hexdigit()){
            return Err("A 64-character expected SHA-256 is mandatory for MOGRT handoff.".into());
        }
        if !self.seconds.is_finite()||self.seconds<0.0||self.seconds>86400.0
            ||self.video_track>128||self.audio_track>128{
            return Err("MOGRT time and track indices are outside the safe bounded range.".into());
        }
        Ok(())
    }
    pub fn verify_source(&self)->Result<MediaFingerprint,String>{
        self.validate()?;
        let file=inspect(&self.path)?;
        if file.sha256!=self.expected_sha256.to_ascii_lowercase(){
            return Err("MOGRT source SHA-256 differs from the approved artifact; insertion blocked.".into());
        }
        Ok(file)
    }
}
pub fn assess_receipt(
    request:&InsertRequest,before:&MediaFingerprint,after:&MediaFingerprint,
    insertion:&Value,saved:bool,same_project:bool,persistence:&Value
)->Value{
    let source_unchanged=premiere_media_relink::same_file(before,after)
        &&before.sha256==request.expected_sha256.to_ascii_lowercase();
    let clip_identity=insertion.get("verificationStatus").and_then(Value::as_str)
        ==Some("verified_creation_identity")
        &&insertion.get("insertedClipIdentityVerified").and_then(Value::as_bool)==Some(true)
        &&insertion.get("source").and_then(Value::as_str)==Some("path")
        &&insertion.get("path").and_then(Value::as_str)==Some(request.path.as_str());
    let project_persisted=persistence.get("persistence_verified").and_then(Value::as_bool)==Some(true);
    let verified=source_unchanged&&clip_identity&&saved&&same_project&&project_persisted;
    json!({"handoff_verified":verified,
        "source_sha256_verified":source_unchanged,
        "native_new_clip_identity_verified":clip_identity,
        "project_saved":saved,"active_project_identity_preserved":same_project,
        "on_disk_project_persistence_verified":project_persisted,
        "after_effects_producer_verified":false,
        "mogrt_template_semantics_verified":false,
        "video_playback_verified":false,"retry_safe":false,
        "source_fingerprint":after,
        "note":"Only exact source bytes, new Premiere clip identity and independently observed .prproj save are checked. This does not prove AE origin or MOGRT visual/editorial correctness."})
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn exact_mogrt_hash_and_changed_bytes(){
        let dir=std::env::temp_dir().join(format!("shuvi40-mogrt-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path=dir.join("title.mogrt");
        fs::write(&path,b"mock-title-mogrt-content").unwrap();
        let filename=path.to_str().unwrap().to_string();
        let hash=inspect(&filename).unwrap().sha256;
        let request=InsertRequest{path:filename.clone(),expected_sha256:hash.clone(),
            seconds:4.0,video_track:2,audio_track:0};
        let a=request.verify_source().unwrap();
        let receipt=json!({"verificationStatus":"verified_creation_identity",
            "insertedClipIdentityVerified":true,"source":"path","path":filename});
        let persistence=json!({"persistence_verified":true});
        let accepted=assess_receipt(&request,&a,&a,&receipt,true,true,&persistence);
        assert_eq!(accepted["handoff_verified"],true);
        assert_eq!(accepted["after_effects_producer_verified"],false);
        fs::write(&path,b"changed").unwrap();
        assert!(request.verify_source().is_err());
        assert!(assess_receipt(&request,&a,&inspect(&filename).unwrap(),
            &receipt,true,true,&persistence)["handoff_verified"]==false);
        fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn invalid_mogrt_requests_fail_before_host(){
        let dir=std::env::temp_dir().join(format!("shuvi40-mogrt-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();let path=dir.join("title.mogrt");
        fs::write(&path,b"test").unwrap();
        let good=InsertRequest{path:path.to_str().unwrap().into(),expected_sha256:"a".repeat(64),
            seconds:0.0,video_track:0,audio_track:0};
        let mut bad=good.clone();bad.expected_sha256="not hash".into();
        assert!(bad.validate().is_err());
        bad=good.clone();bad.seconds=f64::NAN;assert!(bad.validate().is_err());
        bad=good.clone();bad.video_track=129;assert!(bad.validate().is_err());
        bad=good.clone();bad.path="../title.mogrt".into();assert!(bad.validate().is_err());
        fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();
    }
}
