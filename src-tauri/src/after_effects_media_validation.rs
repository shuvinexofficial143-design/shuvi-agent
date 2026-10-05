use serde_json::{json,Value};
use std::{fs::{self,File},io::{Read,Seek,SeekFrom},path::Path};

const MAX_MEDIA_BYTES:u64=128*1024*1024*1024;
const MAX_BOXES:usize=4096;
const MAX_CHUNKS:usize=4096;

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
        "media_parse_verified":true,"media_decode_verified":false}))
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
            "media_parse_verified":true,"media_decode_verified":false}));
    }
    if form==b"AVI " {
        let scan_len=len.min(8*1024*1024) as usize;
        let mut buf=vec![0u8;scan_len];read_exact_at(&mut file,0,&mut buf)?;
        let has_avih=buf.windows(4).any(|w|w==b"avih");
        let has_movi=buf.windows(4).any(|w|w==b"movi");
        if !has_avih||!has_movi{return Err("AVI validation requires avih and movi structures in bounded header scan.".into());}
        return Ok(json!({"format":"riff_avi","extension":ext,"header_scan_bytes":scan_len,"avih":true,"movi":true,
            "media_parse_verified":true,"media_decode_verified":false}));
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
        "media_parse_verified":true,"media_decode_verified":false}))
}

fn parse_jpeg(mut file:File,len:u64)->Result<Value,String>{
    if len<4{return Err("JPEG is too small.".into());}
    let mut start=[0u8;2];let mut end=[0u8;2];
    read_exact_at(&mut file,0,&mut start)?;read_exact_at(&mut file,len-2,&mut end)?;
    if start!=[0xff,0xd8]||end!=[0xff,0xd9]{return Err("JPEG SOI/EOI markers are missing.".into());}
    let scan_len=len.min(4*1024*1024) as usize;
    let mut buf=vec![0u8;scan_len];read_exact_at(&mut file,0,&mut buf)?;
    let has_sos=buf.windows(2).any(|w|w==[0xff,0xda]);
    let has_sof=buf.windows(2).any(|w|matches!(w,[0xff,0xc0]|[0xff,0xc1]|[0xff,0xc2]|[0xff,0xc3]|[0xff,0xc5]|[0xff,0xc6]|[0xff,0xc7]|[0xff,0xc9]|[0xff,0xca]|[0xff,0xcb]|[0xff,0xcd]|[0xff,0xce]|[0xff,0xcf]));
    if !has_sos||!has_sof{return Err("JPEG bounded marker scan requires SOF and SOS.".into());}
    Ok(json!({"format":"jpeg","header_scan_bytes":scan_len,"sof":true,"sos":true,"eoi":true,
        "media_parse_verified":true,"media_decode_verified":false}))
}

pub fn validate(path:&str,expected_size:Option<u64>)->Value{
    let p=Path::new(path);
    let result=(||->Result<Value,String>{
        let (file,len)=regular_media(p)?;
        if expected_size.is_some_and(|v|v!=len){return Err("Rendered media size changed from host/desktop evidence.".into());}
        let ext=p.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
        let parsed=match ext.as_str(){
            "mp4"|"mov"|"m4v"|"m4a"=>parse_iso_bmff(file,len,&ext)?,
            "wav"|"avi"=>parse_riff(file,len,&ext)?,
            "png"=>parse_png(file,len)?,
            "jpg"|"jpeg"=>parse_jpeg(file,len)?,
            _=>return Err(format!("No bounded built-in structural parser for .{ext} output.")),
        };
        Ok(json!({"output_file":path,"size_bytes":len,"parser":parsed,"media_parse_verified":true,"media_decode_verified":false}))
    })();
    match result{
        Ok(v)=>v,
        Err(error)=>json!({"output_file":path,"media_parse_verified":false,"media_decode_verified":false,"error":error}),
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
        assert_eq!(validate(path.to_str().unwrap(),Some(bytes.len() as u64))["media_parse_verified"],true);
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
}
