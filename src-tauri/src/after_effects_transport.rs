use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::path::{Path,PathBuf};

const MAX_REQUEST_BYTES:usize=512*1024;
const MAX_RECEIPT_BYTES:usize=512*1024;
const MAX_ACTION_BYTES:usize=80;
const MAX_PATH_BYTES:usize=4096;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version:u8,
    pub request_id:String,
    pub action:String,
    #[serde(default)]
    pub expected_project_file:Option<String>,
    #[serde(default)]
    pub expected_project_revision:Option<u64>,
    #[serde(default)]
    pub args:Value,
}
impl Request {
    pub fn is_mutating(&self)->bool{
        matches!(self.action.as_str(),"set_property"|"set_values_at_times"|"set_expression"|"add_effect"|"remove_effect"|"add_null"|"add_text"
            |"add_shape"|"add_solid"|"add_camera"|"add_light"|"create_comp"|"set_comp_settings"|"import_footage"|"add_item_layer"
            |"create_project_folder"|"set_project_item_state"|"remove_project_item"
            |"set_layer_state"|"set_layer_parent"|"move_layer"|"set_track_matte"|"remove_track_matte"
            |"set_time_remap"|"replace_source"|"relink_footage"|"set_proxy"|"remove_proxy"|"set_av_layer_flags"|"set_av_layer_rendering"
            |"set_audio_gain"|"apply_audio_envelope"|"set_layer_input_stage"|"set_text_style"|"set_layer_timing"|"add_shape_primitive"|"add_text_animator"
            |"add_mogrt_property"|"add_mogrt_media_layer"|"export_mogrt"|"set_essential_property"|"set_essential_media_source"|"apply_essential_bindings"|"apply_hand_track_rig"
            |"set_keyframe_interpolation"|"set_keyframe_temporal_ease"|"set_keyframe_temporal_flags"|"set_keyframe_spatial"|"remove_keyframe"
            |"duplicate_layer"|"remove_layer"|"precompose_layers"|"add_mask"|"edit_mask"|"remove_mask"|"add_scene_edit_markers"
            |"add_marker"|"remove_marker"|"add_render_queue_item"|"render_queue"|"save_project")
    }
    pub fn is_read_only(&self)->bool{
        matches!(self.action.as_str(),"inspect_context"|"inspect_project_items"|"inspect_comp"|"inspect_effects"
            |"inspect_property"|"inspect_keyframes"|"inspect_layer_properties"|"inspect_av_layer_rendering"|"inspect_audio_levels"|"inspect_layer_input_stage"|"inspect_mogrt"|"inspect_essential_properties"|"inspect_scene_edits"|"inspect_markers"|"inspect_render_queue")
    }
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1
            || self.request_id.is_empty() || self.request_id.len()>80
            || !self.request_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
            || self.action.is_empty() || self.action.len()>MAX_ACTION_BYTES
            || !self.action.bytes().all(|b|b.is_ascii_lowercase()||b==b'_')
        {
            return Err("Invalid bounded After Effects request envelope.".into());
        }
        if !self.is_read_only() && !self.is_mutating() {
            return Err("Unsupported typed After Effects action.".into());
        }
        if self.is_mutating() && self.expected_project_file.is_none() {
            return Err("Mutating After Effects action requires expected_project_file.".into());
        }
        if self.is_mutating() && self.expected_project_revision.is_none_or(|v|v==0) {
            return Err("Mutating After Effects action requires expected_project_revision.".into());
        }
        if let Some(path)=&self.expected_project_file {
            crate::after_effects::validate_project_path(path)?;
        }
        let bytes=serde_json::to_vec(self).map_err(|e|e.to_string())?;
        if bytes.len()>MAX_REQUEST_BYTES{return Err("After Effects request exceeds 512 KiB.".into());}
        Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub schema_version:u8,
    pub request_id:String,
    pub ok:bool,
    #[serde(default)]
    pub host_version:Option<String>,
    #[serde(default)]
    pub result:Option<Value>,
    #[serde(default)]
    pub error:Option<String>,
}
impl Receipt {
    pub fn validate_for(&self,request:&Request)->Result<(),String>{
        request.validate()?;
        if self.schema_version!=1 || self.request_id!=request.request_id
            || self.host_version.as_ref().is_some_and(|s|s.is_empty()||s.len()>120)
            || self.error.as_ref().is_some_and(|s|s.is_empty()||s.len()>2000)
            || self.ok==(self.error.is_some())
            || self.ok!=(self.result.is_some())
        {
            return Err("Invalid or mismatched After Effects receipt.".into());
        }
        let bytes=serde_json::to_vec(self).map_err(|e|e.to_string())?;
        if bytes.len()>MAX_RECEIPT_BYTES{return Err("After Effects receipt exceeds 512 KiB.".into());}
        Ok(())
    }
}

