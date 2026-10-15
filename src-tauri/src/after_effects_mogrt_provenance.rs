//! Bridge an actually received After Effects export_mogrt result to Premiere.
 //! Local AE workspace evidence is not signed or immutable. We verify the
 //! exact matching receipt bytes and exported artifact again at consumption.
use crate::{after_effects_transport::{Request,Receipt},premiere_mogrt_handoff};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};

const MAX_PROOF_BYTES:usize=8192;
const MAX_RECEIPT_BYTES:u64=512*1024;
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proof{
    pub schema_version:u8,
    pub request_id:String,
    pub expected_project_file:String,
    pub output_file:String,
    pub output_sha256:String,
    pub output_size_bytes:u64,
    pub receipt_sha256:String,
    pub host_verification_status:String,
    pub host_version:Option<String>,
    pub created_at_ms:u64,
}
fn valid_id(s:&str)->bool{
    !s.is_empty()&&s.len()<=80&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
}
fn checked_small_file(path:&Path,max:u64)->Result<Vec<u8>,String>{
    let meta=fs::symlink_metadata(path).map_err(|e|format!("AE handoff file inaccessible: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.len()==0||meta.len()>max{
        return Err("AE handoff requires a bounded nonempty regular non-symlink file.".into());
    }
    #[cfg(windows)]{
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes()&0x400!=0{return Err("AE handoff file is a Windows reparse point.".into());}
    }
    let mut bytes=Vec::with_capacity(meta.len() as usize);
    File::open(path).map_err(|e|e.to_string())?.take(max+1)
        .read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len() as u64!=meta.len(){return Err("AE handoff file changed while reading.".into());}
    let after=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if after.len()!=meta.len()||after.modified().ok()!=meta.modified().ok(){
        return Err("AE handoff file changed during inspection.".into());
    }
    Ok(bytes)
}
fn hash(data:&[u8])->String{format!("{:x}",Sha256::digest(data))}
fn receipt_file(directory:&Path,id:&str)->PathBuf{directory.join(format!("shuvi-ae-{id}.receipt.json"))}
fn proof_file(directory:&Path,id:&str)->PathBuf{directory.join(format!("shuvi-ae-{id}.mogrt-provenance.json"))}
fn parse_export_receipt(raw:&[u8],id:&str)->Result<Receipt,String>{
    let receipt:Receipt=serde_json::from_slice(raw).map_err(|_|"Invalid After Effects export receipt.")?;
    if receipt.schema_version!=1||receipt.request_id!=id||!receipt.ok||receipt.error.is_some(){
        return Err("AE receipt identity or successful export result could not be verified.".into());
    }
    let result=receipt.result.as_ref().ok_or("AE export receipt missing result.")?;
    if result.get("verification_status").and_then(Value::as_str)!=Some("verified_mogrt_file_readback"){
        return Err("AE host did not verify native MOGRT export readback.".into());
    }
    Ok(receipt)
}
pub fn publish(workspace:&Path,request:&Request,receipt:&Receipt,host_evidence:&Value,now_ms:u64)->Result<Value,String>{
    request.validate()?;
    if request.action!="export_mogrt"||!receipt.ok||receipt.request_id!=request.request_id
        ||host_evidence.get("desktop_mogrt_verified").and_then(Value::as_bool)!=Some(true) {
        return Err("No native AE export_mogrt success and desktop file proof to publish.".into());
    }
    if !valid_id(&request.request_id){return Err("Invalid AE request identity.".into());}
    if !workspace.is_absolute()||!workspace.is_dir(){return Err("AE workspace unavailable.".into());}
    let path=receipt_file(workspace,&request.request_id);
    let raw=checked_small_file(&path,MAX_RECEIPT_BYTES)?;
    let persisted=parse_export_receipt(&raw,&request.request_id)?;
    if persisted.result!=receipt.result||persisted.host_version!=receipt.host_version {
        return Err("AE live receipt differs from persisted native receipt.".into());
    }
    let result=receipt.result.as_ref().ok_or("No AE result.")?;
    let output=result.get("output_file").and_then(Value::as_str).ok_or("AE MOGRT path missing.")?;
    let expected_size=result.get("size_bytes").and_then(Value::as_u64).ok_or("AE MOGRT size missing.")?;
    let file=premiere_mogrt_handoff::inspect(output)?;
    if expected_size!=file.size_bytes||expected_size==0
        ||host_evidence.get("output_file").and_then(Value::as_str)!=Some(output)
        ||host_evidence.get("desktop_size_bytes").and_then(Value::as_u64)!=Some(expected_size){
        return Err("AE host MOGRT output metadata and actual content disagree.".into());
    }
    let project=request.expected_project_file.as_deref()
        .filter(|v|!v.is_empty()).ok_or("AE origin project path is missing.")?;
    let proof=Proof{schema_version:1,request_id:request.request_id.clone(),
        expected_project_file:project.into(),output_file:output.into(),
        output_sha256:file.sha256,output_size_bytes:file.size_bytes,
        receipt_sha256:hash(&raw),host_verification_status:"verified_mogrt_file_readback".into(),
        host_version:receipt.host_version.clone(),created_at_ms:now_ms};
    let bytes=serde_json::to_vec_pretty(&proof).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_PROOF_BYTES{return Err("AE export handoff proof exceeds limit.".into());}
    let target=proof_file(workspace,&proof.request_id);
    // Never clobber a prior request's provenance, even after an ambiguous run.
    let mut out=OpenOptions::new().write(true).create_new(true).open(&target)
        .map_err(|e|format!("AE provenance already exists or cannot be created: {e}"))?;
    out.write_all(&bytes).and_then(|_|out.sync_all())
        .map_err(|e|format!("AE provenance persist failed; inspect the exact file before retry: {e}"))?;
    let observed=verify(target.to_str().ok_or("AE proof path encoding failed.")?,
        &proof.output_file,&proof.output_sha256)?;
    Ok(json!({"proof_file":target,"ae_export_receipt_bound":true,
        "output_sha256":proof.output_sha256,"output_size_bytes":proof.output_size_bytes,
        "request_id":proof.request_id,"verification":observed,
        "immutable_origin_attestation":false,
        "note":"Native AE receipt and nonempty MOGRT bytes were observed together in the local trusted workspace. This file is unsigned, not a proof of origin against a local filesystem attacker."}))
}
pub fn verify(proof_path:&str,expected_output:&str,expected_sha256:&str)->Result<Value,String>{
    if proof_path.trim()!=proof_path||proof_path.len()>4096||!Path::new(proof_path).is_absolute(){
        return Err("AE provenance requires an exact clean absolute path.".into());
    }
    if expected_sha256.len()!=64||!expected_sha256.bytes().all(|v|v.is_ascii_hexdigit()){
        return Err("AE provenance requires the approved 64-hex MOGRT SHA256.".into());
    }
    let path=Path::new(proof_path);
    let bytes=checked_small_file(path,MAX_PROOF_BYTES as u64)?;
    let proof:Proof=serde_json::from_slice(&bytes).map_err(|_|"Invalid AE provenance document.")?;
    if proof.schema_version!=1||!valid_id(&proof.request_id)||proof.host_verification_status!="verified_mogrt_file_readback"
        ||proof.expected_project_file.is_empty()||proof.output_size_bytes==0
        ||proof.output_file!=expected_output||proof.output_sha256!=expected_sha256.to_ascii_lowercase()
        ||proof.receipt_sha256.len()!=64||!proof.receipt_sha256.bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("AE provenance document does not match approved project/export/file identity.".into());
    }
    let directory=path.parent().ok_or("AE provenance workspace unavailable.")?;
    if path.file_name().and_then(|s|s.to_str())!=proof_file(Path::new(""),&proof.request_id).file_name().and_then(|s|s.to_str()){
        return Err("AE provenance is not at the exact request-bound file name.".into());
    }
    let raw=checked_small_file(&receipt_file(directory,&proof.request_id),MAX_RECEIPT_BYTES)?;
    if hash(&raw)!=proof.receipt_sha256{return Err("After Effects export receipt bytes changed.".into());}
    let receipt=parse_export_receipt(&raw,&proof.request_id)?;
    let result=receipt.result.as_ref().ok_or("AE export receipt has no result.")?;
    if result.get("output_file").and_then(Value::as_str)!=Some(expected_output)
        ||result.get("size_bytes").and_then(Value::as_u64)!=Some(proof.output_size_bytes)
        ||receipt.host_version!=proof.host_version{
        return Err("AE export receipt does not match recorded output identity.".into());
    }
    let file=premiere_mogrt_handoff::inspect(expected_output)?;
    if file.size_bytes!=proof.output_size_bytes||file.sha256!=proof.output_sha256{
        return Err("AE MOGRT output file bytes changed since export receipt.".into());
    }
    Ok(json!({"ae_export_receipt_bound":true,"request_id":proof.request_id,
        "ae_project_file":proof.expected_project_file,"output_file":proof.output_file,
        "output_sha256":file.sha256,"output_size_bytes":file.size_bytes,
        "receipt_sha256":proof.receipt_sha256,"host_verification_status":proof.host_verification_status,
        "local_workspace_record_verified":true,"immutable_origin_attestation":false,
        "visual_template_semantics_verified":false,"premiere_insert_verified":false,
        "note":"Matching locally persisted After Effects request-bound receipt and present .mogrt bytes. Local workspace content is not signed or immutable."}))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn provenance_requires_real_receipt_and_unchanged_mogrt_bytes(){
        let root=std::env::temp_dir().join(format!("shuvi40-ae-proof-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let artifact=root.join("test.mogrt");fs::write(&artifact,b"test-mogrt").unwrap();
        let project=root.join("project.aep");fs::write(&project,b"test-aep").unwrap();
        let output=artifact.to_str().unwrap();
        let receipt=Receipt{schema_version:1,request_id:"test-1".into(),ok:true,
            host_version:Some("26.5".into()),
            result:Some(json!({"verification_status":"verified_mogrt_file_readback",
                "output_file":output,"size_bytes":10,"output_exists":true})),error:None};
        let request=Request{schema_version:1,request_id:"test-1".into(),action:"export_mogrt".into(),
            expected_project_file:Some(project.to_str().unwrap().into()),
            expected_project_revision:Some(1),args:json!({})};
        fs::write(receipt_file(&root,&request.request_id),serde_json::to_vec(&receipt).unwrap()).unwrap();
        let evidence=json!({"desktop_mogrt_verified":true,"output_file":output,"desktop_size_bytes":10});
        let proof=publish(&root,&request,&receipt,&evidence,123).unwrap();
        let filename=proof["proof_file"].as_str().unwrap();
        let hash=proof["output_sha256"].as_str().unwrap();
        assert_eq!(verify(filename,output,hash).unwrap()["ae_export_receipt_bound"],true);
        fs::write(&artifact,b"modified artifact").unwrap();
        assert!(verify(filename,output,hash).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn mismatched_receipt_identity_rejected(){
        let root=std::env::temp_dir().join(format!("shuvi40-ae-proof-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();let artifact=root.join("test.mogrt");
        fs::write(&artifact,b"test-mogrt").unwrap();let project=root.join("project.aep");fs::write(&project,b"aep").unwrap();
        let request=Request{schema_version:1,request_id:"id-1".into(),action:"export_mogrt".into(),
            expected_project_file:Some(project.to_str().unwrap().into()),expected_project_revision:Some(1),args:json!({})};
        let receipt=Receipt{schema_version:1,request_id:"other".into(),ok:true,host_version:None,
            result:Some(json!({"verification_status":"verified_mogrt_file_readback",
                "output_file":artifact.to_str().unwrap(),"size_bytes":10})),error:None};
        assert!(publish(&root,&request,&receipt,&json!({"desktop_mogrt_verified":true}),1).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
