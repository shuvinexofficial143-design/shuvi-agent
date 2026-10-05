use serde_json::json;
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};
use uuid::Uuid;

const MAX_PROJECT_BYTES:u64=2*1024*1024*1024;
const BUFFER_BYTES:usize=1024*1024;
const MAX_CHECKPOINTS_PER_PROJECT:usize=32;
static CHECKPOINT_IO:std::sync::Mutex<()>=std::sync::Mutex::new(());

fn validate_path(source:&Path)->Result<(),String>{
    if !source.is_absolute(){return Err("After Effects checkpoint requires an absolute project path.".into());}
    let ext=source.extension().and_then(|v|v.to_str()).unwrap_or("");
    if !matches!(ext.to_ascii_lowercase().as_str(),"aep"|"aepx"){
        return Err("After Effects checkpoint requires .aep or .aepx.".into());
    }
    if source.to_string_lossy().len()>4096{return Err("After Effects project path exceeds bound.".into());}
    Ok(())
}
fn reject_links(path:&Path)->Result<(),String>{
    for part in path.ancestors(){
        let meta=fs::symlink_metadata(part).map_err(|e|format!("Checkpoint path component unavailable: {e}"))?;
        if meta.file_type().is_symlink(){return Err("Checkpoint path must not contain symlinks.".into());}
        #[cfg(target_os="windows")]
        {use std::os::windows::fs::MetadataExt;
            if meta.file_attributes()&0x400!=0{return Err("Checkpoint path must not contain reparse points.".into());}}
    }
    Ok(())
}
fn validate_source(source:&Path)->Result<(),String>{
    validate_path(source)?;reject_links(source)?;
    let link=fs::symlink_metadata(source).map_err(|e|format!("After Effects project unavailable: {e}"))?;
    if link.file_type().is_symlink()||!link.is_file(){return Err("After Effects checkpoint source must be a regular non-symlink file.".into());}
    if link.len()==0||link.len()>MAX_PROJECT_BYTES{return Err("After Effects project size is outside checkpoint bounds.".into());}
    Ok(())
}

fn fnv1a(path:&Path)->Result<String,String>{
    let mut file=File::open(path).map_err(|e|format!("Could not open After Effects project for fingerprint: {e}"))?;
    let mut hash:u64=0xcbf29ce484222325;
    let mut total=0u64;
    let mut buf=vec![0u8;BUFFER_BYTES];
    loop{
        let n=file.read(&mut buf).map_err(|e|format!("Could not fingerprint After Effects project: {e}"))?;
        if n==0{break;}
        total=total.saturating_add(n as u64);
        if total>MAX_PROJECT_BYTES{return Err("Checkpoint fingerprint input exceeded size bound while reading.".into());}
        for b in &buf[..n]{hash^=*b as u64;hash=hash.wrapping_mul(0x100000001b3);}
    }
    Ok(format!("{hash:016x}"))
}

fn backup_dir(source:&Path)->Result<PathBuf,String>{
    let parent=source.parent().ok_or("After Effects project has no parent folder.")?;
    Ok(parent.join("Shuvi Backups"))
}

