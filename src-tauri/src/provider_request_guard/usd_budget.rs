//! A22 user-authorized per-model USD reservation ledger (not actual billing).
//! Unknown provider/model/endpoint or missing policy fails closed.
use std::{collections::HashSet,fs::{self,OpenOptions},io::{Read,Seek,SeekFrom,Write},os::windows::fs::OpenOptionsExt,path::{Path,PathBuf}};
use serde::Deserialize;
const MAX_POLICY_BYTES:usize=16384;
const MAX_MODEL_ROWS:usize=64;
const RECORD_BYTES:usize=21;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelApproval {
    provider:String,
    model:String,
    #[serde(default)]
    endpoint:Option<String>,
    reserve_usd_micros:u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    version:u32,
    daily_allowance_usd_micros:u64,
    models:Vec<ModelApproval>,
}
fn parse_policy(bytes:&[u8])->Result<Policy,String>{
    if bytes.is_empty()||bytes.len()>MAX_POLICY_BYTES {
        return Err("A22 USD approval policy missing or oversized; paid calls blocked.".into());
    }
    let p:Policy=serde_json::from_slice(bytes)
        .map_err(|_|"A22 USD policy invalid JSON/schema; paid calls blocked.".to_string())?;
    if p.version!=1||p.daily_allowance_usd_micros==0||p.daily_allowance_usd_micros>1_000_000_000
        ||p.models.is_empty()||p.models.len()>MAX_MODEL_ROWS {
        return Err("A22 USD policy invalid version, daily limit or models.".into());
    }
    let mut seen=HashSet::new();
    for m in &p.models {
        if !matches!(m.provider.as_str(),"xkiro"|"openai"|"openrouter"|"gemini"|"anthropic"|"deepseek"|"ollama"|"custom")
            ||m.model.is_empty()||m.model.len()>256||m.model.trim()!=m.model||m.model.chars().any(char::is_control)
            ||m.reserve_usd_micros==0||m.reserve_usd_micros>p.daily_allowance_usd_micros
            ||m.endpoint.as_deref().is_some_and(|e|e.is_empty()||e.len()>4096||e.trim()!=e||e.chars().any(char::is_control))
            ||(!matches!(m.provider.as_str(),"ollama"|"custom")&&m.endpoint.is_some())
            ||(m.provider=="custom"&&m.endpoint.is_none()){
            return Err("A22 USD policy has invalid model, endpoint or reservation.".into());
        }
        if !seen.insert((&m.provider,&m.model,&m.endpoint)){
            return Err("A22 USD policy contains duplicate model approvals.".into());
        }
    }
    Ok(p)
}
fn reserve_for_model(p:&Policy,provider:&str,model:&str,endpoint:Option<&str>)->Result<u64,String>{
    let actual_endpoint=if matches!(provider,"custom"|"ollama"){endpoint}else{None};
    p.models.iter().find(|m|m.provider==provider&&m.model==model&&m.endpoint.as_deref()==actual_endpoint)
        .map(|m|m.reserve_usd_micros)
        .ok_or_else(||"A22 model or endpoint has no explicit USD approval; paid call blocked.".into())
}
fn file_ok(path:&Path,allow_missing:bool)->Result<(),String>{
    match fs::symlink_metadata(path){
        Ok(meta) if meta.is_file()&&!super::has_windows_reparse(&meta)=>Ok(()),
        Ok(_)=>Err("A22 USD policy or ledger is not a normal non-reparse file.".into()),
        Err(e) if allow_missing&&e.kind()==std::io::ErrorKind::NotFound=>Ok(()),
        Err(e)=>Err(format!("A22 USD policy/ledger inaccessible, blocking paid call: {e}")),
    }
}
fn paths()->Result<(PathBuf,PathBuf),String>{
    let attempt=super::daily_journal_path()?;
    let folder=attempt.parent().ok_or("A22 budget directory unavailable.")?;
    let stamp=attempt.file_name().and_then(|v|v.to_str())
        .and_then(|v|v.strip_prefix("paid-ai-attempts-utc-"))
        .ok_or("A22 UTC day unavailable.")?;
    Ok((folder.join("paid-ai-budget-policy-v1.json"),
        folder.join(format!("paid-ai-budget-reservations-utc-{stamp}"))))
}
fn read_policy(path:&Path)->Result<Policy,String>{
    file_ok(path,false)?;
    let mut file=OpenOptions::new().read(true).share_mode(0)
        .custom_flags(super::OPEN_REPARSE_POINT).open(path)
        .map_err(|e|format!("A22 USD approval policy cannot be opened: {e}"))?;
    let meta=file.metadata().map_err(|e|format!("A22 USD policy metadata failed: {e}"))?;
    if !meta.is_file()||super::has_windows_reparse(&meta){
        return Err("A22 USD policy handle redirected; paid call blocked.".into());
    }
    let mut bytes=Vec::new();
    (&mut file).take((MAX_POLICY_BYTES+1) as u64).read_to_end(&mut bytes)
        .map_err(|e|format!("A22 USD policy read failed: {e}"))?;
    parse_policy(&bytes)
}
fn sum_reservations(bytes:&[u8])->Result<u64,String>{
    if bytes.len()%RECORD_BYTES!=0{
        return Err("A22 USD ledger has a partial record; paid calls blocked.".into());
    }
    let mut sum=0u64;
    for r in bytes.chunks_exact(RECORD_BYTES){
        if r[20]!=b'\n'||!r[..20].iter().all(u8::is_ascii_digit){
            return Err("A22 USD ledger contains invalid data; paid calls blocked.".into());
        }
        let n=std::str::from_utf8(&r[..20]).ok().and_then(|s|s.parse::<u64>().ok())
            .ok_or("A22 USD ledger contains invalid amount.")?;
        if n==0{return Err("A22 USD ledger contains zero reservation.".into());}
        sum=sum.checked_add(n).ok_or("A22 USD ledger overflow.")?;
    }
    Ok(sum)
}
// Inspect the CURRENT approved USD headroom before any attempt is counted.
// This is a preflight optimization: a concurrent process can reserve after
// the check, so the final reserve_approved_allowance remains authoritative.
fn ensure_approved_headroom(data:&[u8],amount:u64,daily_limit:u64)->Result<(),String>{
    let sum=sum_reservations(data)?;
    let projected=sum.checked_add(amount).ok_or("A22 USD reservation overflow.")?;
    if projected>daily_limit {
        return Err("A22 explicitly authorized USD daily allowance reached; paid call blocked before request admission.".into());
    }
    Ok(())
}
fn read_reservation_entries(file:&mut std::fs::File)->Result<Vec<u8>,String>{
    let meta=file.metadata().map_err(|e|format!("A22 USD ledger metadata failed: {e}"))?;
    if !meta.is_file()||super::has_windows_reparse(&meta){
        return Err("A22 USD ledger handle redirected; paid call blocked.".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|e|format!("A22 USD ledger seek failed: {e}"))?;
    let max_len=RECORD_BYTES*(super::MAX_DAILY_PAID_ATTEMPTS+1);
    let mut bytes=Vec::new();
    (&mut *file).take((max_len+1) as u64).read_to_end(&mut bytes)
        .map_err(|e|format!("A22 USD ledger read failed: {e}"))?;
    if bytes.len()>max_len{return Err("A22 USD ledger oversized; paid calls blocked.".into());}
    Ok(bytes)
}
// An approval error must be recognized before reserving any request attempts.
pub(super) fn preflight(provider:&str,model:&str,endpoint:Option<&str>)->Result<(),String>{
    let (policy_path,journal_path)=paths()?;
    let p=read_policy(&policy_path)?;
    let amount=reserve_for_model(&p,provider,model,endpoint)?;
    file_ok(&journal_path,true)?;
    // Exclusive Windows handle ensures even the preliminary read cannot
    // mistakenly treat a corrupted or concurrently edited file as headroom.
    let mut file=OpenOptions::new().read(true).append(true).create(true)
        .share_mode(0).custom_flags(super::OPEN_REPARSE_POINT).open(&journal_path)
        .map_err(|e|format!("A22 USD preflight ledger inaccessible: {e}"))?;
    let existing=read_reservation_entries(&mut file)?;
    ensure_approved_headroom(&existing,amount,p.daily_allowance_usd_micros)?;
    file.sync_all().map_err(|e|format!("A22 USD preflight ledger sync failed: {e}"))?;
    Ok(())
}
pub(super) fn reserve_approved_allowance(provider:&str,model:&str,endpoint:Option<&str>)->Result<(),String>{
    let (policy_path,journal_path)=paths()?;
    let policy=read_policy(&policy_path)?;
    let amount=reserve_for_model(&policy,provider,model,endpoint)?;
    file_ok(&journal_path,true)?;
    let mut file=OpenOptions::new().read(true).append(true).create(true)
        .share_mode(0).custom_flags(super::OPEN_REPARSE_POINT).open(&journal_path)
        .map_err(|e|format!("A22 USD reservation ledger locked/inaccessible: {e}"))?;
    let bytes=read_reservation_entries(&mut file)?;
    // Re-check under the exclusive handle: another instance may have
    // reserved between preflight and this definitive append.
    ensure_approved_headroom(&bytes,amount,policy.daily_allowance_usd_micros)?;
    file.write_all(format!("{amount:020}\n").as_bytes())
        .map_err(|e|format!("A22 USD reservation failed: {e}"))?;
    file.sync_all().map_err(|e|format!("A22 USD reservation sync failed, outcome uncertain: {e}"))?;
    Ok(())
}
// Only explicit owner approval creates a NEW A22 policy. Never replace an
// existing budget policy, reuse an absent permission, or bypass paid guards.
const TEST_DAILY_ALLOWANCE_USD_MICROS:u64=5_000_000;
#[derive(serde::Serialize)]
pub(crate) struct TestingBudgetStatus {
 pub daily_allowance_usd_micros:u64,
 pub approved_models:Vec<String>,
 pub reservation_usd_micros:Option<u64>,
}
fn trial_policy_bytes(models:&[String],reservation:u64)->Result<Vec<u8>,String>{
 if !(10_000..=1_000_000).contains(&reservation){
  return Err("Choose a per-request reservation between $0.01 and $1.00.".into());
 }
 if models.is_empty()||models.len()>MAX_MODEL_ROWS{
  return Err("Select 1-64 specific model IDs before authorizing paid requests.".into());
 }
 let mut seen=HashSet::new();
 let mut entries=Vec::new();
 for model in models {
  if model.len()>128||model.is_empty()||
     !model.bytes().all(|c|c.is_ascii_alphanumeric()||b"._:/+-".contains(&c))||
     !seen.insert(model.as_str()){
   return Err("The requested model IDs must be unique exact xKiro models.".into());
  }
  entries.push(serde_json::json!({
   "provider":"xkiro","model":model,"reserve_usd_micros":reservation
  }));
 }
 let bytes=serde_json::to_vec(&serde_json::json!({
  "version":1,"daily_allowance_usd_micros":TEST_DAILY_ALLOWANCE_USD_MICROS,
  "models":entries
 })).map_err(|_|"Could not encode owner-approved budget.")?;
 parse_policy(&bytes)?;
 Ok(bytes)
}
pub(super) fn authorize_testing_budget(models:Vec<String>,reservation:u64)->Result<TestingBudgetStatus,String>{
 let bytes=trial_policy_bytes(&models,reservation)?;
 let (policy_path,_)=paths()?;
 // Do not silently broaden or reset an existing spending authorization.
 match fs::symlink_metadata(&policy_path){
  Ok(_)=>return Err("An A22 USD policy already exists. No budget was overwritten; inspect your existing policy first.".into()),
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
  Err(e)=>return Err(format!("Cannot inspect A22 policy before saving: {e}")),
 }
 crate::atomic_file::create_new_verified(&policy_path,&bytes,"approved A22 USD testing policy")?;
 let approved=read_policy(&policy_path)?;
 Ok(TestingBudgetStatus {
  daily_allowance_usd_micros:approved.daily_allowance_usd_micros,
  approved_models:approved.models.into_iter().map(|m|m.model).collect(),
  reservation_usd_micros:Some(reservation),
 })
}
pub(super) fn testing_budget_status()->Result<Option<TestingBudgetStatus>,String>{
 let (policy_path,_)=paths()?;
 match fs::symlink_metadata(&policy_path){
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
  Err(e)=>return Err(format!("Cannot inspect A22 budget policy: {e}")),
  Ok(_)=>{},
 }
 let existing=read_policy(&policy_path)?;
 let common=existing.models.first().map(|m|m.reserve_usd_micros)
  .filter(|amount|existing.models.iter().all(|m|m.reserve_usd_micros==*amount));
 Ok(Some(TestingBudgetStatus{
  daily_allowance_usd_micros:existing.daily_allowance_usd_micros,
  approved_models:existing.models.into_iter().map(|m|m.model).collect(),
  reservation_usd_micros:common,
 }))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn trial_authorization_requires_explicit_valid_models_and_reservation(){
        assert!(trial_policy_bytes(&[],250_000).is_err());
        assert!(trial_policy_bytes(&["google/gemini-3.6-flash".into()],0).is_err());
        assert!(trial_policy_bytes(&["google/gemini-3.6-flash".into()],5_000_000).is_err());
        assert!(trial_policy_bytes(&["bad model".into()],250_000).is_err());
        assert!(trial_policy_bytes(&["same".into(),"same".into()],250_000).is_err());
        let bytes=trial_policy_bytes(&["google/gemini-3.6-flash".into(),"openai/gpt-6.1-sol".into()],250_000).unwrap();
        let p=parse_policy(&bytes).unwrap();
        assert_eq!(p.daily_allowance_usd_micros,5_000_000);
        assert_eq!(p.models.len(),2);
        assert_eq!(p.models[0].reserve_usd_micros,250_000);
        assert_eq!(reserve_for_model(&p,"xkiro","openai/gpt-6.1-sol",None).unwrap(),250_000);
        assert!(reserve_for_model(&p,"xkiro","unapproved",None).is_err());
    }

    fn sample()->Policy {
        parse_policy(br#"{"version":1,"daily_allowance_usd_micros":5000000,"models":[{"provider":"openrouter","model":"test","reserve_usd_micros":1000000},{"provider":"custom","model":"xkiro-test","endpoint":"https://example.test/v1","reserve_usd_micros":2000000}]}"#).unwrap()
    }
    #[test]fn exact_model_and_endpoint_required(){
        let p=sample();
        assert_eq!(reserve_for_model(&p,"openrouter","test",None).unwrap(),1000000);
        assert!(reserve_for_model(&p,"openrouter","other",None).is_err());
        assert_eq!(reserve_for_model(&p,"custom","xkiro-test",Some("https://example.test/v1")).unwrap(),2000000);
        assert!(reserve_for_model(&p,"custom","xkiro-test",Some("https://different.test/v1")).is_err());
    }
    #[test]fn invalid_policies_fail_closed(){
        for value in [
            r#"{"version":2,"daily_allowance_usd_micros":5,"models":[{"provider":"openai","model":"a","reserve_usd_micros":1}]}"#,
            r#"{"version":1,"daily_allowance_usd_micros":0,"models":[{"provider":"openai","model":"a","reserve_usd_micros":1}]}"#,
            r#"{"version":1,"daily_allowance_usd_micros":5,"models":[{"provider":"openai","model":"a","reserve_usd_micros":0}]}"#,
            r#"{"version":1,"daily_allowance_usd_micros":5,"models":[{"provider":"openai","model":"a","reserve_usd_micros":6}]}"#,
            r#"{"version":1,"daily_allowance_usd_micros":5,"models":[{"provider":"custom","model":"a","reserve_usd_micros":1}]}"#
        ]{assert!(parse_policy(value.as_bytes()).is_err());}
    }
    #[test]fn exhausted_allowance_is_detected_without_mutating_attempts(){
        let policy=sample();
        let amount=reserve_for_model(&policy,"openrouter","test",None).unwrap();
        assert!(ensure_approved_headroom(b"",amount,policy.daily_allowance_usd_micros).is_ok());
        let four=b"00000000000001000000\n".repeat(4);
        assert!(ensure_approved_headroom(&four,amount,policy.daily_allowance_usd_micros).is_ok());
        let five=b"00000000000001000000\n".repeat(5);
        assert!(ensure_approved_headroom(&five,amount,policy.daily_allowance_usd_micros).is_err());
        assert!(ensure_approved_headroom(b"broken",amount,policy.daily_allowance_usd_micros).is_err());
        assert!(ensure_approved_headroom(&four,u64::MAX,policy.daily_allowance_usd_micros).is_err());
    }
    #[test]fn reservations_reject_corruption(){
        assert_eq!(sum_reservations(b"").unwrap(),0);
        assert_eq!(sum_reservations(b"00000000000001000000\n").unwrap(),1000000);
        assert!(sum_reservations(b"00000000000001000000").is_err());
        assert!(sum_reservations(b"00000000000000000000\n").is_err());
        assert!(sum_reservations(b"0000000000000100000x\n").is_err());
    }
}
