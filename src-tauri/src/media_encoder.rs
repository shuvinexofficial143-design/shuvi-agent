use serde::{Deserialize,Serialize};
use std::{fs,path::Path};

const MAX_PATH:usize=32_768;
const MAX_PRESET_BYTES:u64=64*1024*1024;
const MAX_SOURCE_BYTES:u64=8*1024*1024*1024*1024;

fn clean_absolute<'a>(value:&'a str,label:&str)->Result<&'a Path,String>{
    if value.trim().is_empty()||value.len()>MAX_PATH||value.chars().any(|c|matches!(c,'\0'|'\r'|'\n')){
        return Err(format!("{label} must be a bounded absolute path without control characters."));
    }
    let path=Path::new(value);
    if !path.is_absolute(){return Err(format!("{label} must be absolute."));}
    Ok(path)
}

fn regular_non_symlink(path:&Path,label:&str,max_bytes:u64)->Result<u64,String>{
    let link=fs::symlink_metadata(path).map_err(|_|format!("{label} must exist."))?;
    if link.file_type().is_symlink(){return Err(format!("{label} must not be a symbolic link."));}
    let meta=fs::metadata(path).map_err(|_|format!("{label} metadata is unavailable."))?;
    if !meta.is_file(){return Err(format!("{label} must be a regular file."));}
    if meta.len()==0||meta.len()>max_bytes{return Err(format!("{label} size is outside Shuvi's bounded limit."));}
    Ok(meta.len())
}

#[derive(Debug,Clone,Serialize)]
pub struct PresetInspection{
    pub path:String,
    pub size_bytes:u64,
    pub extension:String,
    pub source_runtime_verified:bool,
}

pub fn inspect_preset(value:&str)->Result<PresetInspection,String>{
    let path=clean_absolute(value,"Media Encoder preset")?;
    if !path.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("epr")){
        return Err("Media Encoder preset must use the .epr extension.".into());
    }
    let size=regular_non_symlink(path,"Media Encoder preset",MAX_PRESET_BYTES)?;
    Ok(PresetInspection{
        path:value.into(),size_bytes:size,extension:"epr".into(),source_runtime_verified:false
    })
}

