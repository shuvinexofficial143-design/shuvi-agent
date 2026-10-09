//! A22 conservative billable-attempt guard with a durable daily Windows ledger.
//! NOT a USD budget or a guarantee about provider pricing/actual credits.
use std::sync::atomic::{AtomicUsize,Ordering};
use reqwest::Url;

#[cfg(windows)]
mod usd_budget;
#[cfg(windows)]
mod reported_usage;

#[cfg(windows)]
use std::{
    fs::{self,File,OpenOptions},
    io::{Read,Seek,SeekFrom,Write},
    os::windows::fs::{MetadataExt,OpenOptionsExt},
    path::{Path,PathBuf},
    time::{SystemTime,UNIX_EPOCH},
};
pub(crate) const MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME:usize=48;
static PAID_ATTEMPTS:AtomicUsize=AtomicUsize::new(0);
const MAX_DAILY_PAID_ATTEMPTS:usize=48;

#[cfg(windows)]
const OPEN_REPARSE_POINT:u32=0x0020_0000; // Windows FILE_FLAG_OPEN_REPARSE_POINT

fn is_metered(provider:&str,base_url:Option<&str>)->bool{
    if provider!="ollama"{return true;}
    match base_url{
        None=>false,
        Some(value)=>Url::parse(value)
            .map(|url|!super::url_host_is_loopback(&url))
            .unwrap_or(true),
    }
}
fn reserve(counter:&AtomicUsize,limit:usize)->Result<(),String>{
    counter.fetch_update(Ordering::AcqRel,Ordering::Acquire,|current|{
        if current>=limit{None}else{current.checked_add(1)}
    }).map_err(|_|format!(
        "Shuvi paid AI request safety limit ({limit} per runtime) reached. Inspect provider billing before continuing. Restart resets the limit; this is NOT a USD or daily budget."
    ))?;
    Ok(())
}
// Each record is a fixed two-byte append-only event. Partial writes fail
// closed instead of silently resetting the counter or ignoring ambiguity.
fn read_attempt_count(journal:&[u8],limit:usize)->Result<usize,String>{
    if journal.len()%2!=0
        || journal.chunks_exact(2).any(|record|record!=b"1\n".as_slice()){
        return Err("Paid AI usage journal has an invalid or partial record; stop and inspect it before any further billable request.".into());
    }
    let count=journal.len()/2;
    if count>=limit{
        return Err(format!("Daily Shuvi paid AI attempt limit ({limit}) reached; inspect actual provider billing and try another UTC day. This is NOT a dollar budget."));
    }
    Ok(count)
}

#[cfg(windows)]
fn has_windows_reparse(meta:&fs::Metadata)->bool{
    meta.file_attributes()&0x400!=0||meta.is_symlink()
}

#[cfg(windows)]
fn daily_journal_path()->Result<PathBuf,String>{
    let base=std::env::var_os("LOCALAPPDATA")
        .filter(|entry|!entry.is_empty())
        .ok_or_else(||"Windows LOCALAPPDATA is unavailable: paid AI calls are blocked.".to_string())?;
    let base=PathBuf::from(base);
    let parent_meta=fs::symlink_metadata(&base)
        .map_err(|error|format!("Cannot inspect paid AI journal parent: {error}"))?;
    if !parent_meta.is_dir()||has_windows_reparse(&parent_meta){
        return Err("Paid AI journal parent cannot be a symlink or Windows junction.".into());
    }
    let folder=base.join("Shuvi");
    fs::create_dir_all(&folder)
        .map_err(|error|format!("Cannot create paid AI journal directory: {error}"))?;
    let folder_meta=fs::symlink_metadata(&folder)
        .map_err(|error|format!("Cannot inspect paid AI journal directory: {error}"))?;
    if !folder_meta.is_dir()||has_windows_reparse(&folder_meta){
        return Err("Paid AI journal directory cannot be a symlink or junction.".into());
    }
    let day=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|"System time is invalid; paid model usage cannot be reserved.".to_string())?
        .as_secs()/86_400;
    Ok(folder.join(format!("paid-ai-attempts-utc-{day}.log")))
}

