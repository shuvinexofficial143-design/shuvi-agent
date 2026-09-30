use serde_json::json;
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};
use uuid::Uuid;

const MAX_PROJECT_BYTES:u64=2*1024*1024*1024;
const BUFFER_BYTES:usize=1024*1024;

fn validate_source(source:&Path)->Result<(),String>{
    if !source.is_absolute(){return Err("After Effects checkpoint requires an absolute project path.".into());}
    let ext=source.extension().and_then(|v|v.to_str()).unwrap_or("");
    if !matches!(ext.to_ascii_lowercase().as_str(),"aep"|"aepx"){
        return Err("After Effects checkpoint requires .aep or .aepx.".into());
    }
    let link=fs::symlink_metadata(source).map_err(|e|format!("After Effects project unavailable: {e}"))?;
    if link.file_type().is_symlink()||!link.is_file(){return Err("After Effects checkpoint source must be a regular non-symlink file.".into());}
    if link.len()==0||link.len()>MAX_PROJECT_BYTES{return Err("After Effects project size is outside checkpoint bounds.".into());}
    Ok(())
}

fn fnv1a(path:&Path)->Result<String,String>{
    let mut file=File::open(path).map_err(|e|format!("Could not open After Effects project for fingerprint: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut buf=vec![0u8;BUFFER_BYTES];
    loop{
        let n=file.read(&mut buf).map_err(|e|format!("Could not fingerprint After Effects project: {e}"))?;
        if n==0{break;}
        for b in &buf[..n]{hash^=*b as u64;hash=hash.wrapping_mul(0x100000001b3);}
    }
    Ok(format!("{hash:016x}"))
}

fn backup_dir(source:&Path)->Result<PathBuf,String>{
    let parent=source.parent().ok_or("After Effects project has no parent folder.")?;
    Ok(parent.join("Shuvi Backups"))
}

pub fn create(source:&Path,timestamp_ms:u64)->Result<serde_json::Value,String>{
    validate_source(source)?;
    let before=fs::metadata(source).map_err(|e|e.to_string())?;
    let before_len=before.len();
    let before_hash=fnv1a(source)?;
    let dir=backup_dir(source)?;
    fs::create_dir_all(&dir).map_err(|e|format!("Could not create After Effects backup folder: {e}"))?;
    let name=source.file_stem().and_then(|v|v.to_str()).ok_or("Invalid After Effects project filename.")?;
    let ext=source.extension().and_then(|v|v.to_str()).unwrap_or("aep");
    let id=Uuid::new_v4().simple().to_string();
    let backup=dir.join(format!("{name}.shuvi-{timestamp_ms}-{id}.{ext}"));
    let metadata=backup.with_extension(format!("{ext}.checkpoint.json"));

    let mut input=File::open(source).map_err(|e|format!("Could not open After Effects project: {e}"))?;
    let mut output=OpenOptions::new().write(true).create_new(true).open(&backup)
        .map_err(|e|format!("Could not reserve After Effects checkpoint: {e}"))?;
    let mut copied=0u64;
    let mut buf=vec![0u8;BUFFER_BYTES];
    let copy_result=(||->Result<(),String>{
        loop{
            let n=input.read(&mut buf).map_err(|e|format!("Could not read After Effects project: {e}"))?;
            if n==0{break;}
            copied=copied.saturating_add(n as u64);
            if copied>MAX_PROJECT_BYTES{return Err("After Effects checkpoint exceeded size limit.".into());}
            output.write_all(&buf[..n]).map_err(|e|format!("Could not copy After Effects checkpoint: {e}"))?;
        }
        output.sync_all().map_err(|e|format!("Could not flush After Effects checkpoint: {e}"))?;
        Ok(())
    })();
    if let Err(error)=copy_result{let _=fs::remove_file(&backup);return Err(error);}

    let source_after=fs::metadata(source).map_err(|e|e.to_string())?;
    if source_after.len()!=before_len || fnv1a(source)?!=before_hash {
        let _=fs::remove_file(&backup);
        return Err("After Effects project changed while checkpoint was being copied; mutation was not dispatched.".into());
    }
    if fs::metadata(&backup).map_err(|e|e.to_string())?.len()!=before_len || fnv1a(&backup)?!=before_hash{
        let _=fs::remove_file(&backup);
        return Err("After Effects checkpoint copy failed fingerprint verification.".into());
    }

    let receipt=json!({
        "schema_version":1,
        "checkpoint_id":id,
        "created_at_ms":timestamp_ms,
        "source_path":source.to_string_lossy(),
        "backup_path":backup.to_string_lossy(),
        "bytes":before_len,
        "fingerprint_fnv1a64":before_hash,
        "runtime_recovery_verified":false
    });
    let bytes=serde_json::to_vec_pretty(&receipt).map_err(|e|e.to_string())?;
    let mut meta=OpenOptions::new().write(true).create_new(true).open(&metadata)
        .map_err(|e|format!("Could not reserve After Effects checkpoint receipt: {e}"))?;
    if let Err(e)=meta.write_all(&bytes).and_then(|_|meta.sync_all()){
        let _=fs::remove_file(&metadata);let _=fs::remove_file(&backup);
        return Err(format!("Could not persist After Effects checkpoint receipt: {e}"));
    }
    Ok(receipt)
}

pub fn verify(backup:&Path,expected_source:&Path)->Result<serde_json::Value,String>{
    validate_source(expected_source)?;
    if !backup.is_absolute(){return Err("After Effects checkpoint verification requires absolute path.".into());}
    let ext=backup.extension().and_then(|v|v.to_str()).unwrap_or("");
    if !matches!(ext.to_ascii_lowercase().as_str(),"aep"|"aepx"){return Err("Invalid After Effects checkpoint extension.".into());}
    let metadata=backup.with_extension(format!("{ext}.checkpoint.json"));
    let raw=crate::read_file_bytes_bounded(&metadata,16*1024,"After Effects checkpoint metadata")?;
    let receipt:serde_json::Value=serde_json::from_slice(&raw).map_err(|_|"Invalid After Effects checkpoint metadata.")?;
    if receipt.get("schema_version").and_then(serde_json::Value::as_u64)!=Some(1){return Err("Unsupported After Effects checkpoint metadata.".into());}
    let expected_backup=receipt.get("backup_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint backup path missing.")?;
    let expected_source_text=receipt.get("source_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint source path missing.")?;
    if Path::new(expected_backup)!=backup || Path::new(expected_source_text)!=expected_source{
        return Err("After Effects checkpoint path binding changed.".into());
    }
    let bytes=receipt.get("bytes").and_then(serde_json::Value::as_u64).ok_or("Checkpoint byte count missing.")?;
    let hash=receipt.get("fingerprint_fnv1a64").and_then(serde_json::Value::as_str).ok_or("Checkpoint fingerprint missing.")?;
    if fs::metadata(backup).map_err(|e|e.to_string())?.len()!=bytes || fnv1a(backup)?!=hash{
        return Err("After Effects checkpoint content no longer matches creation receipt.".into());
    }
    Ok(json!({"verified":true,"backup_path":backup,"source_path":expected_source,"bytes":bytes,"fingerprint_fnv1a64":hash,
        "recovery_of_host_state_verified":false}))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn checkpoint_is_distinct_and_tamper_evident(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-checkpoint-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source=root.join("edit.aep");fs::write(&source,b"after-effects-project").unwrap();
        let receipt=create(&source,123).unwrap();
        let backup=PathBuf::from(receipt["backup_path"].as_str().unwrap());
        assert_ne!(backup,source);
        assert_eq!(verify(&backup,&source).unwrap()["verified"],true);
        fs::write(&backup,b"tampered").unwrap();
        assert!(verify(&backup,&source).is_err());
        let _=fs::remove_dir_all(root);
    }
    #[test]fn checkpoint_rejects_wrong_extension_empty_and_relative(){
        assert!(create(Path::new("relative.aep"),1).is_err());
        let root=std::env::temp_dir().join(format!("shuvi-ae-checkpoint-bad-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let empty=root.join("empty.aep");fs::write(&empty,b"").unwrap();assert!(create(&empty,1).is_err());
        let wrong=root.join("edit.txt");fs::write(&wrong,b"x").unwrap();assert!(create(&wrong,1).is_err());
        let _=fs::remove_dir_all(root);
    }
}
