//! A22: durable provider-reported token usage for successful text responses.
//! NOT a receipt from billing, monetary price reconciliation or invoice proof.
#[cfg(windows)]
use std::{fs::OpenOptions,io::{Read,Seek,SeekFrom,Write},os::windows::fs::OpenOptionsExt,path::PathBuf,time::{SystemTime,UNIX_EPOCH}};
use serde_json::{Value,json};
use sha2::{Sha256,Digest};
const MAX_RECORD_BYTES:usize=2048;
const MAX_LEDGER_BYTES:usize=64*1024;
const MAX_RECORDS:usize=64;
#[cfg(windows)]
fn path()->Result<PathBuf,String>{
    let attempt=super::daily_journal_path()?;
    let dir=attempt.parent().ok_or("A22 usage-receipt folder unavailable.")?;
    let day=attempt.file_name().and_then(|x|x.to_str())
        .and_then(|s|s.strip_prefix("paid-ai-attempts-utc-"))
        .ok_or("A22 usage-receipt UTC day missing.")?;
    Ok(dir.join(format!("paid-ai-provider-usage-utc-{day}.jsonl")))
}
fn create_receipt(provider:&str,model:&str,endpoint:Option<&str>,reported:Option<(u64,u64,u64)>,utc_secs:u64)->Result<Vec<u8>,String>{
    if provider.is_empty()||provider.len()>32||model.is_empty()||model.len()>256
        ||provider.chars().any(char::is_control)||model.chars().any(char::is_control){
        return Err("A22 usage receipt has invalid provider/model identity.".into());
    }
    let (status,input,output,total)=match reported{
        Some((input,output,total)) if input>0||output>0||total>0 =>
            (if input.checked_add(output).is_some_and(|sum|sum<=total){"provider_reported"}else{"provider_usage_inconsistent"},Some(input),Some(output),Some(total)),
        Some((input,output,total))=>("provider_usage_unverified",Some(input),Some(output),Some(total)),
        None=>("provider_usage_missing",None,None,None)
    };
    // Hash potentially private custom endpoints; never persist API keys, prompts or responses.
    let endpoint_sha256=endpoint.map(|text|format!("{:x}",Sha256::digest(text.as_bytes())));
    let receipt=json!({
        "v":1,"utc_seconds":utc_secs,"provider":provider,"model":model,
        "endpoint_sha256":endpoint_sha256,"status":status,
        "input_tokens":input,"output_tokens":output,"total_tokens":total,
        "usd_billed":Value::Null,
    });
    let mut line=serde_json::to_vec(&receipt).map_err(|_|"A22 receipt JSON serialization failed.")?;
    line.push(b'\n');
    if line.len()>MAX_RECORD_BYTES{return Err("A22 provider usage receipt exceeds allowed size.".into());}
    Ok(line)
}
fn count_prior_receipts(data:&[u8])->Result<usize,String>{
    if data.is_empty(){return Ok(0);}
    if *data.last().unwrap()!=b'\n'{return Err("A22 reported usage journal has an incomplete line.".into());}
    let mut count=0;
    for row in data.split_inclusive(|v|*v==b'\n'){
        if row.len()>MAX_RECORD_BYTES{return Err("A22 reported usage journal has oversized line.".into());}
        let val:Value=serde_json::from_slice(&row[..row.len()-1])
            .map_err(|_|"A22 reported usage journal contains malformed JSON.")?;
        validate_receipt(&val)?;
        count+=1;
        if count>MAX_RECORDS{return Err("A22 reported usage journal exceeds entry limit.".into());}
    }
    Ok(count)
}
fn validate_receipt(val:&Value)->Result<(),String>{
    let invalid=||"A22 reported usage journal contains an invalid record.".to_string();
    let fields=["v","utc_seconds","provider","model","endpoint_sha256","status",
        "input_tokens","output_tokens","total_tokens","usd_billed"];
    let obj=val.as_object().ok_or_else(invalid)?;
    if obj.len()!=fields.len()||fields.iter().any(|field|!obj.contains_key(*field))
        ||val["v"].as_u64()!=Some(1)||!val["usd_billed"].is_null(){return Err(invalid());}
    let utc=val["utc_seconds"].as_u64().ok_or_else(invalid)?;
    let provider=val["provider"].as_str().ok_or_else(invalid)?;
    let model=val["model"].as_str().ok_or_else(invalid)?;
    if !val["endpoint_sha256"].is_null(){
        let hash=val["endpoint_sha256"].as_str().ok_or_else(invalid)?;
        if hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
            return Err(invalid());
        }
    }
    let reported=if ["input_tokens","output_tokens","total_tokens"].iter().all(|f|val[*f].is_null()){
        None
    }else{
        Some((val["input_tokens"].as_u64().ok_or_else(invalid)?,
            val["output_tokens"].as_u64().ok_or_else(invalid)?,
            val["total_tokens"].as_u64().ok_or_else(invalid)?))
    };
    // Derive the only valid usage status from the counts, applying the same
    // identity validation as newly written records. Unknown failures have no counts.
    let expected:Value=serde_json::from_slice(&create_receipt(provider,model,None,reported,utc)?)
        .map_err(|_|invalid())?;
    if val["status"]=="request_failed_or_unknown"{
        if reported.is_some(){return Err(invalid());}
    }else if val["status"]!=expected["status"]{return Err(invalid());}
    Ok(())
}
// Validate the complete prior journal and leave headroom for one new receipt
// BEFORE admitting a paid HTTP request. A later crash or concurrent process can
// still make the actual outcome uncertain; this is not billing reconciliation.
fn ensure_room_for_receipt(data:&[u8])->Result<(),String>{
    let count=count_prior_receipts(data)?;
    if count>=MAX_RECORDS||data.len().saturating_add(MAX_RECORD_BYTES)>MAX_LEDGER_BYTES{
        return Err("A22 provider usage journal is full; paid request blocked before dispatch.".into());
    }
    Ok(())
}
#[cfg(windows)]
pub(super) fn preflight_journal()->Result<(),String>{
    let out=path()?;
    super::verify_journal_file_candidate(&out)?;
    // Create the empty journal here to verify permissions rather than
    // discovering an unwritable directory only after an API was billed.
    let mut f=OpenOptions::new().read(true).append(true).create(true)
        .share_mode(0).custom_flags(super::OPEN_REPARSE_POINT).open(&out)
        .map_err(|e|format!("A22 usage journal cannot be opened before paid dispatch: {e}"))?;
    let meta=f.metadata().map_err(|e|format!("A22 preflight journal metadata failed: {e}"))?;
    if !meta.is_file()||super::has_windows_reparse(&meta){
        return Err("A22 usage journal preflight detected a redirected file.".into());
    }
    if meta.len()>MAX_LEDGER_BYTES as u64{
        return Err("A22 usage journal preflight detected oversized data.".into());
    }
    f.seek(SeekFrom::Start(0))
        .map_err(|e|format!("A22 usage journal preflight seek failed: {e}"))?;
    let mut bytes=Vec::new();
    (&mut f).take((MAX_LEDGER_BYTES+1) as u64).read_to_end(&mut bytes)
        .map_err(|e|format!("A22 usage journal preflight read failed: {e}"))?;
    if bytes.len()>MAX_LEDGER_BYTES{
        return Err("A22 usage journal preflight detected oversized data.".into());
    }
    ensure_room_for_receipt(&bytes)?;
    // Fail before a paid request if storage cannot be synchronized.
    f.sync_all().map_err(|e|format!("A22 usage journal preflight sync failed: {e}"))?;
    Ok(())
}
#[cfg(windows)]
pub(super) fn append_receipt(provider:&str,model:&str,endpoint:Option<&str>,reported:Option<(u64,u64,u64)>)->Result<(),String>{
    append_outcome(provider,model,endpoint,reported,false)
}
// Adapter errors include transport timeouts, rejected responses and parse failures.
// None proves that the provider did not bill; never release the USD reservation.
fn create_unknown_receipt(provider:&str,model:&str,endpoint:Option<&str>,utc:u64)->Result<Vec<u8>,String>{
    let line=create_receipt(provider,model,endpoint,None,utc)?;
    let mut value:Value=serde_json::from_slice(&line).map_err(|_|"A22 outcome serialization failed.")?;
    value["status"]=json!("request_failed_or_unknown");
    let mut line=serde_json::to_vec(&value).map_err(|_|"A22 outcome serialization failed.")?;
    line.push(b'\n');
    if line.len()>MAX_RECORD_BYTES{return Err("A22 outcome receipt exceeds allowed size.".into());}
    Ok(line)
}
#[cfg(windows)]
pub(super) fn append_unknown_outcome(provider:&str,model:&str,endpoint:Option<&str>)->Result<(),String>{
    append_outcome(provider,model,endpoint,None,true)
}
#[cfg(windows)]
fn append_outcome(provider:&str,model:&str,endpoint:Option<&str>,reported:Option<(u64,u64,u64)>,unknown:bool)->Result<(),String>{
    let out=path()?;
    super::verify_journal_file_candidate(&out)?;
    let utc=SystemTime::now().duration_since(UNIX_EPOCH)
       .map_err(|_|"A22 provider usage system time invalid.")?.as_secs();
    let line=if unknown {create_unknown_receipt(provider,model,endpoint,utc)?}
        else {create_receipt(provider,model,endpoint,reported,utc)?};
    // Serialize writes from all Shuvi processes. Fail closed if another instance
    // owns the journal or a reparse point is swapped in.
    let mut f=OpenOptions::new().read(true).append(true).create(true)
        .share_mode(0).custom_flags(super::OPEN_REPARSE_POINT).open(&out)
        .map_err(|e|format!("A22 provider usage journal inaccessible: {e}"))?;
    let meta=f.metadata().map_err(|e|format!("A22 usage journal metadata failed: {e}"))?;
    if !meta.is_file()||super::has_windows_reparse(&meta){
        return Err("A22 provider usage journal was redirected.".into());
    }
    if meta.len()>MAX_LEDGER_BYTES as u64{return Err("A22 provider usage journal already exceeds size limit.".into());}
    // Append handles need an explicit rewind before validating existing data;
    // never treat the EOF position as an empty journal.
    f.seek(SeekFrom::Start(0)).map_err(|e|format!("A22 provider usage journal rewind failed: {e}"))?;
    let mut bytes=Vec::new();
    (&mut f).take((MAX_LEDGER_BYTES+1) as u64).read_to_end(&mut bytes)
        .map_err(|e|format!("A22 provider usage journal read failed: {e}"))?;
    let count=count_prior_receipts(&bytes)?;
    if count>=MAX_RECORDS||bytes.len().saturating_add(line.len())>MAX_LEDGER_BYTES{
        return Err("A22 provider usage journal is full; do not silently discard usage.".into());
    }
    f.write_all(&line).map_err(|e|format!("A22 usage receipt append failed: {e}"))?;
    f.sync_all().map_err(|e|format!("A22 usage receipt fsync failed: {e}"))?;
    Ok(())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn preflight_rejects_corrupt_full_and_exhausted_receipt_journals(){
        assert!(ensure_room_for_receipt(b"").is_ok());
        let record=create_receipt("openai","test",None,Some((2,1,3)),42).unwrap();
        assert!(ensure_room_for_receipt(&record).is_ok());
        assert!(ensure_room_for_receipt(&record[..record.len()-1]).is_err());
        let mut full=Vec::new();
        for _ in 0..MAX_RECORDS {full.extend_from_slice(&record);}
        assert!(ensure_room_for_receipt(&full).is_err());
        assert!(ensure_room_for_receipt(b"{}\\n").is_err());
    }
    #[test] fn failed_requests_keep_billing_and_tokens_unknown(){
        let bytes=create_unknown_receipt("custom","model",Some("https://private.test/v1?key=secret"),22).unwrap();
        let value:Value=serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["status"],"request_failed_or_unknown");
        for field in ["usd_billed","input_tokens","output_tokens","total_tokens"]{
            assert!(value[field].is_null(),"{field} must not imply zero usage");
        }
        assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
        assert_eq!(count_prior_receipts(&bytes).unwrap(),1);
        assert!(create_unknown_receipt("","model",None,22).is_err());
    }
    #[test] fn successful_and_missing_usage_are_distinct_and_nonmonetary(){
        let ok=create_receipt("openrouter","model",Some("https://example.test/v1"),Some((300,80,380)),10).unwrap();
        let row:Value=serde_json::from_slice(&ok).unwrap();
        assert_eq!(row["status"],"provider_reported");
        assert_eq!(row["input_tokens"],300);
        assert!(row["usd_billed"].is_null());
        assert!(row.get("endpoint").is_none());
        assert!(row["endpoint_sha256"].as_str().is_some());
        let missing=create_receipt("openai","model",None,None,11).unwrap();
        let value:Value=serde_json::from_slice(&missing).unwrap();
        assert_eq!(value["status"],"provider_usage_missing");
        assert!(value["input_tokens"].is_null());
        let zero=create_receipt("gemini","model",None,Some((0,0,0)),12).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&zero).unwrap()["status"],"provider_usage_unverified");
    }
    #[test]fn detects_corruption_and_prevents_silent_receipt_loss(){
        let good=create_receipt("anthropic","model",None,Some((2,1,3)),21).unwrap();
        assert_eq!(count_prior_receipts(&good).unwrap(),1);
        assert!(count_prior_receipts(&good[..good.len()-1]).is_err());
        assert!(count_prior_receipts(b"{}\n").is_err());
        assert!(count_prior_receipts(b"not json\n").is_err());
        let mut second=good.clone();second.extend_from_slice(&good);
        assert_eq!(count_prior_receipts(&second).unwrap(),2);
    }
    #[test] fn rejects_semantically_corrupted_receipts(){
        let good:Value=serde_json::from_slice(&create_receipt("openai","model",None,Some((2,1,3)),21).unwrap()).unwrap();
        for (field,bad) in [
            ("status",json!("invented")),("status",json!("request_failed_or_unknown")),
            ("input_tokens",json!(-1)),("output_tokens",Value::Null),
            ("total_tokens",json!(0)),("usd_billed",json!(0)),
            ("provider",json!("")),("model",json!("bad\nmodel")),
            ("endpoint_sha256",json!("not-a-hash")),("utc_seconds",json!(-1)),
        ]{
            let mut bad_row=good.clone();bad_row[field]=bad;
            assert!(validate_receipt(&bad_row).is_err(),"accepted corrupt {field}");
        }
        for field in good.as_object().unwrap().keys(){
            let mut missing=good.clone();missing.as_object_mut().unwrap().remove(field);
            assert!(validate_receipt(&missing).is_err(),"accepted missing {field}");
        }
        let mut extra=good.clone();extra["raw_error"]=json!("private");
        assert!(validate_receipt(&extra).is_err());
        assert!(validate_receipt(&good).is_ok());
    }
}