#[cfg(windows)]
fn verify_journal_file_candidate(path:&Path)->Result<(),String>{
    match fs::symlink_metadata(path){
        Ok(meta) if meta.is_file() && !has_windows_reparse(&meta)=>Ok(()),
        Ok(_)=>Err("Paid AI usage journal is not a regular unlinked file.".into()),
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()),
        Err(error)=>Err(format!("Cannot inspect paid AI usage journal safely: {error}")),
    }
}

#[cfg(windows)]
fn reserve_durable_daily_attempt()->Result<(),String>{
    let path=daily_journal_path()?;
    verify_journal_file_candidate(&path)?;
    // Exclusive Windows share ownership serializes all Shuvi instances
    // belonging to this local user profile; contention FAILS CLOSED.
    let mut journal=OpenOptions::new().read(true).append(true).create(true)
        // A22: do not follow a symlink swapped in after metadata inspection.
        .custom_flags(OPEN_REPARSE_POINT).share_mode(0).open(&path)
        .map_err(|error|format!("Cannot reserve a billable AI attempt (another Shuvi instance or inaccessible journal): {error}"))?;
    let meta=journal.metadata()
        .map_err(|error|format!("Cannot verify billable AI journal: {error}"))?;
    if !meta.is_file()||has_windows_reparse(&meta){
        return Err("Paid AI journal handle is not a verified regular file.".into());
    }
    let max_size=(MAX_DAILY_PAID_ATTEMPTS+1)*2;
    journal.seek(SeekFrom::Start(0)).map_err(|error|format!("Cannot seek billable AI journal: {error}"))?;
    let mut data=Vec::new();
    (&mut journal).take((max_size+1) as u64).read_to_end(&mut data)
        .map_err(|error|format!("Cannot read billable AI journal: {error}"))?;
    if data.len()>max_size{
        return Err("Paid AI journal exceeds its expected bounds; inspect before any more paid requests.".into());
    }
    read_attempt_count(&data,MAX_DAILY_PAID_ATTEMPTS)?;
    // fsync happens BEFORE the API request; a failed sync blocks that call.
    journal.write_all(b"1\n")
        .map_err(|error|format!("Cannot append paid AI attempt: {error}"))?;
    journal.sync_all()
        .map_err(|error|format!("Paid AI attempt sync failed; external budget state is uncertain: {error}"))?;
    Ok(())
}

pub(crate) fn claim_paid_attempt(provider:&str,model:&str,base_url:Option<&str>)->Result<(),String>{
    if !is_metered(provider,base_url){
        // Local loopback Ollama does not contact a metered AI service.
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        // A22: the persisted cross-process paid-attempt journal only exists on
        // Windows. Do not silently fall back to a restart-resettable in-memory
        // counter on Linux/macOS for billable or remote endpoints.
        return Err("Metered AI requests are blocked on non-Windows runtimes until a durable cross-process spending journal is available. Local loopback Ollama remains supported.".into());
    }
    #[cfg(windows)]
    {
        // A22: unknown/missing USD model approval must not consume the
        // daily paid-request attempt journal merely to report a policy error.
        usd_budget::preflight(provider,model,base_url)?;
        reserve(&PAID_ATTEMPTS,MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME)?;
        reserve_durable_daily_attempt()?;
        // Reserve a user-approved USD allowance before a potentially billable call.
        usd_budget::reserve_approved_allowance(provider,model,base_url)?;
        Ok(())
    }
}
// Persist only actual token counts returned by the provider. No price
// estimates are invented, and missing metadata is recorded as unknown.
pub(crate) fn record_provider_unknown_outcome(provider:&str,model:&str,base_url:Option<&str>)->Result<(),String>{
    if !is_metered(provider,base_url){return Ok(());}
    #[cfg(windows)]
    { reported_usage::append_unknown_outcome(provider,model,base_url) }
    #[cfg(not(windows))]
    {
        let _=model;
        Err("Metered AI outcome receipts require Windows durable storage; paid calls remain blocked.".into())
    }
}

