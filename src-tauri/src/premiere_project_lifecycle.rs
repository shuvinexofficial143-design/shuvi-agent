//! Safe bounded project creation/open preflight and independent disk readback.
 //! Adobe UXP host acceptance is never a substitute for a persisted .prproj.
use crate::premiere_project_persistence::{self,ProjectFileFingerprint};
use serde_json::{json,Value};
use std::{fs,path::{Component,Path}};

fn no_directory_links(path:&Path)->Result<(),String>{
    let mut cursor=std::path::PathBuf::new();
    for component in path.components(){
        if matches!(component,Component::CurDir|Component::ParentDir){
            return Err("Premiere project paths may not contain dot traversal.".into());
        }
        cursor.push(component.as_os_str());
        // Reject a redirecting parent (including Windows junctions) so a
        // previously approved output directory cannot silently change target.
        let meta=fs::symlink_metadata(&cursor)
            .map_err(|e|format!("Premiere project directory component unavailable: {e}"))?;
        if !meta.is_dir()||meta.file_type().is_symlink(){
            return Err("Premiere project directory must be a real directory without links.".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("Premiere project directory contains a Windows reparse point.".into());
            }
        }
    }
    Ok(())
}
fn checked(path:&str)->Result<&Path,String>{
    if path.len()<9||path.len()>4096||path.trim()!=path
        ||path.chars().any(|c|c.is_control()){
        return Err("Premiere project path is empty, malformed, or oversized.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute()||
       !p.extension().and_then(|s|s.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("prproj")){
        return Err("Premiere project requires an absolute .prproj path.".into());
    }
    if p.components().any(|c|matches!(c,Component::CurDir|Component::ParentDir)){
        return Err("Premiere project paths may not contain dot traversal.".into());
    }
    let parent=p.parent().ok_or("Premiere project must have a parent directory.")?;
    no_directory_links(parent)?;
    Ok(p)
}
pub fn preflight_create(path:&str)->Result<(),String>{
    let p=checked(path)?;
    match fs::symlink_metadata(p){
        Ok(_)=>Err("Premiere create cannot overwrite an existing file, directory or symbolic link.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),
        Err(e)=>Err(format!("Cannot check Premiere destination before creation: {e}"))
    }
}
pub fn preflight_open(path:&str)->Result<ProjectFileFingerprint,String>{
    let p=checked(path)?;
    let m=fs::symlink_metadata(p).map_err(|e|format!("Premiere project not found: {e}"))?;
    if !m.is_file()||m.file_type().is_symlink(){
        return Err("Premiere open requires an existing regular non-symlink .prproj.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Premiere project is a reparse point.".into());
        }
    }
    premiere_project_persistence::fingerprint(path)
}
pub fn assess_create(path:&str,host:&Value)->Value{
    let host_verified=host.get("projectIdentityVerified").and_then(Value::as_bool)==Some(true)
        &&host.get("initialSaveAccepted").and_then(Value::as_bool)==Some(true)
        &&host.get("operation").and_then(Value::as_str)==Some("create")
        &&host.get("uncertain").and_then(Value::as_bool)==Some(false)
        &&host.get("projectPath").and_then(Value::as_str).is_some_and(|p|p.eq_ignore_ascii_case(path))
        &&host.get("activePath").and_then(Value::as_str).is_some_and(|p|p.eq_ignore_ascii_case(path));
    let disk=preflight_open(path);
    let disk_verified=disk.is_ok();
    let verified=host_verified&&disk_verified;
    json!({"operation":"create","host_identity_verified":host_verified,
        "disk_persistence_verified":disk_verified,"project_verified":verified,
        "disk_fingerprint":disk.as_ref().ok(),
        "disk_error":disk.as_ref().err(),"edit_semantics_verified":false,
        "reopen_verified":false,"retry_safe":false,
        "note":"New non-overwriting .prproj was independently read after Adobe accepted the initial save. Reopen and actual media edits require separate host evidence."})
}
pub fn assess_open(path:&str,before:&ProjectFileFingerprint,host:&Value)->Value{
    let host_verified=host.get("projectIdentityVerified").and_then(Value::as_bool)==Some(true)
        &&host.get("operation").and_then(Value::as_str)==Some("open")
        &&host.get("uncertain").and_then(Value::as_bool)==Some(false)
        &&host.get("projectPath").and_then(Value::as_str).is_some_and(|p|p.eq_ignore_ascii_case(path))
        &&host.get("activePath").and_then(Value::as_str).is_some_and(|p|p.eq_ignore_ascii_case(path));
    let disk=preflight_open(path);
    let unchanged=disk.as_ref().is_ok_and(|after|
        after.path==before.path&&after.size_bytes==before.size_bytes
            &&after.fnv1a64==before.fnv1a64);
    let verified=host_verified&&unchanged;
    json!({"operation":"open","host_identity_verified":host_verified,
        "disk_unchanged_during_open":unchanged,"project_verified":verified,
        "disk_fingerprint":disk.as_ref().ok(),"disk_error":disk.as_ref().err(),
        "edit_semantics_verified":false,"retry_safe":false,
        "note":"Premiere opened the exact project identity and independently fingerprinted disk bytes remained unchanged. No save, overwrite or timeline editing was requested."})
}
#[cfg(test)]
mod tests {
    use super::*;
    fn project(name:&str)->(std::path::PathBuf,String){
        let dir=std::env::temp_dir().join(format!("shuvi40-project-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file=dir.join(name);let path=file.to_str().unwrap().to_string();
        (dir,path)
    }
    #[test] fn create_rejects_existing_project_without_overwrite(){
        let (dir,path)=project("test.prproj");
        preflight_create(&path).unwrap();
        fs::write(&path,b"existing user project").unwrap();
        assert!(preflight_create(&path).unwrap_err().contains("cannot overwrite"));
        fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test] fn open_requires_nonempty_existing_project_and_matching_host_identity(){
        let (dir,path)=project("existing.prproj");
        assert!(preflight_open(&path).is_err());
        fs::write(&path,b"nonempty project fixture").unwrap();
        let before=preflight_open(&path).unwrap();
        let good=json!({"operation":"open","projectIdentityVerified":true,"uncertain":false,
            "projectPath":path,"activePath":path});
        assert_eq!(assess_open(&path,&before,&good)["project_verified"],true);
        fs::write(&path,b"changed unexpectedly").unwrap();
        assert_eq!(assess_open(&path,&before,&good)["project_verified"],false);
        fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test] fn create_requires_host_initial_save_and_actual_disk_file(){
        let (dir,path)=project("new.prproj");
        let good=json!({"operation":"create","projectIdentityVerified":true,"uncertain":false,
            "initialSaveAccepted":true,"projectPath":path,"activePath":path});
        assert_eq!(assess_create(&path,&good)["project_verified"],false);
        fs::write(&path,b"new project fixture").unwrap();
        assert_eq!(assess_create(&path,&good)["project_verified"],true);
        let rejected=json!({"operation":"create","projectIdentityVerified":true,"uncertain":false,
            "initialSaveAccepted":false,"projectPath":path,"activePath":path});
        assert_eq!(assess_create(&path,&rejected)["project_verified"],false);
        fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();
    }
}
