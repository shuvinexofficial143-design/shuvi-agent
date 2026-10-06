use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{
    fs::{self,File},
    io::{Read,Write},
    path::{Path,PathBuf},
    time::{SystemTime,UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_CHECKPOINT_BYTES:u64=8*1024*1024*1024;
const MAX_PATH_BYTES:usize=32*1024;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Sidecar{
    schema_version:u8,
    document_id:u32,
    source_path:String,
    source_size:u64,
    source_fnv1a64:String,
    backup_path:String,
    backup_size:u64,
    backup_fnv1a64:String,
    created_at_ms:u64,
    purpose:String,
}

fn now_ms()->u64{
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()
        .as_millis().min(u64::MAX as u128) as u64
}

fn safe_document_path(raw:&str)->Result<PathBuf,String>{
    if raw.trim().is_empty()||raw.len()>MAX_PATH_BYTES||raw.chars().any(char::is_control){
        return Err("Photoshop checkpoint source path is empty, oversized, or contains control characters.".into());
    }
    let path=PathBuf::from(raw);
    if !path.is_absolute(){return Err("Photoshop checkpoint requires an absolute saved document path.".into());}
    let ext=path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(),"psd"|"psb"){
        return Err("Photoshop checkpoint requires a saved PSD or PSB document.".into());
    }
    let canonical=fs::canonicalize(&path).map_err(|e|format!("Could not resolve saved Photoshop document: {e}"))?;
    if !canonical.is_file(){return Err("Saved Photoshop checkpoint source is not a regular file.".into());}
    Ok(canonical)
}

fn fingerprint(path:&Path)->Result<(u64,String),String>{
    let metadata=fs::metadata(path).map_err(|e|format!("Could not inspect Photoshop checkpoint file: {e}"))?;
    let size=metadata.len();
    if size==0||size>MAX_CHECKPOINT_BYTES{
        return Err("Photoshop checkpoint file must be between 1 byte and 8 GiB.".into());
    }
    let mut file=File::open(path).map_err(|e|format!("Could not open Photoshop checkpoint file: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut buffer=[0u8;1024*1024];
    loop{
        let count=file.read(&mut buffer).map_err(|e|format!("Could not hash Photoshop checkpoint file: {e}"))?;
        if count==0{break;}
        for byte in &buffer[..count]{
            hash^=*byte as u64;
            hash=hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok((size,format!("{hash:016x}")))
}

fn sidecar_path(backup:&Path)->PathBuf{
    let name=backup.file_name().and_then(|v|v.to_str()).unwrap_or("checkpoint");
    backup.with_file_name(format!("{name}.shuvi.json"))
}

pub fn create(document_id:u32,source_path:&str,saved:bool,cloud_document:bool,purpose:&str)->Result<Value,String>{
    if document_id==0{return Err("Photoshop checkpoint requires a non-zero document ID.".into());}
    if !saved{return Err("Photoshop higher-risk edit requires the document to be saved before checkpointing.".into());}
    if cloud_document{return Err("Photoshop cloud-document checkpoint copy is not supported in this source milestone.".into());}
    if purpose.trim().is_empty()||purpose.len()>120||purpose.chars().any(char::is_control){
        return Err("Photoshop checkpoint purpose is invalid.".into());
    }
    let source=safe_document_path(source_path)?;
    let (source_size,source_hash)=fingerprint(&source)?;
    let parent=source.parent().ok_or("Photoshop source document has no parent directory.")?;
    let backup_dir=parent.join("Shuvi Photoshop Backups");
    fs::create_dir_all(&backup_dir).map_err(|e|format!("Could not create Photoshop backup folder: {e}"))?;
    let stem=source.file_stem().and_then(|v|v.to_str()).unwrap_or("photoshop");
    let ext=source.extension().and_then(|v|v.to_str()).unwrap_or("psd");
    let id=Uuid::new_v4().simple().to_string();
    let backup=backup_dir.join(format!("{stem}-shuvi-{}-{}.{}",now_ms(),&id[..8],ext));
    let copied=fs::copy(&source,&backup).map_err(|e|format!("Could not create Photoshop checkpoint copy: {e}"))?;
    if copied!=source_size{
        let _=fs::remove_file(&backup);
        return Err("Photoshop checkpoint byte count does not match source.".into());
    }
    let (backup_size,backup_hash)=fingerprint(&backup)?;
    if source_size!=backup_size||source_hash!=backup_hash{
        let _=fs::remove_file(&backup);
        return Err("Photoshop checkpoint integrity verification failed.".into());
    }
    let sidecar=Sidecar{
        schema_version:1,document_id,
        source_path:source.to_string_lossy().into_owned(),
        source_size,source_fnv1a64:source_hash.clone(),
        backup_path:backup.to_string_lossy().into_owned(),
        backup_size,backup_fnv1a64:backup_hash.clone(),
        created_at_ms:now_ms(),purpose:purpose.into()
    };
    let encoded=serde_json::to_vec_pretty(&sidecar).map_err(|e|format!("Could not encode Photoshop checkpoint evidence: {e}"))?;
    let sidecar_path=sidecar_path(&backup);
    let mut sidecar_file=File::create(&sidecar_path).map_err(|e|format!("Could not create Photoshop checkpoint sidecar: {e}"))?;
    sidecar_file.write_all(&encoded).map_err(|e|format!("Could not write Photoshop checkpoint sidecar: {e}"))?;
    sidecar_file.sync_all().map_err(|e|format!("Could not sync Photoshop checkpoint sidecar: {e}"))?;
    Ok(json!({
        "schema_version":1,
        "document_id":document_id,
        "source_path":sidecar.source_path,
        "backup_path":sidecar.backup_path,
        "sidecar_path":sidecar_path,
        "source_size":source_size,
        "source_fnv1a64":source_hash,
        "backup_size":backup_size,
        "backup_fnv1a64":backup_hash,
        "integrity_verified":true,
        "purpose":purpose,
        "runtime_restore_verified":false
    }))
}

pub fn verify(backup_path:&str,expected_source_path:&str,expected_document_id:u32)->Result<Value,String>{
    if expected_document_id==0{return Err("Photoshop recovery verification requires a non-zero document ID.".into());}
    let backup=fs::canonicalize(backup_path).map_err(|e|format!("Photoshop checkpoint backup is unavailable: {e}"))?;
    let sidecar_bytes=fs::read(sidecar_path(&backup)).map_err(|e|format!("Photoshop checkpoint sidecar is unavailable: {e}"))?;
    if sidecar_bytes.len()>128*1024{return Err("Photoshop checkpoint sidecar exceeds 128 KiB.".into());}
    let evidence:Sidecar=serde_json::from_slice(&sidecar_bytes).map_err(|e|format!("Invalid Photoshop checkpoint sidecar: {e}"))?;
    if evidence.schema_version!=1||evidence.document_id!=expected_document_id{
        return Err("Photoshop checkpoint evidence does not match the expected document.".into());
    }
    let expected_source=safe_document_path(expected_source_path)?;
    if Path::new(&evidence.source_path)!=expected_source || Path::new(&evidence.backup_path)!=backup{
        return Err("Photoshop checkpoint source/backup identity does not match its sidecar.".into());
    }
    let (backup_size,backup_hash)=fingerprint(&backup)?;
    if backup_size!=evidence.backup_size||backup_hash!=evidence.backup_fnv1a64{
        return Err("Photoshop checkpoint backup changed after creation.".into());
    }
    let (current_source_size,current_source_hash)=fingerprint(&expected_source)?;
    Ok(json!({
        "verified":true,
        "document_id":expected_document_id,
        "source_path":expected_source,
        "backup_path":backup,
        "purpose":evidence.purpose,
        "created_at_ms":evidence.created_at_ms,
        "checkpoint_source_size":evidence.source_size,
        "checkpoint_source_fnv1a64":evidence.source_fnv1a64,
        "current_source_size":current_source_size,
        "current_source_fnv1a64":current_source_hash,
        "backup_size":backup_size,
        "backup_fnv1a64":backup_hash,
        "automatic_restore":false,
        "production_ready":false
    }))
}

#[cfg(test)]
mod tests{
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-photoshop-checkpoint-{}",Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    #[test]
    fn saved_psd_checkpoint_round_trip_verifies(){
        let fixture=Fixture::new();
        let source=fixture.0.join("design.psd");
        fs::write(&source,b"photoshop-fixture").unwrap();
        let created=create(7,source.to_str().unwrap(),true,false,"text edit").unwrap();
        let verified=verify(created["backup_path"].as_str().unwrap(),source.to_str().unwrap(),7).unwrap();
        assert_eq!(created["integrity_verified"],true);
        assert_eq!(verified["verified"],true);
        assert_eq!(verified["automatic_restore"],false);
    }

    #[test]
    fn checkpoint_rejects_unsaved_cloud_and_non_psd(){
        let fixture=Fixture::new();
        let source=fixture.0.join("design.psd");
        fs::write(&source,b"x").unwrap();
        assert!(create(1,source.to_str().unwrap(),false,false,"transform").is_err());
        assert!(create(1,source.to_str().unwrap(),true,true,"transform").is_err());
        let png=fixture.0.join("design.png");fs::write(&png,b"x").unwrap();
        assert!(create(1,png.to_str().unwrap(),true,false,"transform").is_err());
    }

    #[test]
    fn modified_backup_fails_verification(){
        let fixture=Fixture::new();
        let source=fixture.0.join("design.psb");
        fs::write(&source,b"original").unwrap();
        let created=create(9,source.to_str().unwrap(),true,false,"text edit").unwrap();
        fs::write(created["backup_path"].as_str().unwrap(),b"tampered").unwrap();
        assert!(verify(created["backup_path"].as_str().unwrap(),source.to_str().unwrap(),9).is_err());
    }
}