#[derive(Clone,Debug,Serialize)]
pub struct RunnerPlan {
    pub request_path:PathBuf,
    pub receipt_path:PathBuf,
    pub runner_path:PathBuf,
    pub runner_script:String,
    pub afterfx_arguments:Vec<String>,
    pub runtime_verified:bool,
}

fn validate_absolute(path:&Path,label:&str)->Result<(),String>{
    let value=path.to_string_lossy();
    if !path.is_absolute() || value.is_empty() || value.len()>MAX_PATH_BYTES || value.chars().any(char::is_control){
        return Err(format!("{label} must be a bounded absolute path."));
    }
    Ok(())
}
fn js_string(value:&str)->Result<String,String>{
    serde_json::to_string(value).map_err(|e|e.to_string())
}

pub fn runner_plan(
    afterfx_exe:&Path,
    core_script:&Path,
    workspace:&Path,
    request:&Request,
)->Result<RunnerPlan,String>{
    request.validate()?;
    validate_absolute(afterfx_exe,"After Effects executable")?;
    validate_absolute(core_script,"After Effects core script")?;
    validate_absolute(workspace,"After Effects job workspace")?;
    if !afterfx_exe.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("afterfx.exe")){
        return Err("After Effects executable must be afterfx.exe.".into());
    }
    if !core_script.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("jsx")){
        return Err("After Effects core adapter must be a .jsx script.".into());
    }

    let prefix=format!("shuvi-ae-{}",request.request_id);
    let request_path=workspace.join(format!("{prefix}.request.json"));
    let receipt_path=workspace.join(format!("{prefix}.receipt.json"));
    let runner_path=workspace.join(format!("{prefix}.runner.jsx"));
    for (path,label) in [(&request_path,"request"),(&receipt_path,"receipt"),(&runner_path,"runner")] {
        validate_absolute(path,&format!("After Effects {label} path"))?;
    }

    let core=js_string(&core_script.to_string_lossy())?;
    let req=js_string(&request_path.to_string_lossy())?;
    let receipt=js_string(&receipt_path.to_string_lossy())?;
    let request_id=js_string(&request.request_id)?;
    let runner_script=format!(r#"(function(){{
var corePath={core};
var requestPath={req};
var receiptPath={receipt};
var expectedRequestId={request_id};
var receipt={{schema_version:1,request_id:expectedRequestId,ok:false,host_version:null,result:null,error:null}};
function writeReceipt(){{
    var out=new File(receiptPath);
    out.encoding="UTF-8";
    if(!out.open("w")) throw new Error("Could not open Shuvi AE receipt file.");
    try{{out.write(JSON.stringify(receipt));}}finally{{out.close();}}
}}
try{{
    if(typeof JSON==="undefined"||!JSON.parse||!JSON.stringify) throw new Error("JSON runtime unavailable in After Effects ExtendScript.");
    var input=new File(requestPath);
    input.encoding="UTF-8";
    if(!input.exists||!input.open("r")) throw new Error("Shuvi AE request file unavailable.");
    var raw;
    try{{raw=input.read();}}finally{{input.close();}}
    if(!raw||raw.length>524288) throw new Error("Shuvi AE request file empty or oversized.");
    var request=JSON.parse(raw);
    if(!request||request.request_id!==expectedRequestId) throw new Error("Shuvi AE request identity mismatch.");
    $.evalFile(new File(corePath));
    if(typeof ShuviAE==="undefined"||!ShuviAE.dispatch) throw new Error("Shuvi AE adapter failed to load.");
    receipt.result=ShuviAE.dispatch(request);
    receipt.host_version=String(app.version);
    receipt.ok=true;
}}catch(e){{
    receipt.ok=false;
    receipt.result=null;
    receipt.error=String(e&&e.message?e.message:e).slice(0,2000);
    try{{receipt.host_version=String(app.version);}}catch(ignore){{}}
}}
writeReceipt();
}})();"#);

    if runner_script.len()>64*1024{return Err("Generated After Effects runner exceeds safety bound.".into());}

    Ok(RunnerPlan{
        request_path,
        receipt_path,
        runner_path:runner_path.clone(),
        runner_script,
        afterfx_arguments:vec!["-r".into(),runner_path.to_string_lossy().into_owned()],
        runtime_verified:false,
    })
}

