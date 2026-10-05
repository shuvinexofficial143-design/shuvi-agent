use crate::motion_graphics::DeliveryKind;
use crate::motion_graphics_remotion::{self,AcceptedEvidence,EvidenceRequest};
use crate::motion_graphics_review::{self,MultiFrameReview,Verdict};
use serde::{Deserialize,Serialize};
use std::path::{Path,PathBuf};
use uuid::Uuid;

const MAX_ATTESTATION_BYTES:usize=64*1024;
const MAX_PATH_CHARS:usize=4096;

fn valid_sha256(value:&str)->bool{
    value.len()==64&&value.bytes().all(|b|b.is_ascii_hexdigit())
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

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlphaProbeRequest{
    pub evidence:EvidenceRequest,
    pub ffprobe_executable:String,
}

impl AlphaProbeRequest{
    pub fn validate(&self)->Result<AcceptedEvidence,String>{
        self.evidence.validate()?;
        if self.evidence.plan.delivery!=DeliveryKind::TransparentOverlay{
            return Err("Alpha probe is only valid for transparent-overlay delivery.".into());
        }
        let ffprobe=path_text(&self.ffprobe_executable,"ffprobe_executable")?;
        if !ffprobe.is_file(){return Err("ffprobe_executable does not exist or is not a file.".into());}
        let name=ffprobe.file_name().and_then(|v|v.to_str()).unwrap_or_default().to_ascii_lowercase();
        if !matches!(name.as_str(),"ffprobe"|"ffprobe.exe"){
            return Err("Alpha probe executable must be an exact ffprobe or ffprobe.exe file.".into());
        }
        let accepted=motion_graphics_remotion::verify(&self.evidence)?;
        if !accepted.final_output_sha256_verified||accepted.final_render.is_none(){
            return Err("Alpha probe requires a SHA-256 verified final Remotion output.".into());
        }
        Ok(accepted)
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlphaAttestation{
    pub schema_version:u8,
    pub action_id:String,
    pub manifest_sha256:String,
    pub output_file:String,
    pub output_sha256:String,
    pub codec_name:String,
    pub pixel_format:String,
    pub alpha_channel_probe_verified:bool,
}

impl AlphaAttestation{
    pub fn validate(&self)->Result<(),String>{
        Uuid::parse_str(&self.action_id).map_err(|_|"Invalid alpha attestation action ID.".to_string())?;
        path_text(&self.output_file,"alpha attestation output_file")?;
        if self.schema_version!=1||!valid_sha256(&self.manifest_sha256)||!valid_sha256(&self.output_sha256)
            ||self.codec_name.trim().is_empty()||self.codec_name.chars().count()>80
            ||self.pixel_format.trim().is_empty()||self.pixel_format.chars().count()>80
            ||!self.alpha_channel_probe_verified{
            return Err("Invalid bounded alpha-channel attestation.".into());
        }
        if self.codec_name!="prores"||!self.pixel_format.to_ascii_lowercase().starts_with("yuva"){
            return Err("Alpha attestation requires ProRes with a yuva* pixel format.".into());
        }
        Ok(())
    }

    pub fn matches(&self,accepted:&AcceptedEvidence)->Result<(),String>{
        self.validate()?;
        let final_render=accepted.final_render.as_ref().ok_or("Accepted evidence has no final render.")?;
        if self.manifest_sha256!=accepted.manifest_sha256
            ||self.output_file!=final_render.file
            ||self.output_sha256!=final_render.sha256{
            return Err("Alpha attestation does not bind the exact accepted manifest and output hash.".into());
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalAcceptanceRequest{
    pub render_action_id:String,
    pub evidence:EvidenceRequest,
    pub review:MultiFrameReview,
    pub frame_times_seconds:Vec<f64>,
    #[serde(default)]
    pub alpha_probe_action_id:Option<String>,
}

#[derive(Debug,Clone)]
pub struct ValidatedFinalRequest{
    pub accepted:AcceptedEvidence,
    pub plan_snapshot:String,
}

impl FinalAcceptanceRequest{
    pub fn validate(&self)->Result<ValidatedFinalRequest,String>{
        Uuid::parse_str(&self.render_action_id).map_err(|_|"Invalid Remotion render action ID.".to_string())?;
        if let Some(id)=self.alpha_probe_action_id.as_deref(){
            Uuid::parse_str(id).map_err(|_|"Invalid alpha probe action ID.".to_string())?;
        }
        let accepted=motion_graphics_remotion::verify(&self.evidence)?;
        if !accepted.final_output_sha256_verified||accepted.final_render.is_none(){
            return Err("Final Remotion acceptance requires SHA-256 verified final output evidence.".into());
        }
        motion_graphics_review::validate_multi_frame_review(&self.evidence.plan,&self.frame_times_seconds,&self.review)?;
        if self.review.verdict!=Verdict::Pass{
            return Err("Final Remotion acceptance requires a passing multi-frame visual review.".into());
        }
        match self.evidence.plan.delivery{
            DeliveryKind::StandaloneVideo if self.alpha_probe_action_id.is_some()=>
                return Err("Standalone-video final acceptance must not claim an alpha probe.".into()),
            DeliveryKind::TransparentOverlay if self.alpha_probe_action_id.is_none()=>
                return Err("Transparent-overlay final acceptance requires a verified alpha probe action.".into()),
            _=>{}
        }
        Ok(ValidatedFinalRequest{
            accepted,
            plan_snapshot:self.evidence.plan.fingerprint()?,
        })
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalAcceptance{
    pub schema_version:u8,
    pub acceptance_action_id:String,
    pub render_action_id:String,
    pub plan_snapshot:String,
    pub manifest_sha256:String,
    pub output_file:String,
    pub output_sha256:String,
    pub delivery:DeliveryKind,
    pub runtime_process_provenance_verified:bool,
    pub final_output_sha256_verified:bool,
    pub visual_review_verified:bool,
    pub alpha_channel_probe_verified:bool,
    pub delivery_acceptance_verified:bool,
    pub dependency_source_integrity_verified:bool,
    pub production_ready:bool,
}

impl FinalAcceptance{
    pub fn validate(&self)->Result<(),String>{
        Uuid::parse_str(&self.acceptance_action_id).map_err(|_|"Invalid final acceptance action ID.".to_string())?;
        Uuid::parse_str(&self.render_action_id).map_err(|_|"Invalid final render action ID.".to_string())?;
        path_text(&self.output_file,"final acceptance output_file")?;
        let snapshot=self.plan_snapshot.strip_prefix("fnv1a64:").unwrap_or_default();
        if self.schema_version!=1||snapshot.len()!=16||!snapshot.bytes().all(|b|b.is_ascii_hexdigit())
            ||!valid_sha256(&self.manifest_sha256)||!valid_sha256(&self.output_sha256)
            ||!self.runtime_process_provenance_verified||!self.final_output_sha256_verified
            ||!self.visual_review_verified||!self.delivery_acceptance_verified
            ||self.dependency_source_integrity_verified||self.production_ready{
            return Err("Invalid final Remotion acceptance attestation.".into());
        }
        if self.delivery==DeliveryKind::TransparentOverlay&&!self.alpha_channel_probe_verified{
            return Err("Transparent final acceptance requires verified alpha.".into());
        }
        if self.delivery==DeliveryKind::StandaloneVideo&&self.alpha_channel_probe_verified{
            return Err("Standalone final acceptance must not claim alpha verification.".into());
        }
        Ok(())
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PremiereInsertionPlanRequest{
    pub final_acceptance_action_id:String,
    pub seconds:f64,
    pub video_track:u32,
    pub audio_track:u32,
    pub mode:String,
}

impl PremiereInsertionPlanRequest{
    pub fn validate(&self)->Result<(),String>{
        Uuid::parse_str(&self.final_acceptance_action_id).map_err(|_|"Invalid final acceptance action ID.".to_string())?;
        if !self.seconds.is_finite()||self.seconds<0.0||self.seconds>86_400.0
            ||self.video_track>128||self.audio_track>128
            ||!matches!(self.mode.as_str(),"insert"|"overwrite"){
            return Err("Invalid bounded Premiere insertion plan request.".into());
        }
        Ok(())
    }

    pub fn plan(&self,acceptance:&FinalAcceptance)->Result<serde_json::Value,String>{
        self.validate()?;
        acceptance.validate()?;
        if acceptance.acceptance_action_id!=self.final_acceptance_action_id{
            return Err("Premiere insertion request does not identify the loaded final acceptance.".into());
        }
        Ok(serde_json::json!({
            "schema_version":1,
            "source":"verified_motion_graphics_delivery",
            "final_acceptance_action_id":acceptance.acceptance_action_id,
            "output_file":acceptance.output_file,
            "output_sha256":acceptance.output_sha256,
            "delivery":acceptance.delivery,
            "premiere_tool_proposal":{
                "tool":"premiere_insert_media",
                "arguments":{
                    "path":acceptance.output_file,
                    "seconds":self.seconds,
                    "video_track":self.video_track,
                    "audio_track":self.audio_track,
                    "mode":self.mode
                }
            },
            "automatic_execution":false,
            "requires_normal_premiere_approval":true,
            "production_ready":false
        }))
    }
}

pub fn save_alpha(path:&Path,value:&AlphaAttestation)->Result<(),String>{
    value.validate()?;
    let bytes=serde_json::to_vec(value).map_err(|e|format!("Could not encode alpha attestation: {e}"))?;
    if bytes.len()>MAX_ATTESTATION_BYTES{return Err("Alpha attestation exceeds the 64 KiB limit.".into());}
    crate::premiere_store::replace(path,&bytes,MAX_ATTESTATION_BYTES,|candidate|{
        let decoded:AlphaAttestation=serde_json::from_slice(candidate)
            .map_err(|e|format!("Invalid persisted alpha attestation: {e}"))?;
        decoded.validate()
    }).map_err(|e|format!("Alpha attestation persistence failed: {e}"))
}

pub fn load_alpha(path:&Path)->Result<AlphaAttestation,String>{
    let bytes=crate::read_file_bytes_bounded(path,MAX_ATTESTATION_BYTES,"alpha attestation")?;
    let value:AlphaAttestation=serde_json::from_slice(&bytes).map_err(|e|format!("Corrupt alpha attestation: {e}"))?;
    value.validate()?;
    Ok(value)
}

pub fn save_final(path:&Path,value:&FinalAcceptance)->Result<(),String>{
    value.validate()?;
    let bytes=serde_json::to_vec(value).map_err(|e|format!("Could not encode final motion acceptance: {e}"))?;
    if bytes.len()>MAX_ATTESTATION_BYTES{return Err("Final motion acceptance exceeds the 64 KiB limit.".into());}
    crate::premiere_store::replace(path,&bytes,MAX_ATTESTATION_BYTES,|candidate|{
        let decoded:FinalAcceptance=serde_json::from_slice(candidate)
            .map_err(|e|format!("Invalid persisted final motion acceptance: {e}"))?;
        decoded.validate()
    }).map_err(|e|format!("Final motion acceptance persistence failed: {e}"))
}

pub fn load_final(path:&Path)->Result<FinalAcceptance,String>{
    let bytes=crate::read_file_bytes_bounded(path,MAX_ATTESTATION_BYTES,"final motion acceptance")?;
    let value:FinalAcceptance=serde_json::from_slice(&bytes).map_err(|e|format!("Corrupt final motion acceptance: {e}"))?;
    value.validate()?;
    Ok(value)
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn premiere_plan_never_auto_executes(){
        let acceptance=FinalAcceptance{
            schema_version:1,
            acceptance_action_id:Uuid::new_v4().to_string(),
            render_action_id:Uuid::new_v4().to_string(),
            plan_snapshot:"fnv1a64:1111111111111111".into(),
            manifest_sha256:"a".repeat(64),
            output_file:std::env::temp_dir().join("overlay.mov").display().to_string(),
            output_sha256:"b".repeat(64),
            delivery:DeliveryKind::TransparentOverlay,
            runtime_process_provenance_verified:true,
            final_output_sha256_verified:true,
            visual_review_verified:true,
            alpha_channel_probe_verified:true,
            delivery_acceptance_verified:true,
            dependency_source_integrity_verified:false,
            production_ready:false,
        };
        let req=PremiereInsertionPlanRequest{
            final_acceptance_action_id:acceptance.acceptance_action_id.clone(),
            seconds:1.0,video_track:2,audio_track:0,mode:"overwrite".into()
        };
        let value=req.plan(&acceptance).unwrap();
        assert_eq!(value["automatic_execution"],false);
        assert_eq!(value["premiere_tool_proposal"]["tool"],"premiere_insert_media");
    }
}
