use serde_json::{json,Value};
use std::{fs::{self,File},io::{Read,Seek,SeekFrom},path::{Path,PathBuf},process::{Command,Stdio},
    sync::{Arc,atomic::{AtomicBool,Ordering}},thread,time::{Duration,Instant}};

const MAX_MEDIA_BYTES:u64=128*1024*1024*1024;
const MAX_BOXES:usize=4096;
const MAX_CHUNKS:usize=4096;
const MAX_PROBE_STDOUT:usize=256*1024;
const MAX_PROBE_STDERR:usize=16*1024;
const MAX_STREAMS:usize=64;
const PROBE_TIMEOUT:Duration=Duration::from_secs(5);

// Never search PATH, the working directory, or accept an executable from host args.
// An existing administrator-installed FFmpeg is optional; Shuvi does not download it.
pub fn detect_probe()->Option<PathBuf>{
    #[cfg(target_os="windows")]
    {
        let root=PathBuf::from(std::env::var_os("ProgramFiles")?);
        if !root.is_absolute(){return None;}
        let path=root.join("ffmpeg").join("bin").join("ffprobe.exe");
        let canonical_root=fs::canonicalize(&root).ok()?;
        let canonical=fs::canonicalize(&path).ok()?;
        if !canonical.starts_with(&canonical_root){return None;}
        // Reject junctions/reparse points as well as leaf symlinks in the trusted layout.
        use std::os::windows::fs::MetadataExt;
        for part in [root.clone(),root.join("ffmpeg"),root.join("ffmpeg/bin"),path.clone()]{
            let meta=fs::symlink_metadata(part).ok()?;
            if meta.file_type().is_symlink()||meta.file_attributes()&0x400!=0{return None;}
        }
        if !fs::symlink_metadata(&path).ok()?.is_file(){return None;}
        Some(canonical)
    }
    #[cfg(not(target_os="windows"))]
    {None}
}

