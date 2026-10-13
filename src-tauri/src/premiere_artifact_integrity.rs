//! SHA-256 proof for an already approved Premiere media insertion.
//! The source pathname is not locked against external writers; both checks
//! protect the decision and result, not a hypothetical atomic Adobe import.
use sha2::{Digest,Sha256};
use std::fs::{self,File};
use std::io::Read;
use std::path::Path;
const MAX_VERIFIED_MEDIA_BYTES:u64=2*1024*1024*1024;
const BUF_SIZE:usize=64*1024;

pub fn validate_expected(expected:Option<&str>)->Result<Option<String>,String>{
    let Some(value)=expected else{return Ok(None)};
    if value.len()!=64||!value.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Native artifact expected_sha256 must be exactly 64 hexadecimal characters.".into());
    }
    Ok(Some(value.to_ascii_lowercase()))
}

pub fn verify_expected(path:&str,expected:Option<&str>)->Result<Option<String>,String>{
    let expected=validate_expected(expected)?;
    let Some(expected)=expected else {return Ok(None)};
    let input=Path::new(path);
    if !input.is_absolute(){return Err("Verified Premiere media path must be absolute.".into());}
    // Reject the named symlink before opening, and reject a replaced/symlinked
    // file on the final metadata check. An external-writer race is still possible.
    let before=fs::symlink_metadata(input)
        .map_err(|e|format!("Cannot stat approved Premiere artifact before import: {e}"))?;
    if !before.file_type().is_file()||before.file_type().is_symlink()
        ||before.len()==0||before.len()>MAX_VERIFIED_MEDIA_BYTES{
        return Err("Approved Premiere artifact is not a bounded regular file.".into());
    }
    let mut file=File::open(input)
        .map_err(|e|format!("Cannot reopen approved Premiere artifact: {e}"))?;
    let opened=file.metadata()
        .map_err(|e|format!("Cannot inspect opened Premiere artifact: {e}"))?;
    if !opened.is_file()||opened.len()!=before.len(){
        return Err("Premiere artifact changed while it was opened.".into());
    }
    let mut digest=Sha256::new();
    let mut buf=[0u8;BUF_SIZE];
    let mut total=0u64;
    loop{
        let n=file.read(&mut buf)
            .map_err(|e|format!("Cannot hash approved Premiere artifact: {e}"))?;
        if n==0{break;}
        total=total.checked_add(n as u64)
            .ok_or("Premiere artifact length overflow.")?;
        if total>MAX_VERIFIED_MEDIA_BYTES{return Err("Premiere artifact exceeds native verification budget.".into());}
        digest.update(&buf[..n]);
    }
    let after=fs::symlink_metadata(input)
        .map_err(|e|format!("Approved Premiere artifact disappeared during hashing: {e}"))?;
    if !after.file_type().is_file()||after.file_type().is_symlink()
        ||total!=before.len()||after.len()!=before.len(){
        return Err("Approved Premiere artifact changed during hash verification.".into());
    }
    let observed=format!("{:x}",digest.finalize());
    if observed!=expected{
        return Err("Premiere artifact SHA-256 differs from the approved worker receipt; import blocked.".into());
    }
    Ok(Some(observed))
}


