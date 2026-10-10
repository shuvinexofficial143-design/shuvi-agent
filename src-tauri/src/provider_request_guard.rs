//! Shuvi metered-provider usage observations; no Shuvi-imposed monetary,
//! runtime-attempt or daily-request caps. Provider credits and limits remain
//! the provider's responsibility. Never block a response due to telemetry.
use reqwest::Url;
#[cfg(windows)]
mod reported_usage;
#[cfg(windows)]
use std::{fs, os::windows::fs::MetadataExt, path::{Path,PathBuf}, time::{SystemTime,UNIX_EPOCH}};

#[cfg(windows)]
const OPEN_REPARSE_POINT:u32=0x0020_0000;
fn is_metered(provider:&str,base_url:Option<&str>)->bool{
    if provider!="ollama"{return true;}
    match base_url {
        None=>false,
        Some(value)=>Url::parse(value)
            .map(|url|!super::url_host_is_loopback(&url))
            .unwrap_or(true),
    }
}
#[cfg(windows)]
fn has_windows_reparse(meta:&fs::Metadata)->bool{
    meta.file_attributes()&0x400!=0||meta.is_symlink()
}
// Legacy basename is used only to derive the UTC usage-receipt filename.
// No paid-attempt log is created or checked and no daily quota is enforced.
#[cfg(windows)]
fn daily_journal_path()->Result<PathBuf,String>{
    let base=std::env::var_os("LOCALAPPDATA")
        .filter(|entry|!entry.is_empty())
        .ok_or_else(||"Windows LOCALAPPDATA is unavailable for optional usage reporting.".to_string())?;
    let base=PathBuf::from(base);
    let meta=fs::symlink_metadata(&base).map_err(|e|format!("Cannot inspect optional usage folder: {e}"))?;
    if !meta.is_dir()||has_windows_reparse(&meta){
        return Err("Optional usage folder cannot be a link or junction.".into());
    }
    let folder=base.join("Shuvi");
    fs::create_dir_all(&folder).map_err(|e|format!("Cannot create optional usage folder: {e}"))?;
    let meta=fs::symlink_metadata(&folder).map_err(|e|format!("Cannot inspect optional usage folder: {e}"))?;
    if !meta.is_dir()||has_windows_reparse(&meta){
        return Err("Optional usage folder cannot be a link or junction.".into());
    }
    let day=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|"System clock unavailable for optional usage reporting.".to_string())?
        .as_secs()/86_400;
    Ok(folder.join(format!("paid-ai-attempts-utc-{day}.log")))
}
#[cfg(windows)]
fn verify_journal_file_candidate(path:&Path)->Result<(),String>{
    match fs::symlink_metadata(path){
        Ok(meta) if meta.is_file()&&!has_windows_reparse(&meta)=>Ok(()),
        Ok(_)=>Err("Optional usage journal cannot be a link or non-file.".into()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),
        Err(e)=>Err(format!("Cannot inspect optional usage journal: {e}")),
    }
}
// Observational records are best-effort; callers must not turn these
// failures into paid model-call failures or automatic provider retries.
pub(crate) fn record_provider_unknown_outcome(provider:&str,model:&str,base_url:Option<&str>)->Result<(),String>{
    if !is_metered(provider,base_url){return Ok(());}
    #[cfg(windows)]
    { reported_usage::append_unknown_outcome(provider,model,base_url) }
    #[cfg(not(windows))]
    { let _=model; Ok(()) }
}
pub(crate) fn record_provider_reported_usage(
    provider:&str,model:&str,base_url:Option<&str>,
    reported:Option<(u64,u64,u64)>
)->Result<(),String>{
    if !is_metered(provider,base_url){return Ok(());}
    #[cfg(windows)]
    { reported_usage::append_receipt(provider,model,base_url,reported) }
    #[cfg(not(windows))]
    { let _=(model,reported); Ok(()) }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn only_local_loopback_ollama_is_unmetered(){
        assert!(is_metered("xkiro",None));
        assert!(is_metered("openrouter",None));
        assert!(!is_metered("ollama",None));
        assert!(!is_metered("ollama",Some("http://127.0.0.1:11434")));
        assert!(is_metered("ollama",Some("https://remote.example/v1")));
    }
    #[test] fn unmetered_provider_records_do_not_touch_disk(){
        assert!(record_provider_unknown_outcome("ollama","local",None).is_ok());
        assert!(record_provider_reported_usage("ollama","local",None,None).is_ok());
    }
}