pub(crate) fn record_provider_reported_usage(
    provider:&str,model:&str,base_url:Option<&str>,
    reported:Option<(u64,u64,u64)>
)->Result<(),String>{
    if !is_metered(provider,base_url){return Ok(());}
    #[cfg(windows)]
    { reported_usage::append_receipt(provider,model,base_url,reported) }
    #[cfg(not(windows))]
    {
        let _=(model,reported);
        Err("Metered AI usage receipts require Windows durable storage; paid calls remain blocked.".into())
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn provider_accounting_is_fail_closed(){
        assert!(is_metered("openrouter",None));
        assert!(is_metered("custom",Some("http://localhost:3000")));
        assert!(!is_metered("ollama",None));
        assert!(!is_metered("ollama",Some("http://127.0.0.1:11434")));
        assert!(is_metered("ollama",Some("https://paid.example/v1")));
        assert!(is_metered("ollama",Some("invalid-url")));
    }
    #[test] fn unmetered_local_ollama_is_allowed_without_touching_paid_usage(){
        assert!(claim_paid_attempt("ollama","local",None).is_ok());
        assert!(claim_paid_attempt("ollama","local",Some("http://127.0.0.1:11434")).is_ok());
    }
    #[cfg(not(windows))]
    #[test] fn metered_endpoints_are_rejected_without_durable_usage_journal(){
        let error=claim_paid_attempt("openrouter","test-model",None).expect_err("remote paid provider must fail closed");
        assert!(error.contains("non-Windows"));
        assert!(claim_paid_attempt("ollama","test-model",Some("https://remote.example/v1")).is_err());
        assert!(claim_paid_attempt("custom","test-model",Some("http://localhost:3000")).is_err());
    }
    #[test] fn rejects_after_limit_without_extra_increment(){
        let v=AtomicUsize::new(0);
        assert!(reserve(&v,2).is_ok());assert!(reserve(&v,2).is_ok());
        assert!(reserve(&v,2).is_err());assert_eq!(v.load(Ordering::Acquire),2);
    }
    #[test] fn concurrently_enforces_same_runtime_limit(){
        use std::sync::Arc;
        let v=Arc::new(AtomicUsize::new(0));
        let mut handles=Vec::new();
        for _ in 0..20{
            let state=Arc::clone(&v);
            handles.push(std::thread::spawn(move||reserve(&state,4).is_ok()));
        }
        assert_eq!(handles.into_iter().map(|h|h.join().unwrap()).filter(|ok|*ok).count(),4);
        assert_eq!(v.load(Ordering::Acquire),4);
    }
    #[test] fn durable_journal_rejects_partial_or_edited_records(){
        assert_eq!(read_attempt_count(b"",2).unwrap(),0);
        assert_eq!(read_attempt_count(b"1\n",2).unwrap(),1);
        assert!(read_attempt_count(b"1",2).is_err());
        assert!(read_attempt_count(b"0\n",2).is_err());
        assert!(read_attempt_count(b"1\n1",2).is_err());
        assert!(read_attempt_count(b"1\n1\n",2).is_err());
    }
    #[cfg(windows)]
    #[test] fn journal_candidate_rejects_directory_and_allows_only_regular_file_or_absence(){
        // This fixture never touches LOCALAPPDATA or the real usage journal.
        let path=std::env::temp_dir().join(format!("shuvi-a22-path-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&path).expect("isolated directory fixture");
        assert!(verify_journal_file_candidate(&path).is_err());
        fs::remove_dir(&path).expect("remove directory fixture");
        assert!(verify_journal_file_candidate(&path).is_ok());
        fs::write(&path,b"1\\n").expect("regular file fixture");
        assert!(verify_journal_file_candidate(&path).is_ok());
        fs::remove_file(&path).expect("remove regular fixture");
    }
    #[cfg(windows)]
    #[test] fn windows_billable_journal_denies_parallel_process_handle(){
        // Disposable fixture: a test must never create or alter real usage.
        let first=std::env::temp_dir().join(format!("shuvi-a22-journal-{}.tmp",uuid::Uuid::new_v4()));
        let baseline=OpenOptions::new().read(true).append(true).create_new(true).share_mode(0)
            .open(&first).expect("temporary journal");
        assert!(OpenOptions::new().read(true).write(true).share_mode(0).open(&first).is_err());
        drop(baseline);
        assert!(OpenOptions::new().read(true).share_mode(0).open(&first).is_ok());
        fs::remove_file(&first).unwrap();
    }

}
