//! A22: durable provider-reported token usage for successful text responses.
//! NOT a receipt from billing, monetary price reconciliation or invoice proof.
use std::{fs::OpenOptions,io::{Read,Seek,SeekFrom,Write},os::windows::fs::OpenOptionsExt,path::PathBuf,time::{SystemTime,UNIX_EPOCH}};
use serde_json::{Value,json};
use sha2::{Sha256,Digest};
const MAX_RECORD_BYTES:usize=2048;
const MAX_LEDGER_BYTES:usize=64*1024;
const MAX_RECORDS:usize=64;
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
        if val.get("v").and_then(Value::as_u64)!=Some(1)
          || val.get("status").and_then(Value::as_str).is_none()
          || val.get("utc_seconds").and_then(Value::as_u64).is_none()
          || val.get("provider").and_then(Value::as_str).is_none()
          || val.get("model").and_then(Value::as_str).is_none(){
            return Err("A22 reported usage journal contains an invalid record.".into());
        }
        count+=1;
        if count>MAX_RECORDS{return Err("A22 reported usage journal exceeds entry limit.".into());}
    }
    Ok(count)
}
pub(super) fn append_receipt(provider:&str,model:&str,endpoint:Option<&str>,reported:Option<(u64,u64,u64)>)->Result<(),String>{
    let out=path()?;
    super::verify_journal_file_candidate(&out)?;
    let utc=SystemTime::now().duration_since(UNIX_EPOCH)
       .map_err(|_|"A22 provider usage system time invalid.")?.as_secs();
    let line=create_receipt(provider,model,endpoint,reported,utc)?;
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
}