/// Batch SHA-256 evidence is strictly parallel to the ordered list of media
/// paths. Mixing verified/unverified entries, extra hashes, or repeated paths
/// is never permitted in an attested import.
pub fn validate_expected_batch(paths:&[String],expected:Option<&[String]>)->Result<Option<Vec<String>>,String>{
    let Some(values)=expected else{return Ok(None)};
    if paths.is_empty()||paths.len()>100||paths.len()!=values.len(){
        return Err("Batch Premiere source paths and expected_sha256 values must have equal nonzero lengths (maximum 100).".into());
    }
    let mut seen=std::collections::HashSet::new();
    let mut normalized=Vec::with_capacity(values.len());
    for (path,value) in paths.iter().zip(values){
        // Case-folding avoids duplicate spellings of Windows drive paths.
        if !seen.insert(path.to_lowercase()){
            return Err("An approved batch cannot repeat a media path.".into());
        }
        normalized.push(validate_expected(Some(value))?
            .ok_or("Every attested batch source requires SHA-256 evidence.")?);
    }
    Ok(Some(normalized))
}
pub fn verify_expected_batch(paths:&[String],expected:Option<&[String]>)->Result<Option<Vec<String>>,String>{
    let hashes=validate_expected_batch(paths,expected)?;
    let Some(hashes)=hashes else {return Ok(None)};
    let mut observed=Vec::with_capacity(hashes.len());
    for (index,(path,hash)) in paths.iter().zip(hashes.iter()).enumerate(){
        // Do not leak a private filesystem path into verification failure text.
        let checked=verify_expected(path,Some(hash)).map_err(|e|format!(
            "Premiere batch artifact {index} could not be verified: {e}"))?;
        observed.push(checked.ok_or("Bounded batch SHA-256 verification did not run.")?);
    }
    Ok(Some(observed))
}
#[cfg(test)]
mod tests{
    use super::*;
    use uuid::Uuid;
    fn temp_file()->std::path::PathBuf{
        let path=std::env::temp_dir().join(format!("shuvi-artifact-{}.png",Uuid::new_v4()));
        fs::write(&path,b"blender-test-png").unwrap();
        path
    }
    #[test]
    fn matching_hash_passes_and_changed_bytes_fail_closed(){
        let file=temp_file();
        let path=file.to_str().unwrap();
        let expected=format!("{:x}",Sha256::digest(b"blender-test-png"));
        assert_eq!(verify_expected(path,Some(&expected)).unwrap(),Some(expected.clone()));
        assert_eq!(verify_expected(path,Some(&expected.to_ascii_uppercase())).unwrap(),Some(expected.clone()));
        fs::write(&file,b"blender-TEST-png").unwrap();
        assert!(verify_expected(path,Some(&expected)).unwrap_err().contains("differs"));
        fs::remove_file(file).unwrap();
    }
    #[test]
    fn unbound_ordinary_media_is_unchanged_and_fake_hashes_are_rejected(){
        let f=temp_file();let path=f.to_str().unwrap();
        assert!(verify_expected(path,None).unwrap().is_none());
        assert!(validate_expected(Some("not-a-hash")).is_err());
        assert!(validate_expected(Some(&"z".repeat(64))).is_err());
        assert!(validate_expected(Some(&"a".repeat(65))).is_err());
        fs::remove_file(f).unwrap();
    }
    #[test]
    fn missing_empty_or_oversized_sources_never_pass_attestation(){
        let path=std::env::temp_dir().join(format!("shuvi-empty-{}",Uuid::new_v4()));
        let name=path.to_str().unwrap();
        let hash="a".repeat(64);
        assert!(verify_expected(name,Some(&hash)).is_err());
        fs::write(&path,[]).unwrap();
        assert!(verify_expected(name,Some(&hash)).is_err());
        let f=File::create(&path).unwrap();
        f.set_len(MAX_VERIFIED_MEDIA_BYTES+1).unwrap();
        drop(f);
        assert!(verify_expected(name,Some(&hash)).is_err());
        fs::remove_file(path).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn source_symlinks_are_rejected(){
        let source=temp_file();
        let link=std::env::temp_dir().join(format!("shuvi-source-link-{}",Uuid::new_v4()));
        std::os::unix::fs::symlink(&source,&link).unwrap();
        assert!(verify_expected(link.to_str().unwrap(),Some(&"a".repeat(64))).is_err());
        fs::remove_file(link).unwrap();fs::remove_file(source).unwrap();
    }
    #[test]
    fn approved_batch_hashes_reverify_every_ordered_path(){
        let first=temp_file();let second=temp_file();
        let paths=vec![first.to_string_lossy().to_string(),second.to_string_lossy().to_string()];
        let good=format!("{:x}",Sha256::digest(b"blender-test-png"));
        let hashes=vec![good.clone(),good.clone()];
        assert_eq!(verify_expected_batch(&paths,Some(&hashes)).unwrap(),Some(hashes.clone()));
        fs::write(&second,b"modified-blender-file").unwrap();
        assert!(verify_expected_batch(&paths,Some(&hashes)).unwrap_err().contains("artifact 1"));
        fs::remove_file(first).unwrap();fs::remove_file(second).unwrap();
    }
    #[test]
    fn batch_attestation_refuses_missing_extra_bad_or_duplicate_hashes(){
        let paths=vec!["C:\\media\\one.png".to_string(),"C:\\media\\two.png".to_string()];
        let hash="a".repeat(64);
        assert!(validate_expected_batch(&paths,Some(&[hash.clone()])).is_err());
        assert!(validate_expected_batch(&paths,Some(&[hash.clone(),hash.clone(),hash.clone()])).is_err());
        assert!(validate_expected_batch(&paths,Some(&[hash.clone(),"bad".into()])).is_err());
        assert!(validate_expected_batch(&[paths[0].clone(),paths[0].to_ascii_uppercase()],
            Some(&[hash.clone(),hash])).is_err());
        assert_eq!(validate_expected_batch(&paths,None).unwrap(),None);
    }

}
