//! Bounded subprocess output collector for UI Automation / CDP helper scripts.
use std::{io::Read, process::{Child,ExitStatus,Output}, sync::mpsc::{self,TryRecvError}, thread, time::{Duration, Instant}};
pub(crate) const MAX_UI_HELPER_STREAM_BYTES: usize=8*1024*1024;

fn drain_limited(mut handle:impl Read,max:usize)->Result<Vec<u8>,String>{
    let mut result=Vec::new();
    let mut buffer=[0_u8;8192];
    loop{
        let n=handle.read(&mut buffer).map_err(|e|format!("Could not read UI helper output: {e}"))?;
        if n==0{return Ok(result);}
        // Do not keep draining an untrusted producer after the output cap.
        if result.len().checked_add(n).map_or(true,|size|size>max){
            return Err("UI helper output exceeded the bounded stream size. External action outcome is unknown; inspect before retrying.".into());
        }
        result.extend_from_slice(&buffer[..n]);
    }
}

fn terminate_owned_child(child:&mut Child){
    if matches!(child.try_wait(),Ok(Some(_))){return;}
    let _=child.kill();
    // No indefinite wait: PID ownership beyond this child is not guaranteed.
    for _ in 0..12{
        if matches!(child.try_wait(),Ok(Some(_))){break;}
        thread::sleep(Duration::from_millis(10));
    }
}

/// One total deadline covers child exit and both streams. Descendants retaining
/// inherited pipe handles are not killed and may hold detached reader threads.
/// An interrupted external mutation has UNKNOWN outcome, never auto-retry.
/// The subprocess is stopped after an absolute deadline; a stop cannot prove
/// that external host mutations were rolled back. Never retry blindly.
pub(crate) fn collect_with_deadline(mut child:Child,deadline:Duration)->Result<Output,String>{
    let start=Instant::now();
    let stdout=child.stdout.take().ok_or("UI helper stdout must be piped.")?;
    let stderr=child.stderr.take().ok_or("UI helper stderr must be piped.")?;
    let (tx,rx)=mpsc::sync_channel(2);
    let tx_err=tx.clone();
    thread::spawn(move||{let _=tx.send((0,drain_limited(stdout,MAX_UI_HELPER_STREAM_BYTES)));});
    thread::spawn(move||{let _=tx_err.send((1,drain_limited(stderr,MAX_UI_HELPER_STREAM_BYTES)));});
    let mut status:Option<ExitStatus>=None;
    let mut out:Option<Vec<u8>>=None;
    let mut err:Option<Vec<u8>>=None;
    loop{
        loop{
            match rx.try_recv(){
                Ok((stream,result))=>{
                    let bytes=match result{
                        Ok(bytes)=>bytes,
                        Err(error)=>{terminate_owned_child(&mut child);return Err(error);}
                    };
                    match stream {
                        0 if out.is_none()=>out=Some(bytes),
                        1 if err.is_none()=>err=Some(bytes),
                        _=>{terminate_owned_child(&mut child);return Err("Duplicate or unknown UI helper output stream.".into());}
                    }
                }
                Err(TryRecvError::Empty)=>break,
                Err(TryRecvError::Disconnected)=>{
                    if out.is_none()||err.is_none(){
                        terminate_owned_child(&mut child);
                        return Err("UI helper output reader exited without a result; outcome unknown.".into());
                    }
                    break;
                }
            }
        }
        if status.is_none(){
            match child.try_wait(){
                Ok(Some(done))=>status=Some(done),
                Ok(None)=>{},
                Err(error)=>{
                    terminate_owned_child(&mut child);
                    return Err(format!("Could not inspect UI helper process: {error}"));
                }
            }
        }
        if out.is_some()&&err.is_some()&&status.is_some(){
            return Ok(Output{status:status.expect("checked"),stdout:out.expect("checked"),stderr:err.expect("checked")});
        }
        if start.elapsed()>=deadline{
            terminate_owned_child(&mut child);
            return Err("PowerShell/UI Automation timed out. The outcome of any external action is unknown; inspect it before retrying.".into());
        }
        thread::sleep(Duration::from_millis(25).min(deadline.saturating_sub(start.elapsed())));
    }
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
    #[test]
    fn stops_reading_immediately_after_output_limit(){
        let mut data=std::io::Cursor::new(vec![b'x';64*1024]);
        assert!(drain_limited(&mut data,10).is_err());
        assert_eq!(data.position(),8192);
    }
    #[test]
    fn excessive_output_is_rejected_before_process_deadline(){
        #[cfg(windows)]
        let child=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","[Console]::Out.Write('x' * 9000000)"])
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        #[cfg(not(windows))]
        let child=std::process::Command::new("sh").args(["-c","yes 012345678901234567890123456789"])
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let started=Instant::now();
        let error=collect_with_deadline(child,Duration::from_secs(15)).unwrap_err();
        assert!(error.contains("bounded stream size"));
        assert!(started.elapsed()<Duration::from_secs(14));
    }
    #[test]
    fn hung_child_returns_on_absolute_deadline_without_unbounded_wait(){
        #[cfg(windows)]
        let child=std::process::Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-Command","Start-Sleep -Seconds 20"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()).spawn().unwrap();
        #[cfg(not(windows))]
        let child=std::process::Command::new("sleep")
            .arg("20")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()).spawn().unwrap();
        let now=Instant::now();
        let outcome=collect_with_deadline(child,Duration::from_millis(250));
        assert!(outcome.is_err(),"hung child should hit deadline");
        assert!(outcome.unwrap_err().contains("outcome of any external action is unknown"));
        assert!(now.elapsed()<Duration::from_secs(5),"helper must return promptly after deadline");
    }
}