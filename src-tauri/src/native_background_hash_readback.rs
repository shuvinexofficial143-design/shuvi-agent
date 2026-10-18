//! Independent host readback of an owned Windows SHA sidecar's limited claim.
//! No PID, exit code, heartbeat or unauthenticated JSON is an app success.
#![cfg(windows)]
use serde::Deserialize;
use sha2::{Digest,Sha256};
use std::{
    fs::{self,File,OpenOptions},io::Read,
    os::windows::fs::{MetadataExt,OpenOptionsExt},path::Path
};
const LIMIT:u64=128*1024*1024;
const RECEIPT_LIMIT:usize=512;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Evidence{
    version:u32,
    action_id:String,
    input_sha256:String,
    input_bytes:u64,
    source:String,
}
fn hash_locked(input:&Path)->Result<(u64,String),String>{
    let meta=fs::symlink_metadata(input)
        .map_err(|_|"Independent SHA input inaccessible.")?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.file_attributes()&0x400!=0
        ||meta.len()==0||meta.len()>LIMIT{
        return Err("Independent SHA input is redirected, missing or exceeds 128 MiB.".into());
    }
    // Windows READ sharing only, disallows concurrent writes/deletion and
    // remote replacement while this exact file handle is used.
    let mut file=OpenOptions::new().read(true).share_mode(1).open(input)
        .map_err(|_|"Cannot acquire independent read-only SHA identity handle.")?;
    let opened=file.metadata().map_err(|_|"Cannot inspect independent SHA file handle.")?;
    if !opened.is_file()||opened.file_attributes()&0x400!=0||opened.len()!=meta.len(){
        return Err("Independent SHA input changed before streaming.".into());
    }
    let mut total=0u64;let mut buf=[0u8;64*1024];let mut hasher=Sha256::new();
    loop{
        let n=file.read(&mut buf).map_err(|_|"Independent SHA read failed.")?;
        if n==0{break;}
        total=total.checked_add(n as u64).ok_or("SHA read byte overflow.")?;
        if total>LIMIT{return Err("Independent SHA reader exceeded file budget.".into());}
        hasher.update(&buf[..n]);
    }
    if total!=opened.len(){return Err("Independent SHA input length changed.".into());}
    Ok((total,format!("{:x}",hasher.finalize())))
}
pub(super) fn verify(
    result:&Path,id:&str,input:&Path,expected:&str
)->Result<u64,String>{
    if uuid::Uuid::parse_str(id).map(|u|u.to_string()!=id).unwrap_or(true)
       ||expected.len()!=64||!expected.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)){
        return Err("Independent SHA verification identity invalid.".into());
    }
    let meta=fs::symlink_metadata(result)
        .map_err(|_|"Owned read-only SHA evidence missing.")?;
    if !meta.is_file()||meta.file_type().is_symlink()
        ||meta.file_attributes()&0x400!=0||meta.len()==0||meta.len() as usize>RECEIPT_LIMIT{
        return Err("Owned SHA evidence has unsafe size or identity.".into());
    }
    let bytes=crate::read_file_bytes_bounded(result,RECEIPT_LIMIT,"background SHA evidence")?;
    let record:Evidence=serde_json::from_slice(&bytes)
        .map_err(|_|"Owned SHA evidence is invalid JSON.".to_string())?;
    if record.version!=1||record.action_id!=id
       ||record.input_sha256!=expected||record.source!="owned_windows_sha256_sidecar"{
        return Err("Owned SHA evidence differs from exact approved action/input.".into());
    }
    let (size,actual)=hash_locked(input)?;
    if size!=record.input_bytes||actual!=expected{
        return Err("Host independently rehashed a different SHA-256 file or size.".into());
    }
    Ok(size)
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    fn dir()->std::path::PathBuf{
        let p=std::env::temp_dir().join(format!("shuvi-bg-readback-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();p
    }
    fn evidence(dir:&Path,input:&Path,sha:&str,bytes:u64)->std::path::PathBuf{
        let r=dir.join("evidence.json");
        fs::write(&r,serde_json::json!({
            "version":1,"actionId":A,"inputSha256":sha,"inputBytes":bytes,
            "source":"owned_windows_sha256_sidecar"
        }).to_string()).unwrap();let _=input;r
    }
    #[test]
    fn host_rehashes_actual_file_and_detects_tamper_after_worker_exit(){
        let d=dir();let input=d.join("sample.bin");fs::write(&input,b"alpha").unwrap();
        let (_,sha)=hash_locked(&input).unwrap();
        let r=evidence(&d,&input,&sha,5);
        assert_eq!(verify(&r,A,&input,&sha).unwrap(),5);
        fs::write(&input,b"omega").unwrap();
        assert!(verify(&r,A,&input,&sha).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn forged_uuid_digest_or_claimed_length_cannot_pass_independent_readback(){
        let d=dir();let input=d.join("sample.bin");fs::write(&input,b"alpha").unwrap();
        let (_,sha)=hash_locked(&input).unwrap();
        let r=evidence(&d,&input,&sha,6);
        assert!(verify(&r,A,&input,&sha).is_err());
        assert!(verify(&r,"0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172",&input,&sha).is_err());
        assert!(verify(&r,A,&input,&"b".repeat(64)).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn missing_and_directory_evidence_are_never_interpreted_as_verified(){
        let d=dir();let input=d.join("sample.bin");fs::write(&input,b"alpha").unwrap();
        let (_,sha)=hash_locked(&input).unwrap();
        let result=d.join("absent.json");
        assert!(verify(&result,A,&input,&sha).is_err());
        fs::create_dir(&result).unwrap();
        assert!(verify(&result,A,&input,&sha).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
