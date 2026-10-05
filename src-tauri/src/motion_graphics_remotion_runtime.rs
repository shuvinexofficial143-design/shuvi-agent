use crate::motion_graphics::{DeliveryKind,Plan,RemotionPlanRequest};
use crate::motion_graphics_remotion::EvidenceRequest;
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{collections::BTreeMap,fs,path::{Path,PathBuf}};
use uuid::Uuid;

const PACKAGE_JSON:&[u8]=include_bytes!("../../remotion-runtime/package.json");
const RENDER_MJS:&[u8]=include_bytes!("../../remotion-runtime/render.mjs");
const INDEX_MJS:&[u8]=include_bytes!("../../remotion-runtime/src/index.mjs");
const RUNTIME_MJS:&[u8]=include_bytes!("../../remotion-runtime/src/runtime.mjs");
const MAX_PACKAGE_JSON_BYTES:u64=1024*1024;
const MAX_PATH_CHARS:usize=4096;
const MIN_TIMEOUT_MS:u64=5_000;
const MAX_TIMEOUT_MS:u64=3_600_000;
const REQUIRED_PACKAGES:[(&str,&str);5]=[
    ("remotion","4.0.532"),
    ("@remotion/bundler","4.0.532"),
    ("@remotion/renderer","4.0.532"),
    ("react","19.3.0"),
    ("react-dom","19.3.0"),
];

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionRequest{
    pub plan:Plan,
    #[serde(default)]
    pub asset_paths:BTreeMap<String,String>,
    pub runtime_dir:String,
    #[serde(default)]
    pub node_executable:Option<String>,
    pub output_file:String,
    #[serde(default="default_timeout_ms")]
    pub timeout_ms:u64,
}

fn default_timeout_ms()->u64{15*60*1000}

#[derive(Debug,Clone,Serialize)]
pub struct PreparedExecution{
    pub job_id:String,
    pub job_dir:String,
    pub node_program:String,
    pub render_script:String,
    pub manifest_path:String,
    pub output_file:String,
    pub evidence_path:String,
    pub preview_dir:String,
    pub timeout_ms:u64,
    pub dependency_versions:BTreeMap<String,String>,
    #[serde(skip_serializing)]
    pub evidence_request:EvidenceRequest,
}

fn path_text(value:&str,label:&str)->Result<PathBuf,String>{
    let trimmed=value.trim();
    if trimmed.is_empty()||trimmed.chars().count()>MAX_PATH_CHARS||trimmed.chars().any(char::is_control){
        return Err(format!("{label} must be a bounded control-character-free absolute path."));
    }
    let path=PathBuf::from(trimmed);
    if !path.is_absolute(){return Err(format!("{label} must be absolute."));}
    Ok(path)
}