pub fn create(source:&Path,timestamp_ms:u64)->Result<serde_json::Value,String>{
    create_bound(source,timestamp_ms,None,None)
}
pub fn create_for_request(source:&Path,timestamp_ms:u64,request_id:&str,revision:u64)->Result<serde_json::Value,String>{
    if request_id.is_empty()||request_id.len()>80||!request_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')||revision==0{
        return Err("Invalid checkpoint request/revision binding.".into());
    }
    create_bound(source,timestamp_ms,Some(request_id),Some(revision))
}
fn create_bound(source:&Path,timestamp_ms:u64,request_id:Option<&str>,revision:Option<u64>)->Result<serde_json::Value,String>{
    let _io=CHECKPOINT_IO.lock().map_err(|_|"After Effects checkpoint lock unavailable.")?;
    validate_source(source)?;
    let dir=backup_dir(source)?;
    fs::create_dir_all(&dir).map_err(|e|format!("Could not create After Effects backup folder: {e}"))?;
    reject_links(&dir)?;
    let stem=source.file_stem().and_then(|v|v.to_str()).ok_or("Invalid After Effects project filename.")?;
    let prefix=format!("{stem}.shuvi-");
    let existing=fs::read_dir(&dir).map_err(|e|format!("Could not inspect After Effects backup folder: {e}"))?
        .filter_map(Result::ok)
        .filter(|e|e.file_type().ok().is_some_and(|t|t.is_file()))
        .filter(|e|{
            let name=e.file_name();let name=name.to_string_lossy();
            name.starts_with(&prefix)&&(name.ends_with(".aep")||name.ends_with(".aepx"))
        }).take(MAX_CHECKPOINTS_PER_PROJECT+1).count();
    if existing>=MAX_CHECKPOINTS_PER_PROJECT{
        return Err("After Effects checkpoint retention limit reached; review/remove old Shuvi backups explicitly before further mutations.".into());
    }
    let before=fs::metadata(source).map_err(|e|e.to_string())?;
    let before_len=before.len();
    let before_hash=fnv1a(source)?;
    let name=stem;
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
        "schema_version":2,
        "checkpoint_id":id,
        "created_at_ms":timestamp_ms,
        "source_path":source.to_string_lossy(),
        "backup_path":backup.to_string_lossy(),
        "bytes":before_len,
        "fingerprint_fnv1a64":before_hash,
        "fingerprint_algorithm":"fnv1a64_noncryptographic_change_detector",
        "request_id":request_id,"expected_project_revision":revision,
        "source_fingerprint":{"bytes":before_len,"fnv1a64":before_hash},
        "checkpoint_scope":"saved_project_file_bytes_only",
        "unsaved_host_edits_preserved":false,
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
    validate_path(expected_source)?;
    validate_source(backup)?;
    if backup.parent()!=Some(backup_dir(expected_source)?.as_path())||backup==expected_source{
        return Err("Checkpoint must be a distinct file in the original project's Shuvi Backups folder.".into());
    }
    if !backup.is_absolute(){return Err("After Effects checkpoint verification requires absolute path.".into());}
    let ext=backup.extension().and_then(|v|v.to_str()).unwrap_or("");
    if !matches!(ext.to_ascii_lowercase().as_str(),"aep"|"aepx"){return Err("Invalid After Effects checkpoint extension.".into());}
    let metadata=backup.with_extension(format!("{ext}.checkpoint.json"));
    reject_links(&metadata)?;
    if !fs::symlink_metadata(&metadata).map_err(|e|e.to_string())?.is_file(){return Err("Checkpoint metadata must be a regular file.".into());}
    let raw=crate::read_file_bytes_bounded(&metadata,16*1024,"After Effects checkpoint metadata")?;
    let receipt:serde_json::Value=serde_json::from_slice(&raw).map_err(|_|"Invalid After Effects checkpoint metadata.")?;
    let schema=receipt.get("schema_version").and_then(serde_json::Value::as_u64);
    if !matches!(schema,Some(1)|Some(2)){return Err("Unsupported After Effects checkpoint metadata.".into());}
    let expected_backup=receipt.get("backup_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint backup path missing.")?;
    let expected_source_text=receipt.get("source_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint source path missing.")?;
    if Path::new(expected_backup)!=backup || Path::new(expected_source_text)!=expected_source{
        return Err("After Effects checkpoint path binding changed.".into());
    }
    let bytes=receipt.get("bytes").and_then(serde_json::Value::as_u64).ok_or("Checkpoint byte count missing.")?;
    let hash=receipt.get("fingerprint_fnv1a64").and_then(serde_json::Value::as_str).ok_or("Checkpoint fingerprint missing.")?;
    let id=receipt.get("checkpoint_id").and_then(serde_json::Value::as_str).ok_or("Checkpoint ID missing.")?;
    if id.len()!=32||Uuid::parse_str(id).is_err(){return Err("Checkpoint ID is invalid.".into());}
    let timestamp=receipt.get("created_at_ms").and_then(serde_json::Value::as_u64).ok_or("Checkpoint timestamp missing.")?;
    let stem=expected_source.file_stem().and_then(|v|v.to_str()).ok_or("Invalid source project stem.")?;
    let expected_name=format!("{stem}.shuvi-{timestamp}-{id}.{ext}");
    if backup.file_name().and_then(|v|v.to_str())!=Some(expected_name.as_str()){
        return Err("Checkpoint ID/timestamp filename binding changed.".into());
    }
    if bytes==0||bytes>MAX_PROJECT_BYTES||hash.len()!=16||!hash.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Checkpoint fingerprint/size metadata is invalid.".into());
    }
    if schema==Some(2)&&(receipt["source_fingerprint"]["bytes"].as_u64()!=Some(bytes)
        ||receipt["source_fingerprint"]["fnv1a64"].as_str()!=Some(hash)){
        return Err("Checkpoint source fingerprint binding changed.".into());
    }
    let before=fs::symlink_metadata(backup).map_err(|e|e.to_string())?;
    if before.len()!=bytes || fnv1a(backup)?!=hash{
        return Err("After Effects checkpoint content no longer matches creation receipt.".into());
    }
    let after=fs::symlink_metadata(backup).map_err(|e|e.to_string())?;
    if after.len()!=before.len()||after.modified().ok()!=before.modified().ok(){return Err("Checkpoint changed while verifying.".into());}
    let request_id=receipt.get("request_id").and_then(serde_json::Value::as_str);
    if request_id.is_some_and(|id|id.is_empty()||id.len()>80||!id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')){
        return Err("Invalid checkpoint request binding.".into());
    }
    let revision=receipt.get("expected_project_revision").and_then(serde_json::Value::as_u64);
    if schema==Some(2)&&request_id.is_some()&&revision.is_none_or(|v|v==0){return Err("Checkpoint revision binding missing.".into());}
    Ok(json!({"verified":true,"backup_path":backup,"source_path":expected_source,"bytes":bytes,"fingerprint_fnv1a64":hash,
        "created_at_ms":timestamp,"checkpoint_id":id,"request_id":request_id,"expected_project_revision":revision,
        "job_binding_verified":schema==Some(2)&&request_id.is_some(),"source_exists":expected_source.exists(),
        "fingerprint_algorithm":"fnv1a64_noncryptographic_change_detector","unsaved_host_edits_preserved":false,
        "recovery_of_host_state_verified":false}))
}

