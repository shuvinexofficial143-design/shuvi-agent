//! Native read-only provenance gate for an explicitly approved input .blend.
//! It is a source-byte check, never a Blender-launch or owner-approval claim.
use std::{fs::{self,File},io::Read,path::Path};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};

#[derive(Clone,Debug)]
pub(crate) struct SourceCheckpoint{
    pub(crate) canonical_path:String,
    pub(crate) sha256:String,
    pub(crate) bytes:u64,
}
impl SourceCheckpoint{
    pub(crate) fn json(&self)->Value{
        json!({"path":self.canonical_path,"sha256":self.sha256,"bytes":self.bytes,
            "verified_loaded_file_path":true,"loaded_file_hash_checked":true})
    }
}

fn hex64(value:&str)->bool {
    value.len()==64 && value.bytes().all(|b|b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub(crate) fn inspect(path:Option<&str>,expected:Option<&str>)->Result<Option<SourceCheckpoint>,String>{
    let (name,sha)=match(path,expected){
        (None,None)=>return Ok(None),
        (Some(name),Some(sha))=>(name,sha),
        _=>return Err("A Blender input .blend requires an explicit expected SHA-256, and vice versa.".into()),
    };
    if !hex64(sha){return Err("Blender input must include a lowercase 64-character SHA-256.".into());}
    let source=Path::new(name);
    if !source.is_absolute() || source.extension().and_then(|x|x.to_str())
        .is_none_or(|ext|!ext.eq_ignore_ascii_case("blend")){
        return Err("Blender source must be an absolute existing .blend.".into());
    }
    let before=fs::symlink_metadata(source)
        .map_err(|_|"Blender input is missing or cannot be inspected.")?;
    if before.file_type().is_symlink() || !before.is_file()
        || before.len()<12 || before.len()>128*1024*1024 {
        return Err("Blender input must be a bounded regular non-symlink .blend file.".into());
    }
    let canonical=source.canonicalize().map_err(|_|"Blender input path cannot be canonicalized.")?;
    let mut file=File::open(&canonical).map_err(|_|"Blender input cannot be opened.")?;
    let mut prefix=[0u8;12];
    file.read_exact(&mut prefix).map_err(|_|"Blender input header could not be read.")?;
    if &prefix[..7]!=b"BLENDER"
        || !matches!(prefix[7],b'-'|b'_')
        || !matches!(prefix[8],b'v'|b'V')
        || !prefix[9..12].iter().all(u8::is_ascii_digit){
        return Err("Blender input is missing the expected .blend header.".into());
    }
    let mut hasher=Sha256::new();
    hasher.update(prefix);
    let mut total=12u64;
    let mut bytes=[0u8;65536];
    loop{
        let n=file.read(&mut bytes).map_err(|_|"Blender input readback failed.")?;
        if n==0{break;}
        total+=n as u64;
        if total>128*1024*1024{return Err("Blender input exceeded the byte budget while reading.".into());}
        hasher.update(&bytes[..n]);
    }
    if total!=before.len() || format!("{:x}",hasher.finalize())!=sha{
        return Err("Blender input bytes differ from the expected checkpoint SHA-256.".into());
    }
    let path=canonical.to_str().ok_or("Blender input source path is not Unicode.")?;
    Ok(Some(SourceCheckpoint{canonical_path:path.into(),sha256:sha.into(),bytes:total}))
}
pub(crate) fn still_current(proof:&SourceCheckpoint)->Result<(),String>{
    let again=inspect(Some(&proof.canonical_path),Some(&proof.sha256))?
        .ok_or("Blender input source evidence disappeared.")?;
    if again.bytes!=proof.bytes || again.canonical_path!=proof.canonical_path{
        return Err("Blender input source changed after session startup.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    use uuid::Uuid;
    struct Temp(std::path::PathBuf);
    impl Temp{
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi-blender-source-{}",Uuid::new_v4()));
            fs::create_dir(&path).unwrap();Self(path)
        }
        fn create(&self)->(String,String){
            let file=self.0.join("stage2.blend");
            let mut bytes=b"BLENDER-v430".to_vec();bytes.extend_from_slice(&[17u8;80]);
            fs::write(&file,&bytes).unwrap();
            (file.to_str().unwrap().into(),format!("{:x}",Sha256::digest(bytes)))
        }
    }
    impl Drop for Temp{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    #[test]
    fn exact_input_hash_and_bytes_are_bound_to_canonical_path(){
        let f=Temp::new();let (p,hash)=f.create();
        let receipt=inspect(Some(&p),Some(&hash)).unwrap().unwrap();
        assert_eq!(receipt.sha256,hash);
        assert_eq!(receipt.bytes,92);
        assert_eq!(receipt.json()["verified_loaded_file_path"],true);
        still_current(&receipt).unwrap();
    }
    #[test]
    fn changed_bytes_wrong_digest_and_missing_expected_hash_are_denied(){
        let f=Temp::new();let (p,hash)=f.create();
        assert!(inspect(Some(&p),None).is_err());
        assert!(inspect(None,Some(&hash)).is_err());
        assert!(inspect(Some(&p),Some(&"0".repeat(64))).is_err());
        let proof=inspect(Some(&p),Some(&hash)).unwrap().unwrap();
        fs::write(&p,b"BLENDER-v430SOMETHING_ELSE").unwrap();
        assert!(still_current(&proof).is_err());
    }
    #[test]
    fn counterfeit_extension_or_header_rejected(){
        let f=Temp::new();let (p,_)=f.create();
        fs::write(&p,b"NOTBLENDER-v430").unwrap();
        let hash=format!("{:x}",Sha256::digest(fs::read(&p).unwrap()));
        assert!(inspect(Some(&p),Some(&hash)).is_err());
        let other=f.0.join("wrong.txt");
        fs::write(&other,b"BLENDER-v430").unwrap();
        assert!(inspect(Some(other.to_str().unwrap()),Some(&format!("{:x}",Sha256::digest(b"BLENDER-v430")))).is_err());
    }
}
