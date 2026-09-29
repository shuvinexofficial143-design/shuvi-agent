use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_PATH: usize = 32_768;
const MAX_FRAMES: usize = 16;
const MAX_DIMENSION: u32 = 16_384;
const MAX_HANDLE_FRAMES: u32 = 100_000;

fn clean_absolute(value:&str,label:&str)->Result<String,String>{
    if value.trim().is_empty() || value.len()>MAX_PATH || value.chars().any(|ch|matches!(ch,'\r'|'\n'|'\0')){
        return Err(format!("{label} is empty, oversized, or contains invalid control characters."));
    }
    let path=Path::new(value);
    if !path.is_absolute(){return Err(format!("{label} must be an absolute path."));}
    Ok(value.to_string())
}

pub fn validate_output_file(value:&str,overwrite:bool)->Result<String,String>{
    let output=clean_absolute(value,"Delivery output")?;
    let path=crate::premiere_export::bounded_absolute(&output)?;
    crate::premiere_export::valid_filename(path)?;
    if std::fs::symlink_metadata(path).is_ok_and(|m|m.file_type().is_symlink()) {return Err("Delivery output is a symbolic link.".into());}
    let parent=path.parent().ok_or("Delivery output has no parent directory.")?;
    if !parent.is_dir(){return Err("Delivery output parent directory does not exist.".into());}
    if path.exists()&&!overwrite{return Err("Delivery output already exists and overwrite=false.".into());}
    if path.is_dir(){return Err("Delivery output points to a directory, not a file.".into());}
    Ok(output)
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct AafOptions{
    pub audio_file_format:String,
    pub bits_per_sample:u32,
    pub embed_audio:bool,
    pub explode_to_mono:bool,
    pub handle_frames:u32,
    pub interleave_without_effects:bool,
    pub mixdown_video:bool,
    pub preserve_parent_folder:bool,
    pub render_audio_effects:bool,
    pub sample_rate:u32,
    pub trim_sources:bool,
    #[serde(default)]
    pub video_mixdown_preset_path:Option<String>,
}

impl AafOptions{
    pub fn validate(&self)->Result<(),String>{
        if !matches!(self.audio_file_format.as_str(),"aiff"|"wav"){
            return Err("AAF audio_file_format must be aiff or wav.".into());
        }
        if !matches!(self.bits_per_sample,16|24|32){
            return Err("AAF bits_per_sample must be 16, 24, or 32.".into());
        }
        if self.handle_frames>MAX_HANDLE_FRAMES{
            return Err("AAF handle_frames is outside the bounded limit.".into());
        }
        if !matches!(self.sample_rate,32000|44100|48000|88200|96000|176400|192000){
            return Err("AAF sample_rate is not in Shuvi's bounded professional allowlist.".into());
        }
        if let Some(path)=&self.video_mixdown_preset_path{
            let absolute=clean_absolute(path,"AAF video mixdown preset")?;
            if !Path::new(&absolute).is_file(){return Err("AAF video mixdown preset must be an existing absolute file.".into());}
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct InterchangeRequest{
    pub format:String,
    pub output:String,
    #[serde(default)]
    pub overwrite:bool,
    #[serde(default=true_bool)]
    pub suppress_ui:bool,
    #[serde(default)]
    pub aaf_options:Option<AafOptions>,
}
fn true_bool()->bool{true}

impl InterchangeRequest{
    pub fn validate(&self)->Result<(),String>{
        if !matches!(self.format.as_str(),"aaf"|"fcpxml"|"otio"){
            return Err("Interchange format must be aaf, fcpxml, or otio.".into());
        }
        validate_output_file(&self.output,self.overwrite)?;
        let extension=Path::new(&self.output).extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
        if !match self.format.as_str() { "fcpxml" => matches!(extension.as_str(),"xml"|"fcpxml"), "otio" => extension=="otio", "aaf" => extension=="aaf", _ => false } {
            return Err("Interchange output extension does not match its format.".into());
        }
        match self.format.as_str(){
            "aaf"=>{
                self.aaf_options.as_ref().ok_or("AAF export requires explicit aaf_options.")?.validate()?;
            }
            _ if self.aaf_options.is_some()=>return Err("AAF options are only valid for AAF export.".into()),
            _=>{}
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrameRequest{
    pub seconds:f64,
    pub output:String,
    pub width:u32,
    pub height:u32,
    #[serde(default)]
    pub overwrite:bool,
}
impl FrameRequest{
    pub fn validate(&self)->Result<(),String>{
        if !self.seconds.is_finite()||self.seconds<0.0||self.seconds>86_400.0{
            return Err("Frame export seconds must be between 0 and 86400.".into());
        }
        if self.width==0||self.height==0||self.width>MAX_DIMENSION||self.height>MAX_DIMENSION{
            return Err("Frame export dimensions must be between 1 and 16384.".into());
        }
        let output=validate_output_file(&self.output,self.overwrite)?;
        let ext=Path::new(&output).extension().and_then(|value|value.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(),"bmp"|"dpx"|"gif"|"jpg"|"exr"|"png"|"tga"|"tif"){
            return Err("Frame export format must be bmp, dpx, gif, jpg, exr, png, tga, or tif.".into());
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrameBatch{
    pub schema_version:u8,
    pub frames:Vec<FrameRequest>,
}
impl FrameBatch{
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1{return Err("Review frame batch schema_version must be 1.".into());}
        if self.frames.is_empty()||self.frames.len()>MAX_FRAMES{return Err("Review frame batch requires 1–16 frames.".into());}
        let mut outputs=HashSet::new();
        for frame in &self.frames{
            frame.validate()?;
            let path=PathBuf::from(&frame.output);
            let parent=std::fs::canonicalize(path.parent().ok_or("Frame path has no parent.")?).map_err(|e|e.to_string())?;
            let normalized=parent.join(path.file_name().ok_or("Frame filename missing.")?).to_string_lossy().to_string();
            #[cfg(windows)]
            let normalized=normalized.to_ascii_lowercase();
            if !outputs.insert(normalized){return Err("Review frame batch output paths must be unique.".into());}
        }
        Ok(())
    }
}

pub fn observed_file(path:&str)->serde_json::Value{
    match std::fs::metadata(path){
        Ok(meta)=>serde_json::json!({
            "observed":meta.is_file(),
            "size_bytes":meta.len(),
            "modified_ms":meta.modified().ok().and_then(|time|time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration|duration.as_millis() as u64)
        }),
        Err(error)=>serde_json::json!({"observed":false,"error":error.to_string()})
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn interchange_extensions_and_frame_aliases_fail_closed(){
        let dir=std::env::temp_dir().join(format!("shuvi-delivery-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let request=InterchangeRequest{format:"otio".into(),output:dir.join("wrong.xml").to_string_lossy().into(),overwrite:false,suppress_ui:true,aaf_options:None};
        assert!(request.validate().unwrap_err().contains("extension"));
        let frame=FrameRequest{seconds:0.0,output:dir.join("frame.png").to_string_lossy().into(),width:100,height:100,overwrite:false};
        let mut alias=frame.clone();alias.output=dir.join(".").join("frame.png").to_string_lossy().into();
        assert!(FrameBatch{schema_version:1,frames:vec![frame,alias]}.validate().is_err());
        assert!(validate_output_file(&dir.join("CON.png").to_string_lossy(),false).is_err());
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]fn rejects_bad_frame_format(){
        let request=FrameRequest{seconds:1.0,output:"C:/tmp/a.xyz".into(),width:1920,height:1080,overwrite:false};
        assert!(request.validate().is_err());
    }
    #[test]fn rejects_aaf_without_options(){
        let request=InterchangeRequest{format:"aaf".into(),output:"C:/tmp/a.aaf".into(),overwrite:false,suppress_ui:true,aaf_options:None};
        assert!(request.validate().is_err());
    }
    #[test]fn batch_limits_and_unique_outputs(){
        let frame=FrameRequest{seconds:1.0,output:"C:/tmp/a.png".into(),width:1920,height:1080,overwrite:false};
        let batch=FrameBatch{schema_version:1,frames:vec![frame.clone(),frame]};
        assert!(batch.validate().is_err());
    }
}