pub fn recovery_plan(backup:&Path,expected_source:&Path,expected_request_id:Option<&str>)->Result<serde_json::Value,String>{
    let checkpoint=verify(backup,expected_source)?;
    if let Some(id)=expected_request_id{
        if checkpoint["job_binding_verified"]!=true||checkpoint["request_id"].as_str()!=Some(id){
            return Err("Checkpoint does not belong to the expected request ID.".into());
        }
    }
    Ok(json!({"checkpoint":checkpoint,"plan_verified":true,"recovery_target":expected_source,
        "open_candidate":backup,"automatic_restore_performed":false,"project_opened_automatically":false,
        "requires_user_approval_before_restore":true,"active_project_overwrite_allowed":false,
        "steps":["Preserve current active project separately before recovery.","Approve opening this exact verified backup as a separate project.",
            "Inspect recovered host state and unsaved-edit gaps.","Choose a separate Save As path explicitly; preserve the original project."],
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
    #[test]fn checkpoint_retention_fails_closed_without_deleting_old_backups(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-checkpoint-retention-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source=root.join("edit.aep");fs::write(&source,b"project").unwrap();
        let backups=root.join("Shuvi Backups");fs::create_dir_all(&backups).unwrap();
        for i in 0..MAX_CHECKPOINTS_PER_PROJECT{
            fs::write(backups.join(format!("edit.shuvi-{i}-x.aep")),b"old").unwrap();
        }
        assert!(create(&source,999).unwrap_err().contains("retention limit"));
        assert_eq!(fs::read_dir(&backups).unwrap().count(),MAX_CHECKPOINTS_PER_PROJECT);
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
    #[test]fn recovery_plan_binds_job_and_supports_missing_original_without_restoration(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-recovery-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();let source=root.join("edit.aep");fs::write(&source,b"saved state").unwrap();
        let receipt=create_for_request(&source,456,"mutation-1",5).unwrap();
        let backup=PathBuf::from(receipt["backup_path"].as_str().unwrap());
        fs::remove_file(&source).unwrap();
        let plan=recovery_plan(&backup,&source,Some("mutation-1")).unwrap();
        assert_eq!(plan["checkpoint"]["job_binding_verified"],true);
        assert_eq!(plan["checkpoint"]["source_exists"],false);
        assert_eq!(plan["automatic_restore_performed"],false);
        assert_eq!(plan["requires_user_approval_before_restore"],true);
        assert_eq!(plan["checkpoint"]["unsaved_host_edits_preserved"],false);
        assert!(!source.exists());assert!(recovery_plan(&backup,&source,Some("other-job")).is_err());
        let metadata=backup.with_extension("aep.checkpoint.json");
        let mut tampered=receipt.clone();tampered["created_at_ms"]=json!(457);
        fs::write(&metadata,serde_json::to_vec(&tampered).unwrap()).unwrap();
        assert!(verify(&backup,&source).is_err());
        let _=fs::remove_dir_all(root);
    }
    #[cfg(unix)]
    #[test]fn recovery_rejects_symlink_backup_and_sidecar(){
        use std::os::unix::fs::symlink;
        let root=std::env::temp_dir().join(format!("shuvi-ae-recovery-link-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();let source=root.join("edit.aep");fs::write(&source,b"saved").unwrap();
        let receipt=create(&source,1).unwrap();let backup=PathBuf::from(receipt["backup_path"].as_str().unwrap());
        fs::remove_file(&backup).unwrap();symlink(&source,&backup).unwrap();
        assert!(verify(&backup,&source).is_err());let _=fs::remove_dir_all(root);
    }
}
