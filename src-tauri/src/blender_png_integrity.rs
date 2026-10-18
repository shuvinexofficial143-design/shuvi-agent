//! Bounded PNG chunk + CRC integrity check for Shuvi Blender render receipts.
//! Checks actual decoded RGBA pixels as well as structure. Pixel diversity is
//! required only for fixed demonstration renders; this is not creative QA.
use std::{fs::File, io::Read, path::Path};

const MAX_BYTES:u64=128*1024*1024;
const MAX_CHUNK:u64=32*1024*1024;
const MAX_CHUNKS:usize=256;

// Decode the full frame within a strict allocation limit. A valid chunk CRC
// does not establish that the compressed pixels can actually be displayed.
fn verify_decoded_pixels(path:&Path,width:u64,height:u64)->Result<(),String>{
    let source=std::io::BufReader::new(File::open(path)
        .map_err(|_|"Blender PNG cannot be reopened for pixel decoding.")?);
    let mut decoder=png::Decoder::new(source);
    decoder.set_limits(png::Limits{bytes:2*1024*1024});
    let mut reader=decoder.read_info()
        .map_err(|_|"Blender PNG decoder rejected image metadata.")?;
    let expected=width.checked_mul(height).and_then(|n|n.checked_mul(4))
        .ok_or("Blender PNG decoded byte count overflow.")? as usize;
    if expected>512*512*4 || reader.output_buffer_size()!=expected{
        return Err("Blender PNG decoded RGBA buffer exceeds exact render bounds.".into());
    }
    let mut pixels=vec![0u8;expected];
    let frame=reader.next_frame(&mut pixels)
        .map_err(|_|"Blender PNG compressed pixel stream is invalid.")?;
    if frame.width as u64!=width || frame.height as u64!=height
        ||frame.color_type!=png::ColorType::Rgba
        ||frame.bit_depth!=png::BitDepth::Eight
        ||frame.buffer_size()!=expected{
        return Err("Blender PNG decoded frame differs from exact RGBA8 geometry.".into());
    }
    // Fixed proof renders must contain at least a small visible, nonuniform
    // image. Generic approved PNG plans may legitimately render a blank frame.
    let reserved=matches!(path.file_name().and_then(|v|v.to_str()),
        Some("shuvi41-proof-render.png"|"shuvi41-proof-material-render.png"));
    if reserved{
        let mut visible=0u64;
        let mut first=None;
        let mut varied=false;
        for pixel in pixels.chunks_exact(4){
            if pixel[3]==0{continue;}
            visible+=1;
            let rgb=[pixel[0],pixel[1],pixel[2]];
            if let Some(original)=first{
                if original!=rgb{varied=true;}
            }else{first=Some(rgb);}
        }
        if visible<16 || !varied{
            return Err("Fixed Blender proof render contains no meaningful visible pixel variation.".into());
        }
    }
    Ok(())
}

fn crc_step(mut crc:u32,bytes:&[u8])->u32{
    for byte in bytes {
        crc^=*byte as u32;
        for _ in 0..8 {
            crc=if crc&1==1 {(crc>>1)^0xedb8_8320}else{crc>>1};
        }
    }
    crc
}

