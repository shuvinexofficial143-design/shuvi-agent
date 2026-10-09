//! Bounded subprocess output collector for UI Automation / CDP helper scripts.
use std::{io::Read, process::{Child,Output}, sync::mpsc, thread, time::{Duration, Instant}};
pub(crate) const MAX_UI_HELPER_STREAM_BYTES: usize=8*1024*1024;

fn drain_limited(mut handle:impl Read,max:usize)->Result<Vec<u8>,String>{
    let mut result=Vec::new();
    let mut buffer=[0_u8;8192];
    let mut overflow=false;
    loop {
        let n=handle.read(&mut buffer).map_err(|e|format!("Could not read UI helper output: {e}"))?;
        if n==0{break;}
        if result.len().saturating_add(n)>max {overflow=true;continue;}
        if !overflow{result.extend_from_slice(&buffer[..n]);}
    }
    if overflow {Err("UI helper output exceeded the bounded stream size.".into())}else{Ok(result)}
}

/// The subprocess is stopped after an absolute deadline; a stop cannot prove
/// that external host mutations were rolled back. Never retry blindly.
pub(crate) fn collect_with_deadline(mut child:Child,deadline:Duration)->Result<Output,String>{
    let stdout=child.stdout.take().ok_or("UI helper stdout must be piped.")?;
    let stderr=child.stderr.take().ok_or("UI helper stderr must be piped.")?;
    let (tx,rx)=mpsc::sync_channel(2);
    let tx_err=tx.clone();
    thread::spawn(move||{let _=tx.send((0,drain_limited(stdout,MAX_UI_HELPER_STREAM_BYTES)));});
    thread::spawn(move||{let _=tx_err.send((1,drain_limited(stderr,MAX_UI_HELPER_STREAM_BYTES)));});
    let start=Instant::now();
    let status=loop{
        match child.try_wait(){
            Ok(Some(status))=>break status,
            Ok(None)=>{
                if start.elapsed()>=deadline{
                    let _=child.kill();
                    let _=child.wait();
                    // Reader threads are detached: a descendant may still
                    // hold inherited pipe handles after the parent exits.
                    return Err("PowerShell/UI Automation timed out. The outcome of any external action is unknown; inspect it before retrying.".into());
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(error)=>{
                let _=child.kill();
                let _=child.wait();
                return Err(format!("Could not inspect UI helper process: {error}"));
            }
        }
    };
    // A detached descendant retaining the pipe must not hold the UI forever.
    let mut out=None;
    let mut err=None;
    for _ in 0..2 {
        let (stream,result)=rx.recv_timeout(Duration::from_secs(2))
            .map_err(|_|"UI helper process ended but output pipes did not close in time.".to_string())?;
        match stream{0=>out=Some(result?),1=>err=Some(result?),_=>return Err("Unknown UI helper output stream.".into())}
    }
    Ok(Output{status,stdout:out.unwrap_or_default(),stderr:err.unwrap_or_default()})
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn limits_buffered_output_instead_of_reading_all_into_ram(){
        assert!(drain_limited(&b"small"[..],16).is_ok());
        assert!(drain_limited(&b"too much output"[..],4).is_err());
    }
    #[test]
    fn collects_successful_bounded_child(){
        #[cfg(windows)]
        let child=std::process::Command::new("cmd")
            .args(["/C","echo shuvi-test"]).stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()).spawn().unwrap();
        #[cfg(not(windows))]
        let child=std::process::Command::new("sh")
            .args(["-c","printf shuvi-test"]).stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()).spawn().unwrap();
        let result=collect_with_deadline(child,Duration::from_secs(5)).unwrap();
        assert!(result.status.success());
        assert!(String::from_utf8_lossy(&result.stdout).contains("shuvi-test"));
    }
}
