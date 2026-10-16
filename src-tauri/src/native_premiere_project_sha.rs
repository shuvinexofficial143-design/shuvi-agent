//! Independent read-only SHA-256 on an already owner-approved, audited
//! Premiere create_project output. Does NOT execute Adobe tools or certify
//! reopen, timeline content, owner final delivery, or creative success.
//! Installed native Project.createProject lives on Team 40's separate branch.
use serde::Serialize;
use sha2::{Digest,Sha256};
use std::{fs::{self,File},io::Read,path::{Component,Path},time::SystemTime};
use tauri::AppHandle;

const MAX_PROJECT_BYTES:u64=256*1024*1024;
const BUFFER:usize=64*1024;

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ProjectShaReceipt {
    pub action_id:String,
    pub project_path:String,
    pub bytes:u64,
    pub sha256:String,
    pub fnv1a64:String,
    pub verified_file_bytes:bool,
    pub reopen_verified:bool,
    pub original_goal_verified:bool,
}

fn valid_path(path:&str)->Result<&Path,String>{
    if path.trim()!=path||path.len()<9||path.len()>4096||
        path.chars().any(char::is_control)||path.contains('|'){
        return Err("Project proof requires a bounded clean file path.".into());
    }
    let file=Path::new(path);
    if !file.is_absolute()||
        !file.extension().and_then(|x|x.to_str())
           .is_some_and(|x|x.eq_ignore_ascii_case("prproj"))||
        file.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)){
        return Err("Project proof requires an absolute .prproj with no traversal.".into());
    }
    let parent=file.parent().ok_or("No project parent directory.")?;
    let mut cursor=std::path::PathBuf::new();
    for component in parent.components(){
        cursor.push(component.as_os_str());
        if !cursor.is_absolute(){continue;}
        let m=fs::symlink_metadata(&cursor)
            .map_err(|_|"Project parent metadata unavailable.".to_string())?;
        if !m.is_dir()||m.file_type().is_symlink(){
            return Err("A project parent cannot be a symlink or file.".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0{
                return Err("Windows reparse-point directory is forbidden.".into());
            }
        }
    }
    Ok(file)
}
fn check_file(meta:&fs::Metadata)->Result<(),String>{
    if !meta.is_file()||meta.file_type().is_symlink()||
       meta.len()==0||meta.len()>MAX_PROJECT_BYTES{
        return Err("Project must be a nonempty regular non-link .prproj <=256 MiB.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0{
            return Err("Windows reparse-point project file is forbidden.".into());
        }
    }
    Ok(())
}
fn matching_metadata(before:&fs::Metadata,after:&fs::Metadata)->bool{
    before.len()==after.len()&&
    before.modified().ok()==after.modified().ok()
}
fn fingerprint(path:&Path)->Result<(u64,String,String),String>{
    let before=fs::symlink_metadata(path)
        .map_err(|_|"Project file does not exist.".to_string())?;
    check_file(&before)?;
    let mut f=File::open(path).map_err(|_|"Project unreadable.".to_string())?;
    let handle=f.metadata().map_err(|_|"Opened project metadata unavailable.".to_string())?;
    check_file(&handle)?;
    if !matching_metadata(&before,&handle){
        return Err("Project changed before file proof read.".into());
    }
    let mut buffer=[0u8;BUFFER];
    let mut sha=Sha256::new();let mut fnv:u64=0xcbf29ce484222325;
    let mut bytes=0u64;
    loop{
        let n=f.read(&mut buffer)
            .map_err(|_|"Project read failed during cryptographic proof.".to_string())?;
        if n==0{break;}
        bytes=bytes.checked_add(n as u64).ok_or("Project size overflow.")?;
        if bytes>MAX_PROJECT_BYTES{return Err("Project proof size exceeded.".into());}
        sha.update(&buffer[..n]);
        for byte in &buffer[..n]{
            fnv^=*byte as u64;
            fnv=fnv.wrapping_mul(0x100000001b3);
        }
    }
    let after=fs::symlink_metadata(path)
        .map_err(|_|"Project disappeared during SHA-256.".to_string())?;
    check_file(&after)?;
    if bytes!=before.len()||!matching_metadata(&before,&after){
        return Err("Project changed while hashing; SHA-256 not accepted.".into());
    }
    Ok((bytes,format!("{:x}",sha.finalize()),format!("{fnv:016x}")))
}

fn confirmed_create_audit(tool:&str,event:&str,success:bool,
    detail:&str,path:&str)->Result<(),String>{
    if tool!="premiere_create_project"||event!="executed"||!success{
        return Err("No successful audited native Premiere project-create action.".into());
    }
    // Team 40's HIGH-risk prepare text contains the exact approved path.
    // Never search for arbitrary substrings: another file name inside the
    // explanation is not an approved project destination.
    let expected=format!(
        "Create a NEW Adobe Premiere project and save the .prproj at {path}. Existing targets may never be overwritten. Verify active host identity and independent disk bytes. No auto retry."
    );
    if detail!=expected{
        return Err("Previous high-risk approval did not bind this exact .prproj path.".into());
    }
    Ok(())
}

