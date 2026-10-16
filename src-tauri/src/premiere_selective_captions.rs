//! Durable, selective SRT source creation for approved Premiere editing jobs.
//! Creates an editable caption interchange FILE, not Premiere caption-track text,
//! an Adobe timeline change, a verified frame, or a completed export.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Component,Path}};

const MAX_CUES:usize=256;
const MAX_SELECTED:usize=128;
const MAX_FILE:usize=128*1024;
const MAX_DURATION:f64=3600.0;

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Cue {
    pub start_seconds:f64,
    pub end_seconds:f64,
    pub text:String,
    pub selected:bool,
}
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version:u8,
    pub output:String,
    pub duration_seconds:f64,
    pub cues:Vec<Cue>,
    #[serde(default)] pub source_transcript_sha256:Option<String>,
}
fn millis(time:f64)->Result<u64,String> {
    if !time.is_finite() || !(0.0..=MAX_DURATION).contains(&time) {
        return Err("Caption timestamp outside 0..3600 seconds.".into());
    }
    Ok((time*1000.0).round() as u64)
}
fn timestamp(ms:u64)->String {
    format!("{:02}:{:02}:{:02},{:03}",
        ms/3_600_000,(ms/60_000)%60,(ms/1000)%60,ms%1000)
}
fn check_parent(path:&Path)->Result<(),String>{
    if !path.is_absolute()||path.components().any(|piece|
        matches!(piece,Component::ParentDir|Component::CurDir)) {
        return Err("Caption source requires a clean absolute output path.".into());
    }
    if path.extension().and_then(|x|x.to_str()).is_none_or(|x|!x.eq_ignore_ascii_case("srt")){
        return Err("Selective captions require a new .srt output.".into());
    }
    let name=path.file_name().and_then(|x|x.to_str()).ok_or("Invalid caption filename.")?;
    let stem=path.file_stem().and_then(|x|x.to_str()).unwrap_or("");
    let uppercase=stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let forbidden=matches!(uppercase.as_str(),"CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|"LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9");
    if name.starts_with('.')||name.ends_with('.')||name.ends_with(' ')
        ||name.chars().any(|c| matches!(c, '<'|'>'|':'|'"'|'|'|'?'|'*'))||forbidden {
        return Err("Caption output basename is unsupported.".into());
    }
    let mut ancestor=path.parent();
    while let Some(dir)=ancestor {
        let meta=fs::symlink_metadata(dir).map_err(|e|format!("Caption parent unavailable: {e}"))?;
        if !meta.is_dir()||meta.file_type().is_symlink(){
            return Err("Caption output parent must be a real directory, not a symlink.".into());
        }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("Caption parent is a Windows reparse point.".into());
            }
        }
        ancestor=dir.parent();
    }
    Ok(())
}
impl Request {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1||self.output.len()>4096||self.output.trim()!=self.output
            ||self.output.chars().any(|c|c.is_control())
            ||!self.duration_seconds.is_finite()
            ||!(1.0..=MAX_DURATION).contains(&self.duration_seconds)
            ||self.cues.is_empty()||self.cues.len()>MAX_CUES{
            return Err("Selective caption request exceeds bounded schema, path, duration or cue count.".into());
        }
        if let Some(hash)=&self.source_transcript_sha256 {
            if hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_hexdigit()) {
                return Err("Optional transcript SHA256 must be exactly 64 hexadecimal characters.".into());
            }
        }
        check_parent(Path::new(&self.output))?;
        let max_ms=millis(self.duration_seconds)?;
        let mut seen_selected=0usize;
        let mut previous_end=0u64;
        let mut previous_start=0u64;
        for (index,cue) in self.cues.iter().enumerate(){
            let start=millis(cue.start_seconds)?;
            let end=millis(cue.end_seconds)?;
            if start>=end||end>max_ms || (index>0 && start<previous_start) {
                return Err(format!("Cue {index} timing is unordered or exceeds the brief."));
            }
            previous_start=start;
            if cue.text.is_empty()||cue.text.chars().count()>100
                ||cue.text.chars().any(|c|c.is_control()&&c!='\n')
                ||cue.text.lines().count()>2
                ||cue.text.lines().any(|line|line.trim().is_empty()||line.chars().count()>56)
                ||cue.text.trim()!=cue.text {
                return Err(format!("Cue {index} needs at most two clean, readable lines."));
            }
            if cue.selected {
                seen_selected+=1;
                if start<previous_end {return Err(format!("Selected cues overlap at index {index}."));}
                previous_end=end;
            }
        }
        if seen_selected==0||seen_selected>MAX_SELECTED{
            return Err("Select between 1 and 128 approved caption cues.".into());
        }
        Ok(())
    }
    pub fn render(&self)->Result<(Vec<u8>,Vec<usize>),String>{
        self.validate()?;
        let mut out=String::new();
        let mut indexes=Vec::new();
        for (index,cue) in self.cues.iter().enumerate(){
            if !cue.selected{continue;}
            indexes.push(index);
            out.push_str(&format!("{}\r\n{} --> {}\r\n{}\r\n\r\n",
                indexes.len(),timestamp(millis(cue.start_seconds)?),
                timestamp(millis(cue.end_seconds)?),cue.text.replace('\n',"\r\n")));
        }
        let bytes=out.into_bytes();
        if bytes.is_empty()||bytes.len()>MAX_FILE{
            return Err("Selected caption SRT exceeds 128 KiB.".into());
        }
        Ok((bytes,indexes))
    }
}
pub fn publish(req:&Request)->Result<Value,String>{
    let (expected,indexes)=req.render()?;
    let path=Path::new(&req.output);
    // Create-new is a single OS check-and-create step, not an overwrite.
    // A failed write may leave partial bytes and must never be blindly retried.
    let mut file=OpenOptions::new().write(true).create_new(true)
        .open(path).map_err(|e|format!("Caption output not created (existing files never overwritten): {e}"))?;
    file.write_all(&expected)
        .map_err(|e|format!("Caption output may be partial; inspect before retry: {e}"))?;
    file.sync_all()
        .map_err(|e|format!("Caption output sync uncertain; inspect before retry: {e}"))?;
    drop(file);
    let before=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if !before.is_file()||before.file_type().is_symlink()
        ||before.len()!=expected.len() as u64 {
        return Err("SRT on-disk identity differs after save; inspect before retry.".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if before.file_attributes() & 0x400 != 0 {
            return Err("Output became a Windows reparse point.".into());
        }
    }
    let mut actual=Vec::new();
    File::open(path).map_err(|e|e.to_string())?
        .take(MAX_FILE as u64+1).read_to_end(&mut actual)
        .map_err(|e|format!("Caption persistence readback uncertain: {e}"))?;
    let after=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if actual!=expected||!after.is_file()||after.file_type().is_symlink()
        ||after.len()!=before.len()||after.modified().ok()!=before.modified().ok(){
        return Err("Caption persisted bytes changed during readback; inspect before retry.".into());
    }
    let sha256=format!("{:x}",Sha256::digest(&actual));
    Ok(json!({
        "created":true, "source_srt_persisted_verified":true,
        "path":req.output,"size_bytes":actual.len(),
        "sha256":sha256,"selected_cue_count":indexes.len(),
        "selected_source_indexes":indexes,
        "source_transcript_sha256_supplied_not_authenticated":req.source_transcript_sha256,
        "caption_track_created":false,"premiere_project_item_imported":false,
        "adobe_live_tested":false,"visual_style_verified":false,
        "retry_safe":false
    }))
}

#[cfg(test)] mod tests {
    use super::*;
    fn request(path:String)->Request{
        Request{schema_version:1,output:path,duration_seconds:30.0,
            cues:vec![
                Cue{start_seconds:0.0,end_seconds:1.2,text:"Hello, world!".into(),selected:true},
                Cue{start_seconds:1.2,end_seconds:2.4,text:"omit filler".into(),selected:false},
                Cue{start_seconds:2.4,end_seconds:4.0,text:"अच्छा काम\nसुरक्षित".into(),selected:true}
            ],source_transcript_sha256:None}
    }
    #[test] fn produces_exact_selective_srt_with_unicode_and_stable_crlf(){
        let mut r=request(std::env::temp_dir().join("shuvi-caption-preview.srt").to_string_lossy().to_string());
        let (bytes,indexes)=r.render().unwrap();
        assert_eq!(indexes,vec![0,2]);
        let txt=String::from_utf8(bytes).unwrap();
        assert!(txt.contains("1\r\n00:00:00,000 --> 00:00:01,200\r\nHello, world!\r\n"));
        assert!(txt.contains("2\r\n00:00:02,400 --> 00:00:04,000\r\nअच्छा काम\r\nसुरक्षित\r\n"));
        assert!(!txt.contains("omit filler"));
        r.cues[2].selected=false;r.cues[0].selected=false;
        assert!(r.render().is_err());
    }
    #[test] fn rejects_overlap_invalid_timing_and_unsafe_names(){
        let mut r=request(std::env::temp_dir().join("shuvi-caption-overlap.srt").to_string_lossy().to_string());
        r.cues[2].start_seconds=1.0;
        assert!(r.validate().is_err());
        r.cues[2].start_seconds=2.4;
        r.cues[0].end_seconds=32.0;
        assert!(r.validate().is_err());
        r.cues[0].end_seconds=1.2;
        r.output="relative.srt".into();
        assert!(r.validate().is_err());
        r.output=std::env::temp_dir().join("CON.srt").to_string_lossy().to_string();
        assert!(r.validate().is_err());
    }
    #[test] fn create_new_persists_exact_file_hash_and_never_overwrites(){
        let file=std::env::temp_dir().join(format!("shuvi-selective-{}.srt",uuid::Uuid::new_v4()));
        let r=request(file.to_string_lossy().to_string());
        let a=publish(&r).unwrap();
        assert_eq!(a["source_srt_persisted_verified"],true);
        assert_eq!(a["caption_track_created"],false);
        assert_eq!(a["premiere_project_item_imported"],false);
        let data=fs::read(&file).unwrap();
        assert_eq!(a["sha256"].as_str().unwrap(),format!("{:x}",Sha256::digest(&data)));
        assert!(publish(&r).unwrap_err().contains("never overwritten"));
        assert_eq!(fs::read(&file).unwrap(),data);
        fs::remove_file(file).unwrap();
    }
}