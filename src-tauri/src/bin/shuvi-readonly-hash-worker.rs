//! Fixed-purpose read-only SHA-256 sidecar for Shuvi's *internal* Windows lane.
//! This binary has no network, shell, UI, model API or file-mutation operation
//! except create-new output of a bounded evidence JSON in a trusted directory.
#[cfg(not(windows))]
fn main(){eprintln!("Shuvi's owned Windows SHA verifier is Windows-only.");std::process::exit(1);}
#[cfg(windows)]
fn main(){
    if let Err(e)=worker::run(){
        eprintln!("Read-only SHA verifier rejected task: {e}");
        std::process::exit(1);
    }
}
#[cfg(windows)]
mod worker{
    use sha2::{Digest,Sha256};
    use serde::Serialize;
    use std::{
        env,ffi::OsString,fs::{self,File,OpenOptions},io::{Read,Write},
        os::windows::fs::{MetadataExt,OpenOptionsExt},
        path::{Path,PathBuf},
    };
    const MAX_BYTES:u64=128*1024*1024;
    const MAX_RESULT:usize=512;
    const REPARSE:u32=0x400;

    // No caller can choose an executable or worker behavior. Four fixed typed
    // arguments only: canonical UUID, absolute read-input, expected SHA, and
    // the absolute fresh output file, in that exact order.
    fn parse()->Result<(String,PathBuf,String,PathBuf),String>{
        let args:Vec<OsString>=env::args_os().collect();
        if args.len()!=6||args[1]!="--shuvi-readonly-sha256"{
            return Err("Only the internal strict hash-verification protocol is supported.".into());
        }
        let id=args[2].to_str().ok_or("Invalid action identity encoding.")?;
        if uuid::Uuid::parse_str(id).map(|x|x.to_string()!=id).unwrap_or(true){
            return Err("Background SHA task ID is not canonical.".into());
        }
        let input=PathBuf::from(&args[3]);
        let sha=args[4].to_str().ok_or("Invalid digest encoding.")?;
        if sha.len()!=64||!sha.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)){
            return Err("Expected SHA-256 is malformed.".into());
        }
        let result=PathBuf::from(&args[5]);
        if !input.is_absolute()||!result.is_absolute()
           ||input==result||input.to_string_lossy().len()>4096
           ||result.to_string_lossy().len()>4096{
            return Err("Worker read/output paths must be bounded absolute distinct files.".into());
        }
        let basename=format!("native-bg-hash-{id}.json");
        if result.file_name()!=Some(std::ffi::OsStr::new(&basename)){
            return Err("Worker hash result path does not match its exact UUID.".into());
        }
        Ok((id.to_string(),input,sha.to_owned(),result))
    }
    fn check_file(input:&Path)->Result<(File,u64),String>{
        let info=fs::symlink_metadata(input).map_err(|_|"Input inaccessible.")?;
        if !info.is_file()||info.file_type().is_symlink()||info.file_attributes()&REPARSE!=0
            ||info.len()==0||info.len()>MAX_BYTES{
            return Err("Read-only input is not a safe bounded regular file.".into());
        }
        // Share READ only: writer/deleter cannot change the input during SHA.
        let file=OpenOptions::new().read(true).share_mode(0x1).open(input)
            .map_err(|_|"Cannot lock input against writes while hashing.")?;
        let opened=file.metadata().map_err(|_|"Cannot inspect opened input.")?;
        if !opened.is_file()||opened.file_attributes()&REPARSE!=0||opened.len()!=info.len(){
            return Err("Input identity changed before hash streaming.".into());
        }
        Ok((file,opened.len()))
    }
    fn checked_result_parent(path:&Path)->Result<(),String>{
        let parent=path.parent().ok_or("Worker result has no parent.")?;
        let meta=fs::symlink_metadata(parent).map_err(|_|"Result parent inaccessible.")?;
        if !meta.is_dir()||meta.file_type().is_symlink()||meta.file_attributes()&REPARSE!=0{
            return Err("Result parent is redirected.".into());
        }
        Ok(())
    }
    pub(super) fn run()->Result<(),String>{
        let (id,input,expected,result)=parse()?;
        checked_result_parent(&result)?;
        let (mut file,len)=check_file(&input)?;
        let mut sha=Sha256::new();let mut read_count=0u64;let mut buf=[0u8;64*1024];
        loop{
            let count=file.read(&mut buf).map_err(|_|"Bounded input read failed.")?;
            if count==0{break;}
            read_count=read_count.checked_add(count as u64)
                .ok_or("Read byte accounting overflow.")?;
            if read_count>MAX_BYTES{return Err("Input exceeded bounded SHA reader.".into());}
            sha.update(&buf[..count]);
        }
        if read_count!=len{return Err("Input length changed during SHA read.".into());}
        let actual=format!("{:x}",sha.finalize());
        if actual!=expected{return Err("Read-only worker SHA disagrees with approved expected digest.".into());}
        // A JSON attestation is a WORKER CLAIM only. The native host must
        // independently reopen, lock and rehash the input before approval.
        #[derive(Serialize)]
        #[serde(rename_all="camelCase")]
        struct Evidence{version:u32,action_id:String,input_sha256:String,input_bytes:u64,source:&'static str}
        let bytes=serde_json::to_vec(&Evidence{
            version:1,action_id:id,input_sha256:actual,input_bytes:len,
            source:"owned_windows_sha256_sidecar",
        }).map_err(|_|"Cannot serialize sidecar evidence.")?;
        if bytes.len()>MAX_RESULT{return Err("SHA result too large.".into());}
        let mut out=OpenOptions::new().write(true).create_new(true)
            .custom_flags(0x0020_0000).open(result)
            .map_err(|_|"Worker hash result already exists or unsafe.".to_string())?;
        out.write_all(&bytes).and_then(|_|out.sync_all())
            .map_err(|_|"Failed to flush SHA worker evidence.".to_string())
    }
}