pub fn parse_receipt(bytes:&[u8],request:&Request)->Result<Receipt,String>{
    if bytes.is_empty()||bytes.len()>MAX_RECEIPT_BYTES{return Err("After Effects receipt is empty or oversized.".into());}
    let receipt:Receipt=serde_json::from_slice(bytes).map_err(|_|"Malformed After Effects receipt JSON.")?;
    receipt.validate_for(request)?;
    Ok(receipt)
}

#[cfg(test)]
mod tests{
    use super::*;
    fn request()->Request{Request{schema_version:1,request_id:"abc-123".into(),action:"inspect_context".into(),expected_project_file:None,expected_project_revision:None,args:Value::Object(Default::default())}}

    #[test]fn request_rejects_unbounded_or_injectable_identity(){
        request().validate().unwrap();
        assert!(request().is_read_only());
        assert!(!request().is_mutating());
        let mut bad=request();bad.request_id="a b".into();assert!(bad.validate().is_err());
        let mut bad=request();bad.action="inspect-context".into();assert!(bad.validate().is_err());
        let mut bad=request();bad.args=serde_json::json!({"x":"z".repeat(MAX_REQUEST_BYTES)});assert!(bad.validate().is_err());
    }

    #[test]fn mutations_require_saved_project_expectation_and_unknown_actions_fail_closed(){
        let mut mutation=request();mutation.action="set_values_at_times".into();
        assert!(mutation.validate().unwrap_err().contains("expected_project_file"));
        mutation.expected_project_file=Some(if cfg!(windows){r"C:\Work\edit.aep".into()}else{"/tmp/edit.aep".into()});
        assert!(mutation.validate().unwrap_err().contains("expected_project_revision"));
        mutation.expected_project_revision=Some(42);
        assert!(mutation.validate().is_ok());
        assert!(mutation.is_mutating());
        let mut unknown=request();unknown.action="do_anything".into();
        assert!(unknown.validate().unwrap_err().contains("Unsupported typed"));
    }

    #[test]fn runner_uses_exact_request_identity_and_afterfx_r(){
        let root=if cfg!(windows){PathBuf::from(r"C:\Shuvi\ae")}else{PathBuf::from("/tmp/shuvi-ae")};
        let exe=if cfg!(windows){PathBuf::from(r"C:\Program Files\Adobe\afterfx.exe")}else{PathBuf::from("/opt/Adobe/afterfx.exe")};
        let core=root.join("shuvi-ae.jsx");
        let plan=runner_plan(&exe,&core,&root,&request()).unwrap();
        assert_eq!(plan.afterfx_arguments[0],"-r");
        assert!(plan.runner_script.contains("request.request_id!==expectedRequestId"));
        assert!(plan.runner_script.contains("$.evalFile"));
        assert!(!plan.runtime_verified);
    }

    #[test]fn receipt_cannot_cross_request_or_fake_success(){
        let req=request();
        let ok=serde_json::to_vec(&serde_json::json!({
            "schema_version":1,"request_id":"abc-123","ok":true,"host_version":"26.5",
            "result":{"verification_status":"verified_readback"},"error":null
        })).unwrap();
        assert!(parse_receipt(&ok,&req).is_ok());
        let cross=serde_json::to_vec(&serde_json::json!({
            "schema_version":1,"request_id":"other","ok":true,"host_version":"26.5",
            "result":{},"error":null
        })).unwrap();
        assert!(parse_receipt(&cross,&req).is_err());
        let fake=serde_json::to_vec(&serde_json::json!({
            "schema_version":1,"request_id":"abc-123","ok":true,"host_version":"26.5",
            "result":null,"error":null
        })).unwrap();
        assert!(parse_receipt(&fake,&req).is_err());
    }
}
