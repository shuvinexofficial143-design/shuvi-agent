use crate::motion_graphics::{DeliveryKind,LayerKind,Plan,RemotionPlanRequest};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{
    collections::{BTreeMap,HashSet},
    fs::{self,File},
    io::Read,
    path::{Path,PathBuf},
};

const MAX_MANIFEST_BYTES:u64=4*1024*1024;
const MAX_EVIDENCE_BYTES:u64=1024*1024;
const MAX_PREVIEW_BYTES:u64=12*1024*1024;
const MAX_PREVIEW_FRAMES:usize=32;
const MAX_ASSET_SNAPSHOTS:usize=8_192;
const MAX_PATH_CHARS:usize=4_096;
const MAX_REVIEW_FRAME_BYTES:u64=8*1024*1024;
const MAX_MULTI_REVIEW_FRAMES:usize=8;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRequest {
    pub plan:Plan,
    #[serde(default)]
    pub asset_paths:BTreeMap<String,String>,
    pub manifest_path:String,
    pub evidence_path:String,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetSnapshot {
    layer_id:String,
    source_path:String,
    staged_name:String,
    sha256:String,
    bytes:u64,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewFrameEvidence {
    pub requested_time_seconds:f64,
    pub rendered_frame:u64,
    pub rendered_time_seconds:f64,
    pub file:String,
    pub bytes:u64,
    pub sha256:String,
}

#[derive(Debug,Clone)]
pub struct StagedPreviewFrame {
    pub requested_time_seconds:f64,
    pub rendered_time_seconds:f64,
    pub file:String,
    pub sha256:String,
    pub bytes:Vec<u8>,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalRenderEvidence {
    pub file:String,
    pub bytes:u64,
    pub sha256:String,
    pub codec:String,
    pub image_format:Option<String>,
    pub pixel_format_requested:Option<String>,
    pub prores_profile_requested:Option<String>,
    pub alpha_encoding_requested:bool,
    pub alpha_channel_probe_verified:bool,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeEvidence {
    schema_version:u8,
    adapter:String,
    manifest_file:String,
    manifest_sha256:String,
    composition_id:String,
    started_at:String,
    completed_at:String,
    asset_snapshots:Vec<AssetSnapshot>,
    scene_timeline_quantization:String,
    preview_frames:Vec<PreviewFrameEvidence>,
    preview_render_verified:bool,
    final_render:Option<FinalRenderEvidence>,
    render_output_verified:bool,
    renderer_execution_performed:bool,
    arbitrary_provider_code_executed:bool,
    fixed_runtime_source:bool,
    alpha_channel_probe_verified:bool,
    visual_review_verified:bool,
    production_ready:bool,
    unresolved:Vec<String>,
}

#[derive(Debug,Clone,Serialize)]
pub struct AcceptedEvidence {
    pub schema_version:u8,
    pub adapter:&'static str,
    pub manifest_path:String,
    pub evidence_path:String,
    pub manifest_sha256:String,
    pub preview_frames:Vec<PreviewFrameEvidence>,
    pub final_render:Option<FinalRenderEvidence>,
    pub receipt_binding_verified:bool,
    pub preview_files_sha256_verified:bool,
    pub final_output_sha256_verified:bool,
    pub renderer_execution_reported_by_receipt:bool,
    pub runtime_process_provenance_verified:bool,
    pub alpha_channel_probe_verified:bool,
    pub visual_review_verified:bool,
    pub production_ready:bool,
    pub unresolved:Vec<String>,
}

fn validate_path_text(value:&str,label:&str)->Result<PathBuf,String>{
    let trimmed=value.trim();
    if trimmed.is_empty()||trimmed.chars().count()>MAX_PATH_CHARS||trimmed.chars().any(char::is_control){
        return Err(format!("{label} must be a bounded control-character-free absolute path."));
    }
    let path=PathBuf::from(trimmed);
    if !path.is_absolute(){return Err(format!("{label} must be absolute."));}
    Ok(path)
}

fn bounded_read(path:&Path,max:u64,label:&str)->Result<Vec<u8>,String>{
    let metadata=fs::metadata(path).map_err(|e|format!("Could not inspect {label}: {e}"))?;
    if !metadata.is_file()||metadata.len()==0||metadata.len()>max{
        return Err(format!("{label} must be a non-empty regular file no larger than {max} bytes."));
    }
    fs::read(path).map_err(|e|format!("Could not read {label}: {e}"))
}

fn sha256_bytes(bytes:&[u8])->String{
    let mut hash=Sha256::new();
    hash.update(bytes);
    format!("{:x}",hash.finalize())
}

fn sha256_file(path:&Path,max:u64,label:&str)->Result<(u64,String),String>{
    let metadata=fs::metadata(path).map_err(|e|format!("Could not inspect {label}: {e}"))?;
    if !metadata.is_file()||metadata.len()==0||metadata.len()>max{
        return Err(format!("{label} must be a non-empty regular file no larger than {max} bytes."));
    }
    let mut file=File::open(path).map_err(|e|format!("Could not open {label}: {e}"))?;
    let mut hash=Sha256::new();
    let mut buffer=[0u8;1024*1024];
    loop{
        let read=file.read(&mut buffer).map_err(|e|format!("Could not hash {label}: {e}"))?;
        if read==0{break;}
        hash.update(&buffer[..read]);
    }
    Ok((metadata.len(),format!("{:x}",hash.finalize())))
}

fn canonical(path:&Path,label:&str)->Result<PathBuf,String>{
    fs::canonicalize(path).map_err(|e|format!("Could not canonicalize {label}: {e}"))
}

fn close(a:f64,b:f64)->bool{(a-b).abs()<=1e-9_f64.max(a.abs().max(b.abs())*1e-9)}

fn valid_sha256(value:&str)->bool{
    value.len()==64&&value.bytes().all(|b|b.is_ascii_hexdigit())
}

impl EvidenceRequest {
    pub fn validate(&self)->Result<(),String>{
        self.plan.validate()?;
        validate_path_text(&self.manifest_path,"Remotion manifest_path")?;
        validate_path_text(&self.evidence_path,"Remotion evidence_path")?;
        for (id,path) in &self.asset_paths {
            if id.trim().is_empty()||id.chars().count()>80||id.chars().any(char::is_control){
                return Err("Remotion evidence asset id is empty, oversized, or contains control characters.".into());
            }
            validate_path_text(path,"Remotion evidence asset path")?;
        }
        Ok(())
    }
}

fn verify_asset_snapshots(plan:&Plan,asset_paths:&BTreeMap<String,String>,rows:&[AssetSnapshot])->Result<(),String>{
    let expected=plan.scenes.iter().flat_map(|scene|scene.layers.iter())
        .filter(|layer|matches!(layer.kind,LayerKind::Image|LayerKind::Video))
        .collect::<Vec<_>>();
    if rows.len()!=expected.len()||rows.len()>MAX_ASSET_SNAPSHOTS{
        return Err("Remotion evidence asset snapshot count does not match media-layer count.".into());
    }
    let mut staged=HashSet::new();
    for (layer,row) in expected.iter().zip(rows) {
        if row.layer_id!=layer.id{return Err(format!("Remotion asset snapshot layer order/id mismatch for '{}'.",layer.id));}
        let asset_id=layer.asset_id.as_deref().ok_or_else(||format!("Media layer '{}' has no asset_id.",layer.id))?;
        let expected_path=asset_paths.get(asset_id).ok_or_else(||format!("Missing asset path for '{asset_id}'."))?;
        if row.source_path!=*expected_path{return Err(format!("Remotion asset snapshot source path mismatch for layer '{}'.",layer.id));}
        if row.bytes==0||!valid_sha256(&row.sha256){return Err(format!("Remotion asset snapshot hash/size is invalid for layer '{}'.",layer.id));}
        if row.staged_name.trim().is_empty()||row.staged_name.chars().count()>240||!staged.insert(row.staged_name.as_str()){
            return Err("Remotion evidence contains an invalid or duplicate staged asset name.".into());
        }
    }
    Ok(())
}

fn verify_preview_frames(plan:&Plan,rows:&[PreviewFrameEvidence])->Result<(),String>{
    let samples=&plan.review.sample_times_seconds;
    if rows.len()!=samples.len()||rows.len()>MAX_PREVIEW_FRAMES{
        return Err("Remotion evidence preview count does not match the exact plan review samples.".into());
    }
    let mut files=HashSet::<PathBuf>::new();
    for (index,(sample,row)) in samples.iter().zip(rows).enumerate(){
        if !close(*sample,row.requested_time_seconds){
            return Err(format!("Remotion preview sample {index} is not bound to the requested plan time."));
        }
        let max_frame=((plan.duration_seconds*plan.canvas.fps).ceil() as u64).saturating_sub(1);
        let expected_frame=((*sample*plan.canvas.fps).round().max(0.0) as u64).min(max_frame);
        if row.rendered_frame!=expected_frame{
            return Err(format!("Remotion preview sample {index} rendered_frame does not match the fixed runtime quantization."));
        }
        let expected_time=expected_frame as f64/plan.canvas.fps;
        if !close(row.rendered_time_seconds,expected_time){
            return Err(format!("Remotion preview sample {index} rendered_time_seconds is inconsistent."));
        }
        if row.bytes==0||row.bytes>MAX_PREVIEW_BYTES||!valid_sha256(&row.sha256){
            return Err(format!("Remotion preview sample {index} has invalid bounded file evidence."));
        }
        let path=validate_path_text(&row.file,"Remotion preview frame path")?;
        if path.extension().and_then(|v|v.to_str()).is_none_or(|v|!v.eq_ignore_ascii_case("png")){
            return Err(format!("Remotion preview sample {index} must reference a PNG."));
        }
        let canonical_path=canonical(&path,"Remotion preview frame")?;
        if !files.insert(canonical_path.clone()){return Err("Remotion evidence repeats a preview frame path.".into());}
        let bytes=bounded_read(&canonical_path,MAX_PREVIEW_BYTES,"Remotion preview frame")?;
        if bytes.len()<8||&bytes[..8]!=b"\x89PNG\r\n\x1a\n"{
            return Err(format!("Remotion preview sample {index} is not a PNG signature."));
        }
        if bytes.len() as u64!=row.bytes{return Err(format!("Remotion preview sample {index} byte count mismatch."));}
        if sha256_bytes(&bytes)!=row.sha256.to_ascii_lowercase(){
            return Err(format!("Remotion preview frame SHA-256 mismatch at sample {index}."));
        }
    }
    Ok(())
}

fn verify_final(plan:&Plan,row:&Option<FinalRenderEvidence>)->Result<bool,String>{
    let Some(row)=row else{return Ok(false);};
    if row.bytes==0||!valid_sha256(&row.sha256){return Err("Remotion final output has invalid hash/size evidence.".into());}
    let path=validate_path_text(&row.file,"Remotion final output path")?;
    let extension=path.extension().and_then(|v|v.to_str()).unwrap_or_default().to_ascii_lowercase();
    match plan.delivery {
        DeliveryKind::StandaloneVideo=>{
            if extension!="mp4"||row.codec!="h264"||row.image_format.is_some()||row.pixel_format_requested.is_some()
                ||row.prores_profile_requested.is_some()||row.alpha_encoding_requested||row.alpha_channel_probe_verified{
                return Err("Standalone Remotion final output does not match the fixed H.264 route.".into());
            }
        }
        DeliveryKind::TransparentOverlay=>{
            if extension!="mov"||row.codec!="prores"||row.image_format.as_deref()!=Some("png")
                ||row.pixel_format_requested.as_deref()!=Some("yuva444p10le")
                ||row.prores_profile_requested.as_deref()!=Some("4444")||!row.alpha_encoding_requested
                ||row.alpha_channel_probe_verified{
                return Err("Transparent Remotion final output does not match the fixed unprobed ProRes 4444 route.".into());
            }
        }
    }
    let (bytes,hash)=sha256_file(&path,u64::MAX,"Remotion final output")?;
    if bytes!=row.bytes{return Err("Remotion final output byte count mismatch.".into());}
    if hash!=row.sha256.to_ascii_lowercase(){return Err("Remotion final output SHA-256 mismatch.".into());}
    Ok(true)
}

pub fn verify(request:&EvidenceRequest)->Result<AcceptedEvidence,String>{
    request.validate()?;
    let manifest_path=validate_path_text(&request.manifest_path,"Remotion manifest_path")?;
    let evidence_path=validate_path_text(&request.evidence_path,"Remotion evidence_path")?;
    let manifest_bytes=bounded_read(&manifest_path,MAX_MANIFEST_BYTES,"Remotion manifest")?;
    let evidence_bytes=bounded_read(&evidence_path,MAX_EVIDENCE_BYTES,"Remotion evidence receipt")?;

    let manifest:Value=serde_json::from_slice(&manifest_bytes)
        .map_err(|e|format!("Remotion manifest is not strict JSON: {e}"))?;
    let expected=RemotionPlanRequest{plan:request.plan.clone(),asset_paths:request.asset_paths.clone()}.plan()?;
    if manifest!=expected{return Err("Remotion manifest does not exactly match the regenerated deterministic adapter output.".into());}

    let evidence:RuntimeEvidence=serde_json::from_slice(&evidence_bytes)
        .map_err(|e|format!("Remotion evidence receipt is invalid strict JSON: {e}"))?;
    if evidence.schema_version!=1||evidence.adapter!="shuvi_remotion_runtime"||evidence.composition_id!="ShuviMotion"{
        return Err("Remotion evidence receipt identity is invalid.".into());
    }
    if evidence.started_at.trim().is_empty()||evidence.completed_at.trim().is_empty()
        ||evidence.scene_timeline_quantization.trim().is_empty(){
        return Err("Remotion evidence receipt is missing bounded runtime metadata.".into());
    }
    if canonical(Path::new(&evidence.manifest_file),"receipt manifest_file")?!=canonical(&manifest_path,"request manifest_path")?{
        return Err("Remotion evidence manifest_file does not identify the exact supplied manifest.".into());
    }
    let manifest_sha=sha256_bytes(&manifest_bytes);
    if !valid_sha256(&evidence.manifest_sha256)||evidence.manifest_sha256.to_ascii_lowercase()!=manifest_sha{
        return Err("Remotion evidence manifest SHA-256 mismatch.".into());
    }
    if !evidence.renderer_execution_performed||evidence.arbitrary_provider_code_executed||!evidence.fixed_runtime_source
        ||evidence.visual_review_verified||evidence.production_ready||evidence.alpha_channel_probe_verified{
        return Err("Remotion evidence runtime safety flags are inconsistent with the fixed unreviewed runtime contract.".into());
    }

    verify_asset_snapshots(&request.plan,&request.asset_paths,&evidence.asset_snapshots)?;
    verify_preview_frames(&request.plan,&evidence.preview_frames)?;
    let expected_preview=!request.plan.review.sample_times_seconds.is_empty();
    if evidence.preview_render_verified!=expected_preview{
        return Err("Remotion evidence preview_render_verified does not match the exact review sample set.".into());
    }
    let final_verified=verify_final(&request.plan,&evidence.final_render)?;
    if evidence.render_output_verified!=final_verified{
        return Err("Remotion evidence render_output_verified is inconsistent with final_render.".into());
    }

    let unresolved=evidence.unresolved.iter().map(String::as_str).collect::<HashSet<_>>();
    if unresolved.len()!=evidence.unresolved.len()
        ||!unresolved.contains("claude_visual_review_binding_required")
        ||request.plan.delivery==DeliveryKind::TransparentOverlay&&!unresolved.contains("alpha_channel_probe_required")
        ||request.plan.delivery==DeliveryKind::StandaloneVideo&&unresolved.contains("alpha_channel_probe_required")
        ||unresolved.iter().any(|v|!matches!(*v,"claude_visual_review_binding_required"|"alpha_channel_probe_required")){
        return Err("Remotion evidence unresolved blocker set is inconsistent.".into());
    }

    Ok(AcceptedEvidence{
        schema_version:1,
        adapter:"remotion_evidence_binding",
        manifest_path:canonical(&manifest_path,"manifest")?.display().to_string(),
        evidence_path:canonical(&evidence_path,"evidence receipt")?.display().to_string(),
        manifest_sha256:manifest_sha,
        preview_frames:evidence.preview_frames,
        final_render:evidence.final_render,
        receipt_binding_verified:true,
        preview_files_sha256_verified:expected_preview,
        final_output_sha256_verified:final_verified,
        renderer_execution_reported_by_receipt:true,
        runtime_process_provenance_verified:false,
        alpha_channel_probe_verified:false,
        visual_review_verified:false,
        production_ready:false,
        unresolved:evidence.unresolved,
    })
}

pub fn verify_and_stage_review(request:&EvidenceRequest)->Result<(AcceptedEvidence,Vec<StagedPreviewFrame>),String>{
    let accepted=verify(request)?;
    if accepted.preview_frames.len()<2||accepted.preview_frames.len()>MAX_MULTI_REVIEW_FRAMES{
        return Err(format!("Remotion multi-frame review requires 2..={MAX_MULTI_REVIEW_FRAMES} verified preview frames."));
    }
    let mut staged=Vec::with_capacity(accepted.preview_frames.len());
    for (index,row) in accepted.preview_frames.iter().enumerate(){
        let path=validate_path_text(&row.file,"Remotion review frame path")?;
        let bytes=bounded_read(&path,MAX_REVIEW_FRAME_BYTES,"Remotion review frame")?;
        if bytes.len()<8||&bytes[..8]!=b"\x89PNG\r\n\x1a\n"{
            return Err(format!("Remotion review frame {index} lost its PNG signature after evidence verification."));
        }
        if bytes.len() as u64!=row.bytes||sha256_bytes(&bytes)!=row.sha256.to_ascii_lowercase(){
            return Err(format!("Remotion review frame {index} changed after evidence verification."));
        }
        staged.push(StagedPreviewFrame{
            requested_time_seconds:row.requested_time_seconds,
            rendered_time_seconds:row.rendered_time_seconds,
            file:row.file.clone(),
            sha256:row.sha256.clone(),
            bytes,
        });
    }
    Ok((accepted,staged))
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::motion_graphics::{Canvas,Easing,Keyframe,Layer,Property,Renderer,ReviewSpec,Scene,Track};
    use serde_json::json;
    use std::io::Write;

    fn plan()->Plan{
        Plan{
            schema_version:1,objective:"Bound preview evidence".into(),renderer:Renderer::Remotion,
            duration_seconds:2.0,canvas:Canvas{width:1280,height:720,fps:30.0,transparent_background:false},
            delivery:DeliveryKind::StandaloneVideo,
            scenes:vec![Scene{id:"scene".into(),start_seconds:0.0,duration_seconds:2.0,layers:vec![
                Layer{id:"title".into(),kind:LayerKind::Text,name:"Title".into(),text:Some("Hello".into()),
                    asset_id:None,shape:None,tracks:vec![Track{property:Property::Opacity,keyframes:vec![
                        Keyframe{time_seconds:0.0,value:0.0,easing:Easing::Linear},
                        Keyframe{time_seconds:1.0,value:1.0,easing:Easing::EaseOut},
                    ]}]}
            ]}],
            review:ReviewSpec{sample_times_seconds:vec![0.5,1.5],criteria:vec!["continuity".into()]},
        }
    }

    fn fixture()->(PathBuf,EvidenceRequest){
        let dir=std::env::temp_dir().join(format!("shuvi-remotion-evidence-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let p=plan();
        let manifest=RemotionPlanRequest{plan:p.clone(),asset_paths:BTreeMap::new()}.plan().unwrap();
        let manifest_path=dir.join("manifest.json");
        let manifest_text=serde_json::to_string_pretty(&manifest).unwrap()+"\n";
        fs::write(&manifest_path,&manifest_text).unwrap();
        let manifest_sha=sha256_bytes(manifest_text.as_bytes());
        let mut frames=vec![];
        for (index,time) in p.review.sample_times_seconds.iter().enumerate(){
            let frame=(*time*p.canvas.fps).round() as u64;
            let file=dir.join(format!("frame-{index}.png"));
            let mut handle=File::create(&file).unwrap();
            handle.write_all(b"\x89PNG\r\n\x1a\nfixture").unwrap();
            let bytes=fs::read(&file).unwrap();
            frames.push(json!({
                "requested_time_seconds":time,
                "rendered_frame":frame,
                "rendered_time_seconds":frame as f64/p.canvas.fps,
                "file":file.display().to_string(),
                "bytes":bytes.len(),
                "sha256":sha256_bytes(&bytes)
            }));
        }
        let evidence=json!({
            "schema_version":1,"adapter":"shuvi_remotion_runtime",
            "manifest_file":manifest_path.display().to_string(),"manifest_sha256":manifest_sha,
            "composition_id":"ShuviMotion","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T00:00:01Z",
            "asset_snapshots":[],"scene_timeline_quantization":"fixed","preview_frames":frames,
            "preview_render_verified":true,"final_render":null,"render_output_verified":false,
            "renderer_execution_performed":true,"arbitrary_provider_code_executed":false,"fixed_runtime_source":true,
            "alpha_channel_probe_verified":false,"visual_review_verified":false,"production_ready":false,
            "unresolved":["claude_visual_review_binding_required"]
        });
        let evidence_path=dir.join("evidence.json");
        fs::write(&evidence_path,serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
        (dir,EvidenceRequest{
            plan:p,asset_paths:BTreeMap::new(),
            manifest_path:manifest_path.display().to_string(),evidence_path:evidence_path.display().to_string()
        })
    }

    #[test]
    fn accepts_exact_manifest_receipt_and_preview_hashes(){
        let (dir,request)=fixture();
        let accepted=verify(&request).unwrap();
        assert!(accepted.receipt_binding_verified);
        assert!(accepted.preview_files_sha256_verified);
        assert!(!accepted.runtime_process_provenance_verified);
        let (_,frames)=verify_and_stage_review(&request).unwrap();
        assert_eq!(frames.len(),2);
        assert_eq!(frames[0].requested_time_seconds,0.5);
        assert!(!accepted.production_ready);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_preview_bytes_changed_after_receipt(){
        let (dir,request)=fixture();
        let evidence:RuntimeEvidence=serde_json::from_slice(&fs::read(&request.evidence_path).unwrap()).unwrap();
        let frame=PathBuf::from(&evidence.preview_frames[0].file);
        fs::write(&frame,b"\x89PNG\r\n\x1a\nchanged").unwrap();
        let error=verify(&request).unwrap_err();
        assert!(error.contains("byte count mismatch")||error.contains("SHA-256 mismatch"));
        fs::remove_dir_all(dir).unwrap();
    }
}
