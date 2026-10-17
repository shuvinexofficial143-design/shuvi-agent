//! Bounded PNG chunk + CRC integrity check for Shuvi Blender render receipts.
//! This is NOT zlib decompression, pixel inspection, or creative acceptance.
use std::{fs::File, io::Read, path::Path};

const MAX_BYTES:u64=128*1024*1024;
const MAX_CHUNK:u64=32*1024*1024;
const MAX_CHUNKS:usize=256;

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
            return Ok(());
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
    fn image()->Vec<u8>{
        // Valid zlib stored-block payload for a transparent 64x64 RGBA still.
        let raw=vec![0u8;64*(1+64*4)];
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