pub(crate) fn validate(path:&Path,width:u64,height:u64)->Result<(),String>{
    if !(16..=512).contains(&width) || !(16..=512).contains(&height){
        return Err("Blender PNG pixel dimensions outside bounded render policy.".into());
    }
    let mut source=File::open(path).map_err(|_|"Blender PNG cannot be opened.")?;
    let size=source.metadata().map_err(|_|"Blender PNG metadata unavailable.")?.len();
    if !(57..=MAX_BYTES).contains(&size){
        return Err("Blender PNG total byte length is invalid.".into());
    }
    let mut signature=[0u8;8];
    source.read_exact(&mut signature).map_err(|_|"Blender PNG signature truncated.")?;
    if signature!=*b"\x89PNG\r\n\x1a\n"{
        return Err("Blender PNG signature invalid.".into());
    }
    let mut seen_header=false;
    let mut seen_data=false;
    let mut finished_data=false;
    let mut seen_end=false;
    for _ in 0..MAX_CHUNKS {
        let mut header=[0u8;8];
        source.read_exact(&mut header).map_err(|_|"Blender PNG chunk header truncated.")?;
        let size=u32::from_be_bytes(header[..4].try_into().map_err(|_|"Invalid PNG chunk length.")?);
        let kind:&[u8;4]=header[4..8].try_into()
            .map_err(|_|"Invalid PNG chunk identifier.")?;
        if size as u64>MAX_CHUNK {
            return Err("Blender PNG chunk exceeds bounded size.".into());
        }
        if !kind.iter().all(u8::is_ascii_alphabetic){
            return Err("Blender PNG chunk type invalid.".into());
        }
        if !seen_header && kind!=b"IHDR" {
            return Err("Blender PNG first chunk is not IHDR.".into());
        }
        let mut crc=crc_step(u32::MAX,kind);
        let mut remaining=size as usize;
        let mut ihdr=[0u8;13];
        if kind==b"IHDR" {
            if seen_header || size!=13 {
                return Err("Blender PNG IHDR repeated or malformed.".into());
            }
            source.read_exact(&mut ihdr).map_err(|_|"Blender PNG IHDR truncated.")?;
            crc=crc_step(crc,&ihdr);
            let w=u32::from_be_bytes(ihdr[..4].try_into().map_err(|_|"PNG IHDR width malformed.")?);
            let h=u32::from_be_bytes(ihdr[4..8].try_into().map_err(|_|"PNG IHDR height malformed.")?);
            if w as u64!=width || h as u64!=height
                || ihdr[8..]!=[8,6,0,0,0] {
                return Err("Blender PNG IHDR differs from exact non-interlaced RGBA8 output.".into());
            }
            seen_header=true;
        }else{
            if kind==b"IDAT" {
                if finished_data{
                    return Err("Blender PNG IDAT chunks are not contiguous.".into());
                }
                if size>0 {seen_data=true;}
            }else if seen_data{
                finished_data=true;
            }
            if kind==b"IEND" {
                if !seen_data || size!=0 {
                    return Err("Blender PNG IEND missing data or malformed.".into());
                }
                seen_end=true;
            }else if kind!=b"IDAT" {
                // Unknown critical chunks or animated PNG controls cannot be
                // treated as a still-image receipt without a real decoder.
                if kind[0].is_ascii_uppercase()
                    || matches!(kind,b"acTL"|b"fcTL"|b"fdAT") {
                    return Err("Unsupported critical/animated PNG chunk.".into());
                }
            }
            let mut buf=[0u8;8192];
            while remaining>0 {
                let n=remaining.min(buf.len());
                source.read_exact(&mut buf[..n])
                    .map_err(|_|"Blender PNG chunk payload truncated.")?;
                crc=crc_step(crc,&buf[..n]);
                remaining-=n;
            }
        }
        let mut crc_bytes=[0u8;4];
        source.read_exact(&mut crc_bytes).map_err(|_|"Blender PNG CRC truncated.")?;
        if !crc!=u32::from_be_bytes(crc_bytes) {
            return Err("Blender PNG chunk CRC mismatch.".into());
        }
        if seen_end {
            let mut trailing=[0u8;1];
            if source.read(&mut trailing).map_err(|_|"PNG EOF verification failed.")?!=0 {
                return Err("Blender PNG has trailing bytes after IEND.".into());
            }
            return verify_decoded_pixels(path,width,height);
        }
    }
    Err("Blender PNG missing IEND or exceeds bounded chunk count.".into())
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::fs;
    use uuid::Uuid;
    struct Temp(std::path::PathBuf);
    impl Temp{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi41-png-{}.png",Uuid::new_v4()));
            Self(path)
        }
        fn write(&self,bytes:&[u8]){fs::write(&self.0,bytes).unwrap();}
    }
    impl Drop for Temp{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
    fn add_chunk(png:&mut Vec<u8>,kind:&[u8;4],payload:&[u8]){
        png.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        png.extend_from_slice(kind);
        png.extend_from_slice(payload);
        let crc=crc_step(crc_step(u32::MAX,kind),payload);
        png.extend_from_slice(&(!crc).to_be_bytes());
    }
    fn image_from_raw(raw:Vec<u8>)->Vec<u8>{
        // Deterministic valid zlib stored block; production supports normal
        // Blender deflate streams through the pinned PNG decoder.
        let count=raw.len() as u16;
        let mut compressed=vec![0x78,0x01,0x01];
        compressed.extend_from_slice(&count.to_le_bytes());
        compressed.extend_from_slice(&(!count).to_le_bytes());
        compressed.extend_from_slice(&raw);
        let(mut a,mut b)=(1u32,0u32);
        for x in raw {a=(a+x as u32)%65521;b=(b+a)%65521;}
        compressed.extend_from_slice(&((b<<16)|a).to_be_bytes());
        let mut png=b"\x89PNG\r\n\x1a\n".to_vec();
        add_chunk(&mut png,b"IHDR",&[0,0,0,64,0,0,0,64,8,6,0,0,0]);
        add_chunk(&mut png,b"IDAT",&compressed);
        add_chunk(&mut png,b"IEND",&[]);
        png
    }
    fn image()->Vec<u8>{image_from_raw(vec![0u8;64*(1+64*4)])}
    fn proof_image()->Vec<u8>{
        let mut raw=vec![0u8;64*(1+64*4)];
        for row in 0..64usize{
            for col in 0..64usize{
                let offset=row*(1+64*4)+1+col*4;
                raw[offset]=(col*3) as u8;
                raw[offset+1]=(row*2) as u8;
                raw[offset+2]=90;
                raw[offset+3]=255;
            }
        }
        image_from_raw(raw)
    }
    #[test]
    fn rejects_invalid_zlib_even_when_all_png_chunk_crcs_are_valid(){
        let file=Temp::new();let mut bad=image();
        let chunk_offset=33usize;
        let len=u32::from_be_bytes(bad[chunk_offset..chunk_offset+4].try_into().unwrap()) as usize;
        let content_offset=chunk_offset+8;
        bad[content_offset]=0; // invalid zlib compression method
        let crc=crc_step(crc_step(u32::MAX,b"IDAT"),
            &bad[content_offset..content_offset+len]);
        bad[content_offset+len..content_offset+len+4]
            .copy_from_slice(&(!crc).to_be_bytes());
        file.write(&bad);
        assert!(validate(&file.0,64,64).is_err());
    }
    #[test]
    fn fixed_demo_render_must_have_visible_nonuniform_decoded_pixels(){
        let dir=std::env::temp_dir().join(format!("shuvi41-pixels-{}",Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        for name in ["shuvi41-proof-render.png","shuvi41-proof-material-render.png"]{
            let path=dir.join(name);
            fs::write(&path,image()).unwrap();
            assert!(validate(&path,64,64).is_err(),"blank {name}");
            fs::write(&path,proof_image()).unwrap();
            assert!(validate(&path,64,64).is_ok(),"visible {name}");
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn accepts_complete_crc_valid_non_interlaced_blender_png(){
        let file=Temp::new();file.write(&image());
        assert!(validate(&file.0,64,64).is_ok());
    }
    #[test]
    fn rejects_corrupt_header_crc_image_crc_and_wrong_dimensions(){
        let file=Temp::new();let original=image();
        let mut header=original.clone();header[29]^=0xff;
        file.write(&header);assert!(validate(&file.0,64,64).is_err());
        let mut data=original.clone();data[60]^=0x01;
        file.write(&data);assert!(validate(&file.0,64,64).is_err());
        file.write(&original);assert!(validate(&file.0,64,65).is_err());
    }
    #[test]
    fn rejects_truncated_chunks_removed_iend_and_trailing_garbage(){
        let file=Temp::new();let original=image();
        file.write(&original[..original.len()-8]);
        assert!(validate(&file.0,64,64).is_err());
        let mut suffix=original.clone();suffix.extend_from_slice(b"extra");
        file.write(&suffix);assert!(validate(&file.0,64,64).is_err());
    }
    #[test]
    fn rejects_animated_png_even_with_correct_chunk_crc(){
        let file=Temp::new();let original=image();
        let mut altered=original[..33].to_vec();
        add_chunk(&mut altered,b"acTL",&[0,0,0,1,0,0,0,0]);
        altered.extend_from_slice(&original[33..]);
        file.write(&altered);assert!(validate(&file.0,64,64).is_err());
    }
}
