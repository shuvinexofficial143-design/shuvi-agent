//! Local native audit binding for successful Blender action receipts.
//! This checks app-data evidence, NOT a cryptographic attestation of the OS.
use serde_json::Value;
use sha2::{Digest,Sha256};
use uuid::Uuid;

fn valid_sha(s:&str)->Result<&str,String>{
    if s.len()!=64 || !s.bytes().all(|b|b.is_ascii_hexdigit() && !b.is_ascii_uppercase()){
        return Err("Blender audit SHA-256 is invalid.".into());
    }
    Ok(s)
}
fn valid_uuid(s:&str)->Result<&str,String>{
    if Uuid::parse_str(s).map_err(|_|"Blender audit UUID invalid.")?.to_string()!=s{
        return Err("Blender audit UUID not canonical.".into());
    }
    Ok(s)
}
fn field<'a>(value:&'a Value,path:&str)->Result<&'a str,String>{
    value.pointer(path).and_then(Value::as_str)
        .ok_or_else(||format!("Blender audit field missing: {path}"))
}
fn path_hash(s:&str)->String{format!("{:x}",Sha256::digest(s.as_bytes()))}

/// Deterministic native receipt suffix. Do not leak absolute paths to audit.
pub(crate) fn suffix(receipt:&Value)->Result<String,String>{
    if receipt.get("status").and_then(Value::as_str)!=Some("verified"){
        return Err("Only verified Blender results are auditable.".into());
    }
    let action=valid_uuid(field(receipt,"/source_action_id")?)?;
    let session=match receipt.get("session_id").filter(|v|!v.is_null()){
        Some(v)=>valid_uuid(v.as_str().ok_or("Malformed Blender session UUID.")?)?.to_owned(),
        None=>"none".into(),
    };
    let manifest=receipt.get("artifact_manifest").ok_or("Blender artifact manifest missing.")?;
    if manifest.get("source_action_id").and_then(Value::as_str)!=Some(action)
        ||manifest.get("source_session_id").and_then(Value::as_str)
            !=if session=="none"{None}else{Some(session.as_str())}{
        return Err("Blender result action/session does not match its manifest.".into());
    }
    let output=field(manifest,"/artifact/absolute_path")?;
    if !std::path::Path::new(output).is_absolute(){
        return Err("Blender audit output path is not absolute.".into());
    }
    let output_sha=valid_sha(field(manifest,"/artifact/sha256")?)?;
    let output_size=manifest.pointer("/artifact/bytes").and_then(Value::as_u64)
        .filter(|n|*n>=12&&*n<=128*1024*1024)
        .ok_or("Blender audit output length missing or invalid.")?;
    let input=receipt.get("input_checkpoint").unwrap_or(&Value::Null);
    let (input_sha,input_path_hash,input_size)=if input.is_null(){
        ("none".into(),"none".into(),"none".into())
    }else{
        if input.get("verified_loaded_file_path").and_then(Value::as_bool)!=Some(true)
            ||input.get("loaded_file_hash_checked").and_then(Value::as_bool)!=Some(true){
            return Err("Blender input checkpoint is not verified.".into());
        }
        let path=field(input,"/path")?;
        if !std::path::Path::new(path).is_absolute(){
            return Err("Blender source path is not absolute.".into());
        }
        let hash=valid_sha(field(input,"/sha256")?)?;
        let size=input.get("bytes").and_then(Value::as_u64)
            .filter(|n|*n>=12&&*n<=128*1024*1024)
            .ok_or("Blender source size invalid.")?;
        (hash.into(),path_hash(path),size.to_string())
    };
    Ok(format!(
        "blender_action_receipt_v1 | blender_output_sha256={output_sha} \
        | blender_output_path_sha256={} | blender_output_bytes={output_size} \
        | blender_session_id={session} | blender_input_sha256={input_sha} \
        | blender_input_path_sha256={input_path_hash} | blender_input_bytes={input_size}",
        path_hash(output)
    ))
}
pub(crate) fn append(base:&str,receipt:&Value)->String{
    match suffix(receipt){
        Ok(data)=>format!("{base} | {data}"),
        Err(_)=>format!("{base} | blender_action_receipt_unavailable"),
    }
}
pub(crate) fn verify_detail(detail:&str,receipt:&Value)->Result<(),String>{
    let expected=format!(" | {}",suffix(receipt)?);
    if !detail.ends_with(&expected){
        return Err("Local successful Blender audit does not bind exact output and input evidence.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    const ACTION:&str="a9847404-2887-48c4-ab30-a2da3ce68cc9";
    const SESSION:&str="de968532-22df-491a-81ce-a6063a7cf117";
    fn temp_file(name:&str)->String {
        std::env::temp_dir().join(name).to_str().unwrap().into()
    }
    fn fixture()->Value{
        json!({"status":"verified","source_action_id":ACTION,"session_id":SESSION,
            "artifact_manifest":{"source_action_id":ACTION,"source_session_id":SESSION,
                "artifact":{"absolute_path":temp_file("shuvi-proof-stage2.blend"),
                    "sha256":"a".repeat(64),"bytes":123}},
            "input_checkpoint":null})
    }
    #[test]
    fn exact_audit_suffix_binds_success_to_output_and_session(){
        let r=fixture();let line=append("approved action",&r);
        assert!(verify_detail(&line,&r).is_ok());
        let mut changed=r.clone();
        changed["artifact_manifest"]["artifact"]["sha256"]=json!("b".repeat(64));
        assert!(verify_detail(&line,&changed).is_err());
        changed=r.clone();
        changed["session_id"]=json!("7c8c34a5-4557-42cb-aaf7-84809bf62833");
        assert!(verify_detail(&line,&changed).is_err());
    }
    #[test]
    fn suffix_must_be_exact_end_not_substring_of_preparation(){
        let r=fixture();let token=suffix(&r).unwrap();
        assert!(verify_detail(&format!("prepared | {token} | unrelated"),&r).is_err());
        assert!(verify_detail(&format!("approved | {token}"),&r).is_ok());
    }
    #[test]
    fn input_path_hash_byte_length_and_digest_are_bound(){
        let mut r=fixture();
        r["input_checkpoint"]=json!({"path":temp_file("shuvi-stage1.blend"),
            "sha256":"f".repeat(64),"bytes":123,
            "verified_loaded_file_path":true,"loaded_file_hash_checked":true});
        let audit=append("approved",&r);
        assert!(verify_detail(&audit,&r).is_ok());
        r["input_checkpoint"]["sha256"]=json!("e".repeat(64));
        assert!(verify_detail(&audit,&r).is_err());
        r["input_checkpoint"]["sha256"]=json!("f".repeat(64));
        r["input_checkpoint"]["path"]=json!(temp_file("other.blend"));
        assert!(verify_detail(&audit,&r).is_err());
        r["input_checkpoint"]["path"]=json!(temp_file("shuvi-stage1.blend"));
        r["input_checkpoint"]["bytes"]=json!(124);
        assert!(verify_detail(&audit,&r).is_err());
    }
    #[test]
    fn forged_malformed_receipts_are_denied(){
        let mut r=fixture();
        r["source_action_id"]=json!("invalid");
        assert!(suffix(&r).is_err());
        r=fixture();r["artifact_manifest"]["artifact"]["absolute_path"]=json!("relative.blend");
        assert!(suffix(&r).is_err());
        r=fixture();r["artifact_manifest"]["source_session_id"]=json!("different");
        assert!(suffix(&r).is_err());
    }
}