fn bounded_json(path:&Path,label:&str)->Result<Value,String>{
    let meta=fs::metadata(path).map_err(|e|format!("Could not inspect {label}: {e}"))?;
    if !meta.is_file()||meta.len()==0||meta.len()>MAX_PACKAGE_JSON_BYTES{
        return Err(format!("{label} must be a non-empty regular JSON file no larger than 1 MB."));
    }
    let bytes=fs::read(path).map_err(|e|format!("Could not read {label}: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e|format!("{label} is invalid JSON: {e}"))
}

fn dependency_package_path(runtime:&Path,name:&str)->PathBuf{
    let mut path=runtime.join("node_modules");
    for segment in name.split('/'){path=path.join(segment);}
    path.join("package.json")
}

impl ExecutionRequest{
    pub fn validate(&self)->Result<(),String>{
        self.plan.validate()?;
        RemotionPlanRequest{plan:self.plan.clone(),asset_paths:self.asset_paths.clone()}.plan()?;
        let runtime=path_text(&self.runtime_dir,"Remotion runtime_dir")?;
        let output=path_text(&self.output_file,"Remotion output_file")?;
        if let Some(node)=self.node_executable.as_deref(){
            path_text(node,"Remotion node_executable")?;
        }
        if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&self.timeout_ms){
            return Err(format!("Remotion timeout_ms must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS}."));
        }
        let ext=output.extension().and_then(|v|v.to_str()).unwrap_or_default();
        match self.plan.delivery{
            DeliveryKind::StandaloneVideo if !ext.eq_ignore_ascii_case("mp4")=>
                return Err("Standalone Remotion output_file must end in .mp4.".into()),
            DeliveryKind::TransparentOverlay if !ext.eq_ignore_ascii_case("mov")=>
                return Err("Transparent Remotion output_file must end in .mov.".into()),
            _=>{}
        }
        if runtime==output||output.starts_with(&runtime.join(".shuvi-jobs")){
            return Err("Remotion output_file must be separate from Shuvi's runtime job workspace.".into());
        }
        Ok(())
    }
}

pub fn prepare(request:&ExecutionRequest)->Result<PreparedExecution,String>{
    request.validate()?;
    let runtime=path_text(&request.runtime_dir,"Remotion runtime_dir")?;
    if !runtime.is_dir(){return Err("Remotion runtime_dir does not exist or is not a directory.".into());}
    let package_path=runtime.join("package.json");
    let package_bytes=fs::read(&package_path).map_err(|e|format!("Could not read Remotion runtime package.json: {e}"))?;
    if package_bytes!=PACKAGE_JSON{
        return Err("Remotion runtime package.json does not match Shuvi's reviewed fixed runtime source.".into());
    }

    let mut dependency_versions=BTreeMap::new();
    for (name,required) in REQUIRED_PACKAGES{
        let value=bounded_json(&dependency_package_path(&runtime,name),&format!("{name} package.json"))?;
        let version=value.get("version").and_then(Value::as_str)
            .ok_or_else(||format!("{name} package.json has no version."))?;
        if version!=required{
            return Err(format!("Remotion runtime dependency {name} must be exactly {required}, found {version}."));
        }
        dependency_versions.insert(name.to_string(),version.to_string());
    }

    let node_program=if let Some(node)=request.node_executable.as_deref(){
        let path=path_text(node,"Remotion node_executable")?;
        if !path.is_file(){return Err("Remotion node_executable does not exist or is not a file.".into());}
        path.display().to_string()
    }else{"node".into()};

    let output=path_text(&request.output_file,"Remotion output_file")?;
    if output.exists(){return Err("Remotion output_file already exists; overwrite is intentionally refused.".into());}
    let parent=output.parent().ok_or("Remotion output_file has no parent directory.")?;
    if !parent.is_dir(){return Err("Remotion output_file parent directory does not exist.".into());}

    let jobs=runtime.join(".shuvi-jobs");
    fs::create_dir_all(&jobs).map_err(|e|format!("Could not create Remotion Shuvi jobs directory: {e}"))?;
    let job_id=Uuid::new_v4().to_string();
    let job_dir=jobs.join(&job_id);
    let src=job_dir.join("src");
    let preview=job_dir.join("preview");
    fs::create_dir_all(&src).map_err(|e|format!("Could not create Remotion job source directory: {e}"))?;
    fs::create_dir_all(&preview).map_err(|e|format!("Could not create Remotion preview directory: {e}"))?;
    fs::write(job_dir.join("render.mjs"),RENDER_MJS).map_err(|e|format!("Could not materialize fixed Remotion renderer: {e}"))?;
    fs::write(src.join("index.mjs"),INDEX_MJS).map_err(|e|format!("Could not materialize fixed Remotion entry source: {e}"))?;
    fs::write(src.join("runtime.mjs"),RUNTIME_MJS).map_err(|e|format!("Could not materialize fixed Remotion layer source: {e}"))?;

    let manifest=RemotionPlanRequest{plan:request.plan.clone(),asset_paths:request.asset_paths.clone()}.plan()?;
    let manifest_path=job_dir.join("manifest.json");
    let mut manifest_bytes=serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?;
    manifest_bytes.push(b'\n');
    fs::write(&manifest_path,manifest_bytes).map_err(|e|format!("Could not write deterministic Remotion manifest: {e}"))?;
    let evidence_path=job_dir.join("evidence.json");

    Ok(PreparedExecution{
        job_id,
        job_dir:job_dir.display().to_string(),
        node_program,
        render_script:job_dir.join("render.mjs").display().to_string(),
        manifest_path:manifest_path.display().to_string(),
        output_file:output.display().to_string(),
        evidence_path:evidence_path.display().to_string(),
        preview_dir:preview.display().to_string(),
        timeout_ms:request.timeout_ms,
        dependency_versions,
        evidence_request:EvidenceRequest{
            plan:request.plan.clone(),
            asset_paths:request.asset_paths.clone(),
            manifest_path:manifest_path.display().to_string(),
            evidence_path:evidence_path.display().to_string(),
        },
    })
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::motion_graphics::{Canvas,DeliveryKind,Renderer,ReviewSpec};

    fn base()->ExecutionRequest{
        let root=std::env::temp_dir().join("shuvi-remotion-runtime-test");
        ExecutionRequest{
            plan:Plan{
                schema_version:1,objective:"render".into(),renderer:Renderer::Remotion,duration_seconds:1.0,
                canvas:Canvas{width:640,height:360,fps:30.0,transparent_background:false},
                delivery:DeliveryKind::StandaloneVideo,scenes:vec![],
                review:ReviewSpec{sample_times_seconds:vec![],criteria:vec![]},
            },
            asset_paths:BTreeMap::new(),
            runtime_dir:root.display().to_string(),
            node_executable:None,
            output_file:root.join("out.mp4").display().to_string(),
            timeout_ms:10_000,
        }
    }

    #[test]
    fn execution_request_is_extension_and_timeout_guarded(){
        let mut request=base();
        assert!(request.validate().is_ok());
        request.output_file=PathBuf::from(&request.runtime_dir).join("out.mov").display().to_string();
        assert!(request.validate().is_err());
        request=base();request.timeout_ms=100;
        assert!(request.validate().is_err());
    }

    #[test]
    fn fixed_sources_are_compile_time_embedded(){
        assert!(PACKAGE_JSON.starts_with(b"{"));
        assert!(RENDER_MJS.windows(28).any(|w|w==b"arbitrary_provider_code_exe"));
        assert!(INDEX_MJS.windows(12).any(|w|w==b"registerRoot"));
        assert!(RUNTIME_MJS.windows(11).any(|w|w==b"OffthreadVi"));
    }
}
