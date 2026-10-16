//! Read-only, bounded FFmpeg MP4 video+audio decode acceptance.
 //! A complete decoder pass is NOT proof of Premiere/AME export attribution,
 //! human-audible playback, visual quality, or source-timeline correctness.
use crate::{premiere_export_jobs::Job,premiere_final_delivery,premiere_media_relink};
use serde_json::{json,Value};
use std::{fs,io::Read,path::{Path,PathBuf},process::{Command,Stdio},
    sync::{Arc,atomic::{AtomicBool,Ordering}},thread,time::{Duration,Instant}};

const MAX_STDOUT:usize=64*1024;
const MAX_STDERR:usize=16*1024;
const MAX_BUDGET_SECS:u64=180;
const MIN_BUDGET_SECS:u64=15;

// Never resolve the decoder from PATH or accept an executable in model args.
pub fn detect_trusted_decoder()->Option<PathBuf>{
    #[cfg(target_os="windows")]
    {
        use std::os::windows::fs::MetadataExt;
        let root=PathBuf::from(std::env::var_os("ProgramFiles")?);
        if !root.is_absolute(){return None;}
        let path=root.join("ffmpeg").join("bin").join("ffmpeg.exe");
        let root_c=fs::canonicalize(&root).ok()?;
        let canon=fs::canonicalize(&path).ok()?;
        if !canon.starts_with(&root_c){return None;}
        for piece in [root.clone(),root.join("ffmpeg"),root.join("ffmpeg/bin"),path.clone()]{
            let m=fs::symlink_metadata(piece).ok()?;
            if m.file_type().is_symlink()||m.file_attributes()&0x400!=0{return None;}
        }
        fs::symlink_metadata(&path).ok()?.is_file().then_some(canon)
    }
    #[cfg(not(target_os="windows"))]
    {None}
}
fn bounded_pipe(mut input:impl Read,limit:usize,overflow:Arc<AtomicBool>)->Result<Vec<u8>,String>{
    let mut collected=Vec::new();let mut chunk=[0u8;4096];
    loop{
        let n=input.read(&mut chunk).map_err(|e|e.to_string())?;
        if n==0{break;}
        let room=limit.saturating_sub(collected.len());
        collected.extend_from_slice(&chunk[..n.min(room)]);
        if n>room{overflow.store(true,Ordering::SeqCst);}
    }
    Ok(collected)
}
pub fn evaluate_progress(raw:&[u8],expected_duration:f64)->Result<Value,String>{
    if raw.len()>MAX_STDOUT||!expected_duration.is_finite()
        ||expected_duration<=0.0||expected_duration>7.0*24.0*3600.0{
        return Err("Decode progress or expected duration outside validation bounds.".into());
    }
    let source=std::str::from_utf8(raw).map_err(|_|"Decoder progress is not UTF-8.")?;
    let mut block=std::collections::HashMap::<&str,&str>::new();
    let mut complete:Option<std::collections::HashMap<&str,&str>>=None;
    let mut endings=0usize;
    for line in source.lines(){
        let (k,raw_value)=line.split_once('=').ok_or("Malformed decoder progress row.")?;
        let v=raw_value.trim();
        if k.len()>48||v.len()>128||!k.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_')
            ||!v.bytes().all(|b|b.is_ascii_graphic()){
            return Err("Unbounded or invalid decoder progress key/value.".into());
        }
        if k=="progress"{
            if v=="end" {
                endings+=1;
                complete=Some(std::mem::take(&mut block));
            }else if v=="continue"{block.clear();}
            else{return Err("Unknown decoder progress marker.".into());}
        }else{block.insert(k,v);}
    }
    if endings!=1||!block.is_empty()||!source.trim_end().ends_with("progress=end"){
        return Err("Decoder did not reach a single final progress=end marker.".into());
    }
    let final_block=complete.ok_or("Final decoder progress missing.")?;
    let frames=final_block.get("frame").and_then(|s|s.parse::<u64>().ok())
        .ok_or("Decoded video frame count missing.")?;
    let micros=final_block.get("out_time_us").or_else(||final_block.get("out_time_ms"))
        .and_then(|s|s.parse::<u64>().ok()).ok_or("Decoded output duration missing.")?;
    let seconds=micros as f64/1_000_000.0;
    let complete=frames>0&&seconds.is_finite()
        &&seconds>=expected_duration*0.97;
    Ok(json!({"decode_progress_end_observed":true,"decoded_video_frames":frames,
        "decoded_output_seconds":seconds,"expected_stream_duration_seconds":expected_duration,
        "decoded_duration_fraction":seconds/expected_duration,
        "full_selected_stream_decode_verified":complete,
        "decoder_exit_success_required":true,
        "note":"FFmpeg reached end of selected local MP4 video/audio streams. Correct visuals, synchronized audio, speaker meaning and Premiere encoder job attribution are independent."}))
}
fn run_decoder(exe:&Path,path:&Path,timeout:Duration,expected_duration:f64)->Result<Value,String>{
    if detect_trusted_decoder().as_deref()!=Some(exe){
        return Err("Trusted ProgramFiles FFmpeg decoder is unavailable or changed.".into());
    }
    let budget=timeout.as_secs();
    if !(MIN_BUDGET_SECS..=MAX_BUDGET_SECS).contains(&budget){
        return Err("Full MP4 decode budget must be 15..180 seconds.".into());
    }
    let mut command=Command::new(exe);
    command.args(["-hide_banner","-nostdin","-nostats","-stats_period","5",
        "-v","error","-xerror","-err_detect","explode",
        "-protocol_whitelist","file,pipe","-i"]).arg(path)
        .args(["-map","0:v","-map","0:a?","-threads","2",
            "-f","null","-progress","pipe:1","NUL"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os="windows")]
    {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|e|format!("Trusted FFmpeg decode cannot start: {e}"))?;
    let stdout=child.stdout.take().ok_or("Decoder stdout unavailable.")?;
    let stderr=child.stderr.take().ok_or("Decoder stderr unavailable.")?;
    let overflow=Arc::new(AtomicBool::new(false));
    let a=overflow.clone();let b=overflow.clone();
    let out=thread::spawn(move||bounded_pipe(stdout,MAX_STDOUT,a));
    let err=thread::spawn(move||bounded_pipe(stderr,MAX_STDERR,b));
    let started=Instant::now();let mut timeout_reason=None;
    let status=loop{
        if overflow.load(Ordering::SeqCst)||started.elapsed()>=timeout{
            timeout_reason=Some(if overflow.load(Ordering::SeqCst){
                "FFmpeg decode produced excessive output."}else{
                "FFmpeg did not complete within the bounded budget."});
            let _=child.kill();break child.wait().ok();
        }
        match child.try_wait(){
            Ok(Some(status))=>break Some(status),
            Ok(None)=>thread::sleep(Duration::from_millis(25)),
            Err(_)=>{timeout_reason=Some("FFmpeg process status unknown.");let _=child.kill();break child.wait().ok();}
        }
    };
    let progress=out.join().map_err(|_|"Decoder stdout reader panicked.")??;
    let error=err.join().map_err(|_|"Decoder stderr reader panicked.")??;
    if let Some(reason)=timeout_reason{return Err(reason.into());}
    if overflow.load(Ordering::SeqCst){return Err("FFmpeg output overflow.".into());}
    if !status.is_some_and(|s|s.success())||!error.is_empty(){
        return Err(format!("FFmpeg decode reported failure: {}",
            String::from_utf8_lossy(&error).chars().take(300).collect::<String>()));
    }
    evaluate_progress(&progress,expected_duration)
}
pub fn inspect(job:&Job,project_guid:&str,sequence_guid:&str,budget_secs:u64)->Result<Value,String>{
    premiere_final_delivery::eligible_job(job,project_guid,sequence_guid)?;
    if !(MIN_BUDGET_SECS..=MAX_BUDGET_SECS).contains(&budget_secs){
        return Err("Full decode time budget must be 15..180 seconds.".into());
    }
    let before=premiere_media_relink::fingerprint(&job.output)?;
    let metadata=premiere_final_delivery::inspect(job,project_guid,sequence_guid)?;
    let valid=metadata.get("delivery_media_integrity_verified").and_then(Value::as_bool)==Some(true);
    let duration=metadata.pointer("/media_validation/media_probe_evidence/metadata/duration_seconds")
        .and_then(Value::as_f64);
    let decoder=detect_trusted_decoder();
    let decode=if valid {
        match(decoder.as_ref(),duration){
            (Some(exe),Some(seconds))=>run_decoder(exe,Path::new(&job.output),
                Duration::from_secs(budget_secs),seconds),
            (None,_)=>Err("Trusted ProgramFiles FFmpeg is unavailable; no download, PATH fallback or implicit installation.".into()),
            (_,None)=>Err("Exact output stream duration is missing; full decode cannot be attested.".into()),
        }
    }else{Err("MP4 structural/ffprobe stream metadata validation did not pass.".into())};
    let after=premiere_media_relink::fingerprint(&job.output)?;
    let unchanged=premiere_media_relink::same_file(&before,&after);
    let decoded=unchanged&&decode.as_ref().is_ok_and(|v|
        v.get("full_selected_stream_decode_verified").and_then(Value::as_bool)==Some(true));
    // A decodable file that existed before export dispatch is not evidence of
    // this job's output. Preserve decode evidence, but do not promote delivery.
    let new_output_observed=!job.output_existed_before
        &&job.before.exists==false
        &&job.observations.iter().any(|o|o.exists&&o.size_bytes==Some(after.size_bytes));
    let attribution_blocked=job.output_existed_before
        ||job.bridge_state=="execution_status_unknown";
    Ok(json!({"job_id":job.job_id,"project_guid":job.project_guid,
        "sequence_guid":job.sequence_guid,"output":job.output,
        "output_sha256":after.sha256,"output_unchanged_during_inspection":unchanged,
        "trusted_decoder_available":decoder.is_some(),"time_budget_seconds":budget_secs,
        "new_output_observed_for_job":new_output_observed,
        "preexisting_output_or_uncertain_dispatch":attribution_blocked,
        "job_output_attribution_blocked":attribution_blocked||!new_output_observed,
        "mp4_stream_metadata_verified":valid,"decode_evidence":decode.as_ref().ok(),
        "decode_error":decode.as_ref().err(),
        "full_selected_stream_decode_verified":decoded,
        "full_output_content_decoded_without_ffmpeg_errors":decoded,
        "human_playback_verified":false,"audio_visual_quality_verified":false,
        "adobe_encoder_completion_verified":false,
        "export_job_output_attribution_verified":false,
        "final_delivery_ready":false,"retry_safe":true,
        "note":"Read-only optional full decode of local MP4 video and audio. No changes to Premiere, original file or native job ledger. Even complete decode is not proof that the correct editing job encoded these bytes."}))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn one_final_progress_end_and_full_duration_are_mandatory(){
        let good=b"frame=900\nout_time_us=30000000\nprogress=end\n";
        assert_eq!(evaluate_progress(good,30.0).unwrap()["full_selected_stream_decode_verified"],true);
        assert_eq!(evaluate_progress(good,60.0).unwrap()["full_selected_stream_decode_verified"],false);
        assert!(evaluate_progress(b"frame=900\nout_time_us=30000000\nprogress=continue\n",30.0).is_err());
        assert!(evaluate_progress(b"frame=0\nout_time_us=30000000\nprogress=end\n",30.0)
            .unwrap()["full_selected_stream_decode_verified"]==false);
        assert!(evaluate_progress(b"frame=30\nout_time_us=30000000\nprogress=end\nprogress=end\n",30.0).is_err());
        assert!(evaluate_progress(b"frame=30\nout_time_us=-1\nprogress=end\n",30.0).is_err());
    }
    #[test] fn invalid_or_truncated_progress_never_promotes_success(){
        assert!(evaluate_progress(b"garbled",30.0).is_err());
        assert!(evaluate_progress(b"frame=30\nout_time_us=30000000\nprogress=end\n",f64::NAN).is_err());
        assert!(evaluate_progress(b"frame=30\nout_time_us=30000000\nprogress=end\nunfinished=1\n",30.0).is_err());
        assert_eq!(evaluate_progress(b"frame= 30\nstream_0_0_q=-1.0\nout_time_us= 30000000\nprogress=end\n",30.0)
            .unwrap()["full_selected_stream_decode_verified"],true);
    }
}