pub fn validate_source_file(value:&str)->Result<u64,String>{
    let path=clean_absolute(value,"Media Encoder source")?;
    regular_non_symlink(path,"Media Encoder source",MAX_SOURCE_BYTES)
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct FileEncodeRequest{
    pub input:String,
    pub output:String,
    pub preset:String,
    #[serde(default="default_entire")]
    pub range:String,
    #[serde(default)]
    pub in_seconds:Option<f64>,
    #[serde(default)]
    pub out_seconds:Option<f64>,
    #[serde(default)]
    pub remove_upon_completion:bool,
    #[serde(default)]
    pub start_queue_immediately:bool,
    #[serde(default)]
    pub overwrite:bool,
}
fn default_entire()->String{"entire".into()}

impl FileEncodeRequest{
    pub fn work_area_code(&self)->Result<u32,String>{
        match self.range.as_str(){
            "entire"=>Ok(0),
            "in_out"=>Ok(1),
            _=>Err("Media Encoder file range must be entire or in_out.".into()),
        }
    }
    pub fn validate(&self)->Result<(),String>{
        validate_source_file(&self.input)?;
        inspect_preset(&self.preset)?;
        crate::premiere_delivery::validate_output_file(&self.output,self.overwrite)?;
        if self.input.eq_ignore_ascii_case(&self.output)||self.preset.eq_ignore_ascii_case(&self.output){
            return Err("Media Encoder output must differ from input and preset paths.".into());
        }
        match self.work_area_code()?{
            0=>{
                if self.in_seconds.is_some()||self.out_seconds.is_some(){
                    return Err("range=entire must not include in_seconds/out_seconds.".into());
                }
            }
            1=>{
                let start=self.in_seconds.ok_or("range=in_out requires in_seconds.")?;
                let end=self.out_seconds.ok_or("range=in_out requires out_seconds.")?;
                if !start.is_finite()||!end.is_finite()||start<0.0||end<=start||end>86_400.0{
                    return Err("Media Encoder in/out range must be finite, ordered, and within 0..86400 seconds.".into());
                }
            }
            _=>unreachable!(),
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectItemEncodeRequest{
    pub item_id:String,
    pub output:String,
    pub preset:String,
    #[serde(default="default_entire")]
    pub range:String,
    #[serde(default)]
    pub remove_upon_completion:bool,
    #[serde(default)]
    pub start_queue_immediately:bool,
    #[serde(default)]
    pub overwrite:bool,
}

pub fn readiness_report()->serde_json::Value{
    serde_json::json!({
        "schema_version":1,
        "source_coding_status":"implemented_for_current_premiere_encodermanager_scope",
        "source_runtime_verified":false,
        "production_ready":false,
        "transport":{
            "current":"premiere_uxp_encoder_manager",
            "direct_media_encoder_uxp":"public_beta_future_adapter"
        },
        "features":{
            "detect_desktop_install":"source_supported_windows_programfiles_scan",
            "inspect_ame_availability":"source_supported_via_premiere_encoder_manager",
            "inspect_epr_preset":"source_supported_local_regular_file_plus_host_extension_when_sequence_available",
            "encode_sequence":"source_supported_via_existing_premiere_export_queue_to_ame",
            "encode_file":"source_supported_typed_entire_or_in_out",
            "encode_project_item":"source_supported_typed_entire_in_out_or_work_area",
            "launch_ame":"source_supported_when_premiere_26_3_plus_exposes_launch_encoder",
            "start_batch":"source_supported_when_premiere_26_3_plus_exposes_start_batch_encode",
            "xmp_flags":"source_supported_when_premiere_26_3_plus_exposes_setters",
            "queue_progress_events":"source_supported_bounded_observational_journal",
            "exact_native_job_ownership":"not_proven_premiere_boolean_encode_returns",
            "real_host_acceptance":"not_verified"
        },
        "boundaries":[
            "host acceptance does not prove encode completion",
            "single new queue event is only an unverified job candidate because external writers can race",
            "no documented stable Premiere EncoderManager cancel method is used",
            "direct Media Encoder UXP exact job IDs remain beta-only future adapter",
            "output existence or size alone does not prove playable media"
        ]
    })
}

#[cfg(target_os="windows")]
pub fn detect_installs()->Result<serde_json::Value,String>{
    let program_files=std::env::var_os("ProgramFiles").ok_or("ProgramFiles environment variable unavailable.")?;
    let adobe=Path::new(&program_files).join("Adobe");
    if !adobe.is_dir(){
        return Ok(serde_json::json!({"candidates":[],"runtime_verified":false}));
    }
    let mut candidates=Vec::new();
    for entry in fs::read_dir(&adobe).map_err(|e|format!("Could not inspect Adobe install folder: {e}"))?.take(128){
        let entry=entry.map_err(|e|e.to_string())?;
        let name=entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("Adobe Media Encoder"){continue;}
        let exe=entry.path().join("Adobe Media Encoder.exe");
        if exe.is_file(){
            candidates.push(serde_json::json!({
                "name":name,
                "media_encoder_exe":exe,
                "source":"ProgramFiles/Adobe",
                "runtime_verified":false
            }));
        }
    }
    Ok(serde_json::json!({"candidates":candidates,"runtime_verified":false}))
}

#[cfg(not(target_os="windows"))]
pub fn detect_installs()->Result<serde_json::Value,String>{
    Ok(serde_json::json!({
        "candidates":[],
        "runtime_verified":false,
        "reason":"Adobe Media Encoder desktop detection is Windows-targeted in Shuvi."
    }))
}

impl ProjectItemEncodeRequest{
    pub fn work_area_code(&self)->Result<u32,String>{
        match self.range.as_str(){
            "entire"=>Ok(0),
            "in_out"=>Ok(1),
            "work_area"=>Ok(2),
            _=>Err("Media Encoder project-item range must be entire, in_out, or work_area.".into()),
        }
    }
    pub fn validate(&self)->Result<(),String>{
        if self.item_id.trim().is_empty()||self.item_id.len()>512||self.item_id.chars().any(char::is_control){
            return Err("Media Encoder project item requires one bounded inspected item_id.".into());
        }
        inspect_preset(&self.preset)?;
        crate::premiere_delivery::validate_output_file(&self.output,self.overwrite)?;
        if self.preset.eq_ignore_ascii_case(&self.output){
            return Err("Media Encoder output must differ from the preset path.".into());
        }
        self.work_area_code()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    fn temp_dir()->std::path::PathBuf{
        let dir=std::env::temp_dir().join(format!("shuvi-ame-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();dir
    }
    #[test]
    fn preset_and_file_requests_fail_closed(){
        let dir=temp_dir();
        let preset=dir.join("preset.epr");fs::write(&preset,b"preset").unwrap();
        let input=dir.join("input.mov");fs::write(&input,b"media").unwrap();
        let output=dir.join("out.mp4");
        let mut request=FileEncodeRequest{
            input:input.to_string_lossy().into(),output:output.to_string_lossy().into(),
            preset:preset.to_string_lossy().into(),range:"entire".into(),in_seconds:None,out_seconds:None,
            remove_upon_completion:false,start_queue_immediately:false,overwrite:false
        };
        request.validate().unwrap();
        request.range="in_out".into();assert!(request.validate().is_err());
        request.in_seconds=Some(1.0);request.out_seconds=Some(2.0);request.validate().unwrap();
        request.out_seconds=Some(0.5);assert!(request.validate().is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn project_item_range_is_symbolic_and_bounded(){
        let dir=temp_dir();let preset=dir.join("preset.epr");fs::write(&preset,b"preset").unwrap();
        let output=dir.join("out.mp4");
        let mut request=ProjectItemEncodeRequest{
            item_id:"item".into(),output:output.to_string_lossy().into(),preset:preset.to_string_lossy().into(),
            range:"work_area".into(),remove_upon_completion:false,start_queue_immediately:false,overwrite:false
        };
        assert_eq!(request.work_area_code().unwrap(),2);request.validate().unwrap();
        request.range="guess".into();assert!(request.validate().is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
