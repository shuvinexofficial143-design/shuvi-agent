//! Sanitized UIA preparation diagnostics; never turn a read-only probe
//! failure into an executed Windows mutation or authorization.
pub(crate) fn classify_failure(raw:&str)->String{
    if raw.contains("PowerShell/UI Automation timed out"){
        "SHUVI_UIA_PREPARE_TIMEOUT: Read-only native UIA preparation reached its deadline; no new Windows action executed. A fresh audit-bound inspection is required.".into()
    } else if raw.contains("UI helper output exceeded"){
        "SHUVI_UIA_PREPARE_OUTPUT_LIMIT: Read-only probe exceeded its output budget; no action prepared.".into()
    } else {
        "SHUVI_UIA_PREPARE_FAILED: Read-only control preparation failed; no action prepared. Inspect Activity/Audit before further work.".into()
    }
}
pub(crate) fn classify_rejection(stderr:&[u8])->&'static str{
    const MAX:usize=16*1024;
    if stderr.len()>MAX{return "SHUVI_UIA_PREPARE_REJECTED: Probe diagnostics oversized; no action prepared.";}
    let log=String::from_utf8_lossy(stderr);
    if log.contains("SHUVI_UIA_PREPARE_BOUNDED"){
        "SHUVI_UIA_PREPARE_BOUNDED: Bounded UIA traversal could not prove one unique target. No action prepared."
    } else if log.contains("SHUVI_UIA_PREPARE_AMBIGUOUS"){
        "SHUVI_UIA_PREPARE_AMBIGUOUS: Multiple UIA controls matched. No action prepared."
    } else {
        "SHUVI_UIA_PREPARE_REJECTED: Native HWND/PID/control identity could not be safely verified. No action prepared."
    }
}
pub(crate) fn numeric_timing_note(stderr:&[u8])->Option<String>{
    if stderr.len()>4096{return None;}
    let content=std::str::from_utf8(stderr).ok()?;
    for line in content.lines(){
        let Some(values)=line.strip_prefix("SHUVI_UIA_PREPARE_LOOKUP ")else{continue};
        let mut pieces=values.split_whitespace();
        let nodes=pieces.next()?.strip_prefix("nodes=")?.parse::<u32>().ok()?;
        let duration=pieces.next()?.strip_prefix("elapsed_ms=")?.parse::<u64>().ok()?;
        if pieces.next().is_some()||nodes>1200||duration>30_000{return None;}
        return Some(format!("SHUVI_UIA_PREPARE_LOOKUP nodes={nodes} elapsed_ms={duration}"));
    }
    None
}
pub(crate) fn numeric_discovery_timing_note(stderr:&[u8])->Option<String>{
    if stderr.len()>4096{return None;}
    let content=std::str::from_utf8(stderr).ok()?;
    for line in content.lines(){
        let Some(values)=line.strip_prefix("SHUVI_UIA_DISCOVERY_SCAN ")else{continue};
        let mut pieces=values.split_whitespace();
        let nodes=pieces.next()?.strip_prefix("nodes=")?.parse::<u32>().ok()?;
        let elapsed=pieces.next()?.strip_prefix("elapsed_ms=")?.parse::<u64>().ok()?;
        if pieces.next().is_some()||nodes>1200||elapsed>30_000{return None;}
        return Some(format!("SHUVI_UIA_DISCOVERY_SCAN nodes={nodes} elapsed_ms={elapsed}"));
    }
    None
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn prepare_timeout_is_clearly_read_only_and_never_claims_execution(){
        let m=classify_failure("PowerShell/UI Automation timed out. The outcome of any external action is unknown");
        assert!(m.contains("PREPARE_TIMEOUT"));
        assert!(m.contains("no new Windows action executed"));
        assert!(!m.contains("outcome unknown"));
    }
    #[test]
    fn bounded_or_ambiguous_probe_rejections_remain_sanitized(){
        assert!(classify_rejection(b"SHUVI_UIA_PREPARE_BOUNDED").contains("BOUNDED"));
        assert!(classify_rejection(b"SHUVI_UIA_PREPARE_AMBIGUOUS").contains("AMBIGUOUS"));
        assert!(!classify_rejection(b"secret-password-user-private-window").contains("private-window"));
    }
    #[test]
    fn discovery_timing_is_integer_only_bounded_and_cannot_include_private_ui_labels(){
        assert_eq!(
            numeric_discovery_timing_note(b"SHUVI_UIA_DISCOVERY_SCAN nodes=13 elapsed_ms=42\r\n"),
            Some("SHUVI_UIA_DISCOVERY_SCAN nodes=13 elapsed_ms=42".into())
        );
        assert!(numeric_discovery_timing_note(b"SHUVI_UIA_DISCOVERY_SCAN nodes=1201 elapsed_ms=1").is_none());
        assert!(numeric_discovery_timing_note(b"SHUVI_UIA_DISCOVERY_SCAN nodes=13 elapsed_ms=2 private=title").is_none());
        assert!(numeric_discovery_timing_note(b"SHUVI_UIA_DISCOVERY_SCAN nodes=13 elapsed_ms=999999").is_none());
    }
    #[test]
    fn timing_exposes_only_bounded_integers_and_refuses_trailing_data(){
        assert_eq!(numeric_timing_note(b"SHUVI_UIA_PREPARE_LOOKUP nodes=15 elapsed_ms=34\r\n"),
            Some("SHUVI_UIA_PREPARE_LOOKUP nodes=15 elapsed_ms=34".into()));
        assert!(numeric_timing_note(b"SHUVI_UIA_PREPARE_LOOKUP nodes=999999 elapsed_ms=1").is_none());
        assert!(numeric_timing_note(b"SHUVI_UIA_PREPARE_LOOKUP nodes=7 elapsed_ms=3 leaked").is_none());
    }
}
