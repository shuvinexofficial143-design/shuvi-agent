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
    source_path:String,
    source_size:u64,
    source_fnv1a64:String,
    backup_path:String,
    backup_size:u64,
    backup_fnv1a64:String,
    document_signature:String,
    created_at_ms:u64,
    purpose:String,
    checkpoint_scope:String,
}

fn now_ms()->u64{
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()
        .as_millis().min(u64::MAX as u128) as u64
}

fn safe_ai_path(raw:&str)->Result<PathBuf,String>{
    if raw.trim().is_empty()||raw.len()>MAX_PATH_BYTES||raw.chars().any(char::is_control){
        return Err("Illustrator checkpoint source path is empty, oversized, or contains control characters.".into());
    }
    let path=PathBuf::from(raw);
    if !path.is_absolute(){return Err("Illustrator checkpoint requires an absolute saved AI path.".into());}
    if path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase()!="ai"{
        return Err("Illustrator checkpoint is currently limited to local .ai documents.".into());
    }
    let canonical=fs::canonicalize(&path).map_err(|e|format!("Could not resolve saved Illustrator AI file: {e}"))?;
    if !canonical.is_file(){return Err("Saved Illustrator checkpoint source is not a regular file.".into());}
    Ok(canonical)
}

fn fingerprint(path:&Path)->Result<(u64,String),String>{
    let metadata=fs::metadata(path).map_err(|e|format!("Could not inspect Illustrator checkpoint file: {e}"))?;
    let size=metadata.len();
    if size==0||size>MAX_CHECKPOINT_BYTES{
        return Err("Illustrator checkpoint AI file must be between 1 byte and 8 GiB.".into());
    }
    let mut file=File::open(path).map_err(|e|format!("Could not open Illustrator checkpoint file: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut buffer=[0u8;1024*1024];
    loop{
        let count=file.read(&mut buffer).map_err(|e|format!("Could not hash Illustrator checkpoint file: {e}"))?;
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

pub fn create(source_path:&str,document_signature:&str,purpose:&str)->Result<Value,String>{
    super::illustrator::validate_identity_signature(document_signature)?;
    if purpose.trim().is_empty()||purpose.len()>120||purpose.chars().any(char::is_control){
        return Err("Illustrator checkpoint purpose is invalid.".into());
    }
    let source=safe_ai_path(source_path)?;
    let (source_size,source_hash)=fingerprint(&source)?;
    let parent=source.parent().ok_or("Illustrator source AI file has no parent directory.")?;
    let backup_dir=parent.join("Shuvi Illustrator Backups");
    fs::create_dir_all(&backup_dir).map_err(|e|format!("Could not create Illustrator backup folder: {e}"))?;
    let stem=source.file_stem().and_then(|v|v.to_str()).unwrap_or("illustrator");
    let id=Uuid::new_v4().simple().to_string();
    let backup=backup_dir.join(format!("{stem}-shuvi-{}-{}.ai",now_ms(),&id[..8]));
    let copied=fs::copy(&source,&backup).map_err(|e|format!("Could not create Illustrator checkpoint copy: {e}"))?;
    if copied!=source_size{
        let _=fs::remove_file(&backup);
        return Err("Illustrator checkpoint byte count does not match source.".into());
    }
    let (backup_size,backup_hash)=fingerprint(&backup)?;
    if source_size!=backup_size||source_hash!=backup_hash{
        let _=fs::remove_file(&backup);
        return Err("Illustrator checkpoint integrity verification failed.".into());
    }
    let sidecar=Sidecar{
        schema_version:1,
        source_path:source.to_string_lossy().into_owned(),
        source_size,
        source_fnv1a64:source_hash.clone(),
        backup_path:backup.to_string_lossy().into_owned(),
        backup_size,
        backup_fnv1a64:backup_hash.clone(),
        document_signature:document_signature.into(),
        created_at_ms:now_ms(),
        purpose:purpose.into(),
        checkpoint_scope:"last_saved_disk_ai_only".into(),
    };
    let encoded=serde_json::to_vec_pretty(&sidecar).map_err(|e|format!("Could not encode Illustrator checkpoint evidence: {e}"))?;
    let evidence_path=sidecar_path(&backup);
    let mut file=File::create(&evidence_path).map_err(|e|format!("Could not create Illustrator checkpoint sidecar: {e}"))?;
    file.write_all(&encoded).map_err(|e|format!("Could not write Illustrator checkpoint sidecar: {e}"))?;
    file.sync_all().map_err(|e|format!("Could not sync Illustrator checkpoint sidecar: {e}"))?;
    Ok(json!({
        "schema_version":1,
        "source_path":sidecar.source_path,
        "backup_path":sidecar.backup_path,
        "sidecar_path":evidence_path,
        "source_size":source_size,
        "source_fnv1a64":source_hash,
        "backup_size":backup_size,
        "backup_fnv1a64":backup_hash,
        "document_signature":document_signature,
        "integrity_verified":true,
        "checkpoint_scope":"last_saved_disk_ai_only",
        "unsaved_in_memory_edits_protected":false,
        "automatic_restore":false,
        "runtime_restore_verified":false
    }))
}

pub fn verify(backup_path:&str,expected_source_path:&str,expected_document_signature:&str)->Result<Value,String>{
    super::illustrator::validate_identity_signature(expected_document_signature)?;
    let backup=fs::canonicalize(backup_path).map_err(|e|format!("Illustrator checkpoint backup is unavailable: {e}"))?;
    let sidecar_bytes=fs::read(sidecar_path(&backup)).map_err(|e|format!("Illustrator checkpoint sidecar is unavailable: {e}"))?;
    if sidecar_bytes.len()>128*1024{return Err("Illustrator checkpoint sidecar exceeds 128 KiB.".into());}
    let evidence:Sidecar=serde_json::from_slice(&sidecar_bytes).map_err(|e|format!("Invalid Illustrator checkpoint sidecar: {e}"))?;
    if evidence.schema_version!=1||evidence.document_signature!=expected_document_signature{
        return Err("Illustrator checkpoint evidence does not match the expected document signature.".into());
    }
    let expected_source=safe_ai_path(expected_source_path)?;
    if Path::new(&evidence.source_path)!=expected_source||Path::new(&evidence.backup_path)!=backup{
        return Err("Illustrator checkpoint source/backup identity does not match its sidecar.".into());
    }
    let (backup_size,backup_hash)=fingerprint(&backup)?;
    if backup_size!=evidence.backup_size||backup_hash!=evidence.backup_fnv1a64{
        return Err("Illustrator checkpoint backup changed after creation.".into());
    }
    let (current_source_size,current_source_hash)=fingerprint(&expected_source)?;
    Ok(json!({
        "verified":true,
        "source_path":expected_source,
        "backup_path":backup,
        "purpose":evidence.purpose,
        "created_at_ms":evidence.created_at_ms,
        "document_signature":evidence.document_signature,
        "checkpoint_source_size":evidence.source_size,
        "checkpoint_source_fnv1a64":evidence.source_fnv1a64,
        "current_source_size":current_source_size,
        "current_source_fnv1a64":current_source_hash,
        "backup_size":backup_size,
        "backup_fnv1a64":backup_hash,
        "checkpoint_scope":"last_saved_disk_ai_only",
        "unsaved_in_memory_edits_protected":false,
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
            let path=std::env::temp_dir().join(format!("shuvi-illustrator-checkpoint-{}",Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}

    #[test]
    fn illustrator_checkpoint_round_trip_verifies(){
        let fixture=Fixture::new();
        let source=fixture.0.join("scene.ai");
        fs::write(&source,b"illustrator-fixture").unwrap();
        let created=create(source.to_str().unwrap(),"doc|1","layer_visible").unwrap();
        let verified=verify(created["backup_path"].as_str().unwrap(),source.to_str().unwrap(),"doc|1").unwrap();
        assert_eq!(created["integrity_verified"],true);
        assert_eq!(created["unsaved_in_memory_edits_protected"],false);
        assert_eq!(verified["verified"],true);
        assert_eq!(verified["automatic_restore"],false);
    }

    #[test]
    fn illustrator_checkpoint_rejects_non_ai_and_tampered_backup(){
        let fixture=Fixture::new();
        let bad=fixture.0.join("scene.svg");
        fs::write(&bad,b"x").unwrap();
        assert!(create(bad.to_str().unwrap(),"doc|1","layer_visible").is_err());
        let source=fixture.0.join("scene.ai");
        fs::write(&source,b"original").unwrap();
        let created=create(source.to_str().unwrap(),"doc|1","layer_visible").unwrap();
        fs::write(created["backup_path"].as_str().unwrap(),b"tampered").unwrap();
        assert!(verify(created["backup_path"].as_str().unwrap(),source.to_str().unwrap(),"doc|1").is_err());
    }
}