fn bounded_pipe(mut input:impl Read,limit:usize,overflow:Arc<AtomicBool>)->Result<Vec<u8>,String>{
    let mut result=Vec::new();let mut buffer=[0u8;4096];
    loop{
        let n=input.read(&mut buffer).map_err(|e|e.to_string())?;
        if n==0{break;}
        let room=limit.saturating_sub(result.len());
        result.extend_from_slice(&buffer[..n.min(room)]);
        if n>room{overflow.store(true,Ordering::SeqCst);}
    }
    Ok(result)
}
fn positive_duration(value:Option<&Value>)->Option<f64>{
    let value=value?;
    let number=value.as_f64().or_else(||value.as_str()?.parse::<f64>().ok())?;
    (number.is_finite()&&number>0.0&&number<=7.0*24.0*3600.0).then_some(number)
}
fn probe_metadata(raw:&[u8],still_image:bool)->Result<Value,String>{
    if raw.len()>MAX_PROBE_STDOUT{return Err("Media probe JSON exceeds bound.".into());}
    let parsed:Value=serde_json::from_slice(raw).map_err(|_|"Media probe did not return valid JSON.")?;
    let input=parsed.get("streams").and_then(Value::as_array).ok_or("Media probe has no stream inventory.")?;
    if input.is_empty()||input.len()>MAX_STREAMS{return Err("Media probe stream count is empty or exceeds bound.".into());}
    let mut streams=Vec::new();let mut duration=positive_duration(parsed.pointer("/format/duration"));
    for stream in input{
        let kind=stream.get("codec_type").and_then(Value::as_str).unwrap_or("");
        if kind!="video"&&kind!="audio"{continue;}
        let codec=stream.get("codec_name").and_then(Value::as_str).ok_or("Media stream codec is missing.")?;
        if codec.is_empty()||codec.len()>80||codec=="unknown"||codec=="none"
            || !codec.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'){
            return Err("Media stream codec is invalid or unbounded.".into());
        }
        let index=stream.get("index").and_then(Value::as_u64).ok_or("Media stream index missing.")?;
        if index>=MAX_STREAMS as u64||streams.iter().any(|v:&Value|v["index"].as_u64()==Some(index)){
            return Err("Media stream identity invalid or duplicated.".into());
        }
        let stream_duration=positive_duration(stream.get("duration"));
        if let Some(d)=stream_duration{duration=Some(duration.unwrap_or(0.0).max(d));}
        let mut entry=json!({"index":index,"codec_type":kind,"codec_name":codec,"duration_seconds":stream_duration});
        if kind=="video"{
            let width=stream.get("width").and_then(Value::as_u64).ok_or("Video stream width missing.")?;
            let height=stream.get("height").and_then(Value::as_u64).ok_or("Video stream height missing.")?;
            if width==0||height==0||width>30000||height>30000{return Err("Video dimensions are invalid.".into());}
            entry["width"]=json!(width);entry["height"]=json!(height);
        }else{
            let channels=stream.get("channels").and_then(Value::as_u64).ok_or("Audio channel count missing.")?;
            let rate=stream.get("sample_rate").and_then(Value::as_str).and_then(|v|v.parse::<u32>().ok())
                .ok_or("Audio sample rate missing.")?;
            if channels==0||channels>64||rate==0||rate>768000{return Err("Audio stream metadata is invalid.".into());}
            entry["channels"]=json!(channels);entry["sample_rate"]=json!(rate);
        }
        streams.push(entry);
    }
    if streams.is_empty(){return Err("Media probe found no valid audio/video stream.".into());}
    if still_image&&streams.iter().any(|v|v["codec_type"]!="video"){
        return Err("Still-image output contains unexpected audio streams.".into());
    }
    if !still_image&&duration.is_none(){return Err("Timed media requires a finite positive duration.".into());}
    Ok(json!({"streams":streams,"duration_seconds":duration,"duration_applicable":!still_image,
        "media_parse_verified":true,"media_decode_verified":false,"playability_verified":false}))
}
fn run_probe(executable:&Path,path:&Path,timeout:Duration)->Result<Value,String>{
    // Re-detect immediately before spawn; an arbitrary caller-supplied executable is refused.
    if detect_probe().as_deref()!=Some(executable){return Err("Trusted media probe is no longer available.".into());}
    if timeout.is_zero(){return Err("Media probe render-batch time budget exhausted.".into());}
    let mut command=Command::new(executable);
    command.args(["-v","error","-protocol_whitelist","file,pipe","-probesize","5242880",
        "-analyzeduration","5000000","-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height,sample_rate,channels,duration","-of","json","-i"])
        .arg(path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os="windows")]
    {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|e|format!("Media probe could not start: {e}"))?;
    let overflow=Arc::new(AtomicBool::new(false));
    let out=child.stdout.take().ok_or("Media probe stdout missing.")?;
    let err=child.stderr.take().ok_or("Media probe stderr missing.")?;
    let out_overflow=overflow.clone();let err_overflow=overflow.clone();
    let stdout=thread::spawn(move||bounded_pipe(out,MAX_PROBE_STDOUT,out_overflow));
    let stderr=thread::spawn(move||bounded_pipe(err,MAX_PROBE_STDERR,err_overflow));
    let start=Instant::now();let mut failure=None;
    let status=loop{
        if overflow.load(Ordering::SeqCst)||start.elapsed()>=timeout.min(PROBE_TIMEOUT){
            failure=Some(if overflow.load(Ordering::SeqCst){"Media probe output limit exceeded."}else{"Media probe timeout; parse outcome unverified."});
            let _=child.kill();break child.wait().ok();
        }
        match child.try_wait(){
            Ok(Some(status))=>break Some(status),
            Ok(None)=>thread::sleep(Duration::from_millis(10)),
            Err(_)=>{failure=Some("Media probe process status unavailable.");let _=child.kill();break child.wait().ok();}
        }
    };
    let raw=stdout.join().map_err(|_|"Media probe stdout reader failed.")??;
    let error=stderr.join().map_err(|_|"Media probe stderr reader failed.")??;
    if overflow.load(Ordering::SeqCst){return Err("Media probe output limit exceeded.".into());}
    if let Some(reason)=failure{return Err(reason.into());}
    if !status.is_some_and(|s|s.success())||!error.is_empty(){
        return Err(format!("Media probe failed: {}",String::from_utf8_lossy(&error).chars().take(2000).collect::<String>()));
    }
    let ext=path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
    probe_metadata(&raw,matches!(ext.as_str(),"png"|"jpg"|"jpeg"))
}

