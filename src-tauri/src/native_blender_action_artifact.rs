//! Authenticated *Rust-verified* Blender output tied to one native action UUID.
//! Created only after a supervised worker's zero OS exit, authenticated
//! application readback, full tree termination, and independent SHA-256 hash.
//! This is an artifact handoff, NOT a substitute for the Rust executed audit.
use serde::{Serialize,Deserialize};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs,io::Read,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
static IO:Mutex<()>=Mutex::new(());
const MAX_BYTES:usize=5_120;
const MAX_ARTIFACT:u64=128*1024*1024;
const MAX_RECORDS:usize=1024;

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct VerifiedBlenderArtifact{
    pub version:u32,
    pub action_id:String,
    pub tool:String,
    pub path:String,
    pub sha256:String,
    pub bytes:u64,
}
fn valid_uuid(id:&str)->bool{
    uuid::Uuid::parse_str(id).map(|x|x.to_string()==id).unwrap_or(false)
}
fn validate(r:&VerifiedBlenderArtifact)->Result<(),String>{
    if r.version!=1||r.tool!="blender_run_plan"
        ||!valid_uuid(&r.action_id)||r.path.len()>4096
        ||r.bytes==0||r.bytes>MAX_ARTIFACT
        ||r.sha256.len()!=64||!r.sha256.bytes().all(|b|
            b.is_ascii_digit()||(b'a'..=b'f').contains(&b))
        ||r.path.chars().any(char::is_control)
        ||!Path::new(&r.path).is_absolute()
        ||!matches!(Path::new(&r.path).extension().and_then(|x|x.to_str())
            .unwrap_or("").to_ascii_lowercase().as_str(),"blend"|"png"){
        return Err("Verified native Blender output identity is invalid.".into());
    }
    Ok(())
}
fn file_hash(path:&Path)->Result<(u64,String),String>{
    let m=fs::symlink_metadata(path)
        .map_err(|_|"Verified Blender delivery file is missing.".to_string())?;
    if !m.is_file()||m.file_type().is_symlink()||m.len()==0||m.len()>MAX_ARTIFACT{
        return Err("Verified Blender delivery file type/size invalid.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes()&0x400!=0{
            return Err("Verified Blender delivery path is a Windows reparse point.".into());
        }
    }
    let mut f=fs::File::open(path)
        .map_err(|_|"Verified Blender delivery file cannot be opened.".to_string())?;
    let mut hasher=Sha256::new();let mut bytes=0u64;
    let mut buf=[0u8;65536];
    loop {
        let n=f.read(&mut buf).map_err(|_|"Blender output rehash failed.".to_string())?;
        if n==0{break;}
        bytes=bytes.checked_add(n as u64).ok_or("Blender output exceeds size budget.")?;
        if bytes>MAX_ARTIFACT{return Err("Blender output exceeded 128 MiB.".into());}
        hasher.update(&buf[..n]);
    }
    if bytes!=m.len(){return Err("Blender output changed while rehashing.".into());}
    Ok((bytes,format!("{:x}",hasher.finalize())))
}
fn check_bytes(data:&[u8])->Result<(),String>{
    if data.len()>MAX_BYTES{return Err("Blender delivery certificate exceeds budget.".into());}
    let r:VerifiedBlenderArtifact=serde_json::from_slice(data)
        .map_err(|_|"Blender delivery certificate is malformed.".to_string())?;
    validate(&r)
}
fn root(app:&AppHandle)->Result<PathBuf,String>{
    let base=app.path().app_data_dir()
        .map_err(|_|"Private Blender certificate storage unavailable.".to_string())?
        .join("native-blender-action-artifacts");
    fs::create_dir_all(&base)
        .map_err(|_|"Private Blender certificate directory inaccessible.".to_string())?;
    Ok(base)
}
fn record_path(dir:&Path,action_id:&str)->Result<PathBuf,String>{
    if !valid_uuid(action_id){return Err("Blender action receipt UUID invalid.".into());}
    Ok(dir.join(format!("{action_id}.json")))
}
fn verify_file_record(r:&VerifiedBlenderArtifact)->Result<(),String>{
    validate(r)?;
    let (size,sha)=file_hash(Path::new(&r.path))?;
    if size!=r.bytes||sha!=r.sha256{
        return Err("Blender action UUID output no longer matches actual file/hash.".into());
    }
    Ok(())
}
fn read_at(dir:&Path,id:&str)->Result<Option<VerifiedBlenderArtifact>,String>{
    let path=record_path(dir,id)?;
    if !path.exists(){
        if path.with_extension("json.bak").exists()||path.with_extension("json.tmp").exists(){
            return Err("Blender action receipt interrupted; owner inspection required.".into());
        }
        return Ok(None);
    }
    let meta=fs::symlink_metadata(&path)
        .map_err(|_|"Blender action receipt cannot be inspected.".to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink(){
        return Err("Blender action receipt file type invalid.".into());
    }
    let raw=crate::read_file_bytes_bounded(&path,MAX_BYTES,"Blender action certificate")?;
    check_bytes(&raw)?;
    let receipt:VerifiedBlenderArtifact=serde_json::from_slice(&raw)
        .map_err(|_|"Blender action receipt cannot be decoded.".to_string())?;
    if receipt.action_id!=id{return Err("Foreign native Blender artifact UUID.".into());}
    Ok(Some(receipt))
}
fn create_at(dir:&Path,record:&VerifiedBlenderArtifact)->Result<(),String>{
    verify_file_record(record)?;
    if read_at(dir,&record.action_id)?.is_some(){
        return Err("Verified Blender artifact UUID cannot be published twice.".into());
    }
    let existing=fs::read_dir(dir)
        .map_err(|_|"Blender evidence journal cannot be inspected.".to_string())?
        .take(MAX_RECORDS+1).count();
    if existing>=MAX_RECORDS{return Err("Blender action receipt store full; owner archival required.".into());}
    let bytes=serde_json::to_vec(record)
        .map_err(|_|"Could not encode native Blender artifact certificate.".to_string())?;
    crate::atomic_file::create_new_verified(
        &record_path(dir,&record.action_id)?,&bytes,"native Blender verified artifact")?;
    // Read back the exact persisted immutable UUID evidence before return.
    if read_at(dir,&record.action_id)?.as_ref()!=Some(record){
        return Err("Persisted native Blender artifact certificate mismatched write.".into());
    }
    Ok(())
}
pub(crate) fn record_verified(app:&AppHandle,action_id:&str,evidence:&Value)->Result<(),String>{
    let _io=IO.lock().map_err(|_|"Blender certificate journal lock poisoned.")?;
    let artifact=evidence.get("artifact").ok_or("Blender verified artifact missing.")?;
    let path=artifact.get("path").and_then(Value::as_str)
        .ok_or("Blender artifact path absent.")?;
    let expected_hash=artifact.get("sha256").and_then(Value::as_str)
        .ok_or("Blender artifact SHA256 absent.")?;
    let bytes=artifact.get("bytes").and_then(Value::as_u64)
        .ok_or("Blender artifact byte count absent.")?;
    let record=VerifiedBlenderArtifact{
        version:1,action_id:action_id.to_string(),tool:"blender_run_plan".into(),
        path:path.to_string(),sha256:expected_hash.to_ascii_lowercase(),bytes
    };
    create_at(&root(app)?,&record)
}
pub(crate) fn require_exact(app:&AppHandle,id:&str,
    path:&str,sha256:&str,bytes:u64)->Result<(),String>{
    let _io=IO.lock().map_err(|_|"Blender certificate journal lock poisoned.")?;
    let record=read_at(&root(app)?,id)?
        .ok_or("Native Blender delivery lacks matching supervised worker certificate.")?;
    if record.path!=path||record.sha256!=sha256||record.bytes!=bytes{
        return Err("Blender delivered artifact was not produced by the exact audited action UUID.".into());
    }
    verify_file_record(&record)
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn prepare()->(PathBuf,PathBuf,VerifiedBlenderArtifact){
        let dir=std::env::temp_dir().join(format!("shuvi-artifact-ledger-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let output=dir.join("test.blend");
        fs::write(&output,b"BLENDER WORKER OUTPUT").unwrap();
        let (bytes,sha256)=file_hash(&output).unwrap();
        let record=VerifiedBlenderArtifact{version:1,action_id:A.into(),tool:"blender_run_plan".into(),
            path:output.to_str().unwrap().into(),sha256,bytes};
        (dir,output,record)
    }
    #[test]
    fn action_bound_disk_receipt_survives_restart_and_rejects_foreign_uuid(){
        let (dir,output,record)=prepare();
        create_at(&dir,&record).unwrap();
        assert_eq!(read_at(&dir,A).unwrap(),Some(record.clone()));
        assert_eq!(read_at(&dir,B).unwrap(),None);
        assert!(create_at(&dir,&record).is_err());
        let mut altered=record.clone();altered.action_id=B.into();
        assert!(read_at(&dir,A).unwrap().is_some());
        assert_ne!(read_at(&dir,A).unwrap(),Some(altered));
        let _=fs::remove_dir_all(dir);let _=fs::remove_file(output);
    }
    #[test]
    fn modified_file_or_claimed_sha256_cannot_be_delivered(){
        let (dir,output,record)=prepare();
        create_at(&dir,&record).unwrap();
        verify_file_record(&record).unwrap();
        fs::write(&output,b"TAMPERED OUTPUT").unwrap();
        assert!(verify_file_record(&record).is_err());
        let forged=VerifiedBlenderArtifact{sha256:"0".repeat(64),..record};
        assert!(verify_file_record(&forged).is_err());
        let _=fs::remove_dir_all(dir);
    }
    #[test]
    fn corrupt_certificate_never_falls_back_to_foreign_action(){
        let (dir,_output,record)=prepare();create_at(&dir,&record).unwrap();
        fs::write(record_path(&dir,A).unwrap(),b"{").unwrap();
        assert!(read_at(&dir,A).is_err());
        let _=fs::remove_dir_all(dir);
    }
}