pub(crate) fn verify(
    app:&AppHandle,action_id:&str,path:&str,
    expected_fnv1a64:&str,expected_size_bytes:u64
)->Result<ProjectShaReceipt,String>{
    if uuid::Uuid::parse_str(action_id).map(|id|id.to_string()!=action_id).unwrap_or(true){
        return Err("Exact native action UUID required.".into());
    }
    let valid=valid_path(path)?;
    if expected_fnv1a64.len()!=16||
        !expected_fnv1a64.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))||
        expected_size_bytes==0||expected_size_bytes>MAX_PROJECT_BYTES{
        return Err("Previous native project fingerprint is invalid.".into());
    }
    let receipt=crate::read_action_audit_receipt(app,action_id)?
        .ok_or("No audited Premiere project-create action exists.")?;
    confirmed_create_audit(&receipt.tool,&receipt.event,receipt.success,
        &receipt.detail,path)?;
    let schedule=crate::native_scheduler::verified_status(app)?
        .ok_or("No durable native scheduler can bind this project to the task.")?;
    if !schedule.jobs.iter().any(|j|
        j.action_id.as_deref()==Some(action_id)&&j.tool=="premiere_create_project"&&
        j.phase=="audited"){
        return Err("The native scheduler lacks the exact audited Premiere creation job.".into());
    }
    let (bytes,sha256,fnv1a64)=fingerprint(valid)?;
    if bytes!=expected_size_bytes||fnv1a64!=expected_fnv1a64{
        return Err("Disk project no longer matches the native host/disk creation result.".into());
    }
    Ok(ProjectShaReceipt{
        action_id:action_id.into(),project_path:path.into(),bytes,sha256,fnv1a64,
        verified_file_bytes:true,reopen_verified:false,original_goal_verified:false
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::fs;
    fn fixture(name:&str)->(std::path::PathBuf,std::path::PathBuf){
        let dir=std::env::temp_dir().join(format!("shuvi37-sha-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();(dir.clone(),dir.join(name))
    }
    #[test]
    fn approved_exact_action_and_path_binding(){
        let path=r"C:\Projects\Example.prproj";
        let approved=format!("Create a NEW Adobe Premiere project and save the .prproj at {path}. Existing targets may never be overwritten. Verify active host identity and independent disk bytes. No auto retry.");
        assert!(confirmed_create_audit("premiere_create_project","executed",true,&approved,path).is_ok());
        assert!(confirmed_create_audit("premiere_create_project","executed",true,&approved,r"C:\Projects\Other.prproj").is_err());
        assert!(confirmed_create_audit("premiere_create_project","denied",false,&approved,path).is_err());
        assert!(confirmed_create_audit("premiere_open_project","executed",true,&approved,path).is_err());
        assert!(confirmed_create_audit("premiere_create_project","executed",true,"looks like approved",path).is_err());
    }
    #[test]
    fn independently_hashes_exact_bytes_and_detects_changes(){
        let (dir,file)=fixture("test.prproj");
        fs::write(&file,b"actual Premiere project fixture").unwrap();
        let (len,sha,fnv)=fingerprint(&file).unwrap();
        assert_eq!(len,31);
        assert_eq!(sha,format!("{:x}",Sha256::digest(b"actual Premiere project fixture")));
        assert_eq!(fnv.len(),16);
        fs::write(&file,b"different bytes").unwrap();
        let (_,changed_sha,changed_fnv)=fingerprint(&file).unwrap();
        assert_ne!(sha,changed_sha);
        assert_ne!(fnv,changed_fnv);
        fs::remove_file(&file).unwrap();fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn missing_empty_and_symlinked_output_refused(){
        let (dir,file)=fixture("missing.prproj");
        assert!(fingerprint(&file).is_err());
        fs::write(&file,b"").unwrap();
        assert!(fingerprint(&file).is_err());
        #[cfg(unix)]
        {
            let alias=dir.join("alias.prproj");
            std::os::unix::fs::symlink(&file,&alias).unwrap();
            assert!(fingerprint(&alias).is_err());
            fs::remove_file(alias).unwrap();
        }
        fs::remove_file(&file).unwrap();fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn parent_links_and_non_prproj_refused(){
        let (dir,file)=fixture("valid.prproj");
        fs::write(&file,b"fixture").unwrap();
        assert!(valid_path(file.to_str().unwrap()).is_ok());
        assert!(valid_path(dir.join("wrong.mp4").to_str().unwrap()).is_err());
        assert!(valid_path(dir.join("..").join("valid.prproj").to_str().unwrap()).is_err());
        #[cfg(unix)]
        {
            let link=dir.with_extension("alias");
            std::os::unix::fs::symlink(&dir,&link).unwrap();
            assert!(valid_path(link.join("valid.prproj").to_str().unwrap()).is_err());
            fs::remove_file(link).unwrap();
        }
        fs::remove_file(&file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