fn regular_media(path:&Path)->Result<(File,u64),String>{
    if !path.is_absolute(){return Err("Rendered media path must be absolute.".into());}
    let meta=fs::symlink_metadata(path).map_err(|e|format!("Rendered media unavailable: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err("Rendered media must be a regular non-symlink file.".into());}
    if meta.len()==0||meta.len()>MAX_MEDIA_BYTES{return Err("Rendered media size is outside validation bounds.".into());}
    let file=File::open(path).map_err(|e|format!("Could not open rendered media: {e}"))?;
    Ok((file,meta.len()))
}
fn read_exact_at(file:&mut File,offset:u64,buf:&mut [u8])->Result<(),String>{
    file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
    file.read_exact(buf).map_err(|e|e.to_string())
}
fn be_u32(v:&[u8])->u32{u32::from_be_bytes([v[0],v[1],v[2],v[3]])}
fn be_u64(v:&[u8])->u64{u64::from_be_bytes([v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7]])}
fn le_u32(v:&[u8])->u32{u32::from_le_bytes([v[0],v[1],v[2],v[3]])}

fn parse_iso_bmff(mut file:File,len:u64,extension:&str)->Result<Value,String>{
    let mut offset=0u64;let mut boxes=0usize;
    let mut ftyp=false;let mut moov=false;let mut mdat=false;
    while offset<len {
        if boxes>=MAX_BOXES{return Err("ISO BMFF box count exceeds safety bound.".into());}
        if len-offset<8{return Err("ISO BMFF has truncated top-level box header.".into());}
        let mut h=[0u8;16];read_exact_at(&mut file,offset,&mut h[..8])?;
        let size32=be_u32(&h[..4]) as u64;
        let kind=String::from_utf8_lossy(&h[4..8]).to_string();
        let (size,header)=if size32==1 {
            if len-offset<16{return Err("ISO BMFF extended box header is truncated.".into());}
            read_exact_at(&mut file,offset+8,&mut h[8..16])?;
            (be_u64(&h[8..16]),16u64)
        } else if size32==0 {(len-offset,8u64)} else {(size32,8u64)};
        if size<header || offset.checked_add(size).is_none() || offset+size>len {
            return Err("ISO BMFF contains an invalid top-level box size.".into());
        }
        match kind.as_str(){"ftyp"=>ftyp=true,"moov"=>moov=true,"mdat"=>mdat=true,_=>{}}
        offset+=size;boxes+=1;
    }
    let ext=extension.to_ascii_lowercase();
    let required_brand=ftyp || ext=="mov";
    let verified=required_brand&&moov&&mdat&&offset==len;
    if !verified{return Err("ISO BMFF structural validation requires moov + mdat and a valid file type context.".into());}
    Ok(json!({"format":"iso_bmff","extension":ext,"top_level_boxes":boxes,"ftyp":ftyp,"moov":moov,"mdat":mdat,
        "media_structure_verified":true,"media_decode_verified":false}))
}

fn parse_riff(mut file:File,len:u64,extension:&str)->Result<Value,String>{
    if len<12{return Err("RIFF media is too small.".into());}
    let mut head=[0u8;12];read_exact_at(&mut file,0,&mut head)?;
    if &head[..4]!=b"RIFF"{return Err("RIFF signature missing.".into());}
    let declared=le_u32(&head[4..8]) as u64 + 8;
    if declared>len{return Err("RIFF declared size exceeds file size.".into());}
    let form=&head[8..12];
    let ext=extension.to_ascii_lowercase();
    if form==b"WAVE" {
        let mut off=12u64;let mut chunks=0usize;let mut fmt=false;let mut data=false;
        while off+8<=declared {
            if chunks>=MAX_CHUNKS{return Err("WAV chunk count exceeds safety bound.".into());}
            let mut ch=[0u8;8];read_exact_at(&mut file,off,&mut ch)?;
            let size=le_u32(&ch[4..8]) as u64;
            let payload=off+8;
            if payload.checked_add(size).is_none()||payload+size>declared{return Err("WAV chunk exceeds declared RIFF bounds.".into());}
            if &ch[..4]==b"fmt "{fmt=true;}
            if &ch[..4]==b"data"&&size>0{data=true;}
            off=payload+size+(size&1);chunks+=1;
        }
        if !fmt||!data{return Err("WAV requires fmt and non-empty data chunks.".into());}
        return Ok(json!({"format":"riff_wave","extension":ext,"chunks":chunks,"fmt":fmt,"data":data,
            "media_structure_verified":true,"media_decode_verified":false}));
    }
    if form==b"AVI " {
        let scan_len=len.min(8*1024*1024) as usize;
        let mut buf=vec![0u8;scan_len];read_exact_at(&mut file,0,&mut buf)?;
        let has_avih=buf.windows(4).any(|w|w==b"avih");
        let has_movi=buf.windows(4).any(|w|w==b"movi");
        if !has_avih||!has_movi{return Err("AVI validation requires avih and movi structures in bounded header scan.".into());}
        return Ok(json!({"format":"riff_avi","extension":ext,"header_scan_bytes":scan_len,"avih":true,"movi":true,
            "media_structure_verified":true,"media_decode_verified":false}));
    }
    Err("Unsupported RIFF form.".into())
}

fn parse_png(mut file:File,len:u64)->Result<Value,String>{
    if len<20{return Err("PNG is too small.".into());}
    let mut sig=[0u8;8];read_exact_at(&mut file,0,&mut sig)?;
    if sig!=[137,80,78,71,13,10,26,10]{return Err("PNG signature missing.".into());}
    let mut off=8u64;let mut chunks=0usize;let mut ihdr=false;let mut idat=false;let mut iend=false;
    while off+12<=len {
        if chunks>=MAX_CHUNKS{return Err("PNG chunk count exceeds safety bound.".into());}
        let mut h=[0u8;8];read_exact_at(&mut file,off,&mut h)?;
        let size=be_u32(&h[..4]) as u64;let kind=&h[4..8];
        let total=12u64.checked_add(size).ok_or("PNG chunk size overflow.")?;
        if off.checked_add(total).is_none()||off+total>len{return Err("PNG chunk exceeds file bounds.".into());}
        if kind==b"IHDR"{if chunks!=0||size!=13{return Err("PNG IHDR is invalid.".into());}ihdr=true;}
        if kind==b"IDAT"&&size>0{idat=true;}
        if kind==b"IEND"{if size!=0{return Err("PNG IEND must be empty.".into());}iend=true;off+=total;break;}
        off+=total;chunks+=1;
    }
    if !ihdr||!idat||!iend||off!=len{return Err("PNG requires valid IHDR, IDAT and terminal IEND.".into());}
    Ok(json!({"format":"png","chunks":chunks+1,"ihdr":true,"idat":true,"iend":true,
        "media_structure_verified":true,"media_decode_verified":false}))
}

fn parse_jpeg(mut file:File,len:u64)->Result<Value,String>{
    if len<4{return Err("JPEG is too small.".into());}
    let mut start=[0u8;2];let mut end=[0u8;2];
    read_exact_at(&mut file,0,&mut start)?;read_exact_at(&mut file,len-2,&mut end)?;
    if start!=[0xff,0xd8]||end!=[0xff,0xd9]{return Err("JPEG SOI/EOI markers are missing.".into());}
    let scan_len=len.min(4*1024*1024) as usize;
    let mut buf=vec![0u8;scan_len];read_exact_at(&mut file,0,&mut buf)?;
    let has_sos=buf.windows(2).any(|w|w==[0xff,0xda]);
    let has_sof=buf.windows(2).any(|w|matches!(w,&[0xff,0xc0]|&[0xff,0xc1]|&[0xff,0xc2]|&[0xff,0xc3]|&[0xff,0xc5]|&[0xff,0xc6]|&[0xff,0xc7]|&[0xff,0xc9]|&[0xff,0xca]|&[0xff,0xcb]|&[0xff,0xcd]|&[0xff,0xce]|&[0xff,0xcf]));
    if !has_sos||!has_sof{return Err("JPEG bounded marker scan requires SOF and SOS.".into());}
    Ok(json!({"format":"jpeg","header_scan_bytes":scan_len,"sof":true,"sos":true,"eoi":true,
        "media_structure_verified":true,"media_decode_verified":false}))
}

pub fn validate(path:&str,expected_size:Option<u64>)->Value{
    validate_with_budget(path,expected_size,PROBE_TIMEOUT)
}
pub fn validate_with_budget(path:&str,expected_size:Option<u64>,budget:Duration)->Value{
    let p=Path::new(path);
    let probe=detect_probe();
    let result=(||->Result<Value,String>{
        if path.contains('[')||path.contains(']'){
            return Err("Image-sequence patterns require an exact frame inventory; single-file probe refused.".into());
        }
        let (file,len)=regular_media(p)?;
        let before=file.metadata().map_err(|e|e.to_string())?;
        if expected_size.is_some_and(|v|v!=len){return Err("Rendered media size changed from host/desktop evidence.".into());}
        let ext=p.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
        let structural=match ext.as_str(){
            "mp4"|"mov"|"m4v"|"m4a"=>parse_iso_bmff(file,len,&ext),
            "wav"|"avi"=>parse_riff(file,len,&ext),
            "png"=>parse_png(file,len),
            "jpg"|"jpeg"=>parse_jpeg(file,len),
            _=>return Err(format!("No bounded built-in structural parser for .{ext} output.")),
        };
        let structure_ok=structural.is_ok();
        let structure=structural.unwrap_or_else(|error|json!({"error":error,"media_structure_verified":false}));
        let evidence=match probe.as_ref(){
            Some(executable)=>match run_probe(executable,p,budget){
                Ok(metadata)=>json!({"kind":"ffprobe_metadata","executable":executable,"metadata":metadata,
                    "media_parse_verified":true,"media_decode_verified":false}),
                Err(error)=>json!({"kind":"ffprobe_metadata","executable":executable,"media_parse_verified":false,"error":error}),
            },
            None=>json!({"kind":"unavailable","media_parse_verified":false,
                "reason":"No trusted ProgramFiles/ffmpeg/bin/ffprobe.exe is installed. Structural checks alone do not validate media streams."}),
        };
        let after=fs::symlink_metadata(p).map_err(|e|e.to_string())?;
        if !after.is_file()||after.file_type().is_symlink()||after.len()!=len||before.modified().ok()!=after.modified().ok(){
            return Err("Rendered media changed while probing; evidence discarded.".into());
        }
        let verified=evidence.get("media_parse_verified").and_then(Value::as_bool)==Some(true);
        Ok(json!({"output_file":path,"size_bytes":len,"parser":structure,"media_structure_verified":structure_ok,
            "media_probe_available":probe.is_some(),"media_probe_evidence":evidence,
            "media_parse_verified":verified,"media_decode_verified":false,"playability_verified":false}))
    })();
    match result{
        Ok(v)=>v,
        Err(error)=>json!({"output_file":path,"media_structure_verified":false,"media_probe_available":probe.is_some(),
            "media_parse_verified":false,"media_decode_verified":false,"error":error}),
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::io::Write;

    #[test]fn validates_minimal_png_and_rejects_truncation(){
        let root=std::env::temp_dir().join(format!("shuvi-ae-media-{}",std::process::id()));
        let _=fs::create_dir_all(&root);
        let path=root.join("x.png");
        let mut bytes=vec![137,80,78,71,13,10,26,10];
        bytes.extend_from_slice(&13u32.to_be_bytes());bytes.extend_from_slice(b"IHDR");bytes.extend_from_slice(&[0u8;13]);bytes.extend_from_slice(&[0u8;4]);
        bytes.extend_from_slice(&1u32.to_be_bytes());bytes.extend_from_slice(b"IDAT");bytes.push(1);bytes.extend_from_slice(&[0u8;4]);
        bytes.extend_from_slice(&0u32.to_be_bytes());bytes.extend_from_slice(b"IEND");bytes.extend_from_slice(&[0u8;4]);
        fs::write(&path,&bytes).unwrap();
        let result=validate(path.to_str().unwrap(),Some(bytes.len() as u64));
        assert_eq!(result["media_structure_verified"],true);
        // This intentionally invalid PNG has markers but no dimensions/CRC/image data.
        assert_eq!(result["media_parse_verified"],false);
        let bad=root.join("bad.png");fs::write(&bad,&bytes[..bytes.len()-1]).unwrap();
        assert_eq!(validate(bad.to_str().unwrap(),None)["media_parse_verified"],false);
        let _=fs::remove_dir_all(root);
    }

    #[test]fn unsupported_extension_fails_closed(){
        let path=std::env::temp_dir().join(format!("shuvi-ae-media-{}.bin",std::process::id()));
        let mut f=File::create(&path).unwrap();f.write_all(b"not-media").unwrap();
        assert_eq!(validate(path.to_str().unwrap(),None)["media_parse_verified"],false);
        let _=fs::remove_file(path);
    }
    #[test]fn metadata_requires_real_streams_and_positive_timed_duration(){
        let valid=json!({"format":{"duration":"1.25"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","width":1920,"height":1080}]});
        let parsed=probe_metadata(&serde_json::to_vec(&valid).unwrap(),false).unwrap();
        assert_eq!(parsed["media_parse_verified"],true);
        assert_eq!(parsed["media_decode_verified"],false);
        assert_eq!(parsed["playability_verified"],false);
        for duration in ["0","-1","NaN","inf","N/A"]{
            let mut invalid=valid.clone();invalid["format"]["duration"]=json!(duration);
            assert!(probe_metadata(&serde_json::to_vec(&invalid).unwrap(),false).is_err());
        }
        let mut invalid=valid.clone();invalid["streams"][0]["width"]=json!(0);
        assert!(probe_metadata(&serde_json::to_vec(&invalid).unwrap(),false).is_err());
        assert!(probe_metadata(br#"{"format":{"duration":"1"},"streams":[]}"#,false).is_err());
        assert!(probe_metadata(br#"{"format":{"duration":"1"},"streams":[{"codec_type":"data"}]}"#,false).is_err());
    }
    #[test]fn metadata_is_bounded_and_still_images_have_no_duration_requirement(){
        let image=json!({"streams":[{"index":0,"codec_type":"video","codec_name":"png","width":32,"height":32}]});
        assert!(probe_metadata(&serde_json::to_vec(&image).unwrap(),true).is_ok());
        assert!(probe_metadata(&serde_json::to_vec(&image).unwrap(),false).is_err());
        let mut oversized=image.clone();oversized["streams"]=json!(vec![image["streams"][0].clone();65]);
        assert!(probe_metadata(&serde_json::to_vec(&oversized).unwrap(),true).is_err());
        let mut duplicate=image.clone();duplicate["streams"]=json!(vec![image["streams"][0].clone();2]);
        assert!(probe_metadata(&serde_json::to_vec(&duplicate).unwrap(),true).is_err());
        assert!(probe_metadata(&vec![b' ';MAX_PROBE_STDOUT+1],true).is_err());
        let overflow=Arc::new(AtomicBool::new(false));
        assert_eq!(bounded_pipe(std::io::Cursor::new(vec![0;100]),10,overflow.clone()).unwrap().len(),10);
        assert!(overflow.load(Ordering::SeqCst));
    }
    #[test]fn valid_audio_metadata_and_sequence_rejection(){
        let audio=json!({"streams":[{"index":0,"codec_type":"audio","codec_name":"pcm_s16le","channels":2,"sample_rate":"48000","duration":"2.0"}]});
        assert!(probe_metadata(&serde_json::to_vec(&audio).unwrap(),false).is_ok());
        assert!(probe_metadata(&serde_json::to_vec(&audio).unwrap(),true).is_err());
        assert_eq!(validate("C:/frames/[#####].png",None)["media_parse_verified"],false);
    }
}
