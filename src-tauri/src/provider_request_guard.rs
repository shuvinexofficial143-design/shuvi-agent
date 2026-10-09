//! Phase 1 native billable-attempt circuit breaker; NOT a persistent USD budget.
use std::sync::atomic::{AtomicUsize,Ordering};
use reqwest::Url;
pub(crate) const MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME:usize=48;
static PAID_ATTEMPTS:AtomicUsize=AtomicUsize::new(0);

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
pub(crate) fn claim_paid_attempt(provider:&str,base_url:Option<&str>)->Result<(),String>{
    if is_metered(provider,base_url){
        reserve(&PAID_ATTEMPTS,MAX_PAID_REQUEST_ATTEMPTS_PER_RUNTIME)?;
    }
    Ok(())
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
}
