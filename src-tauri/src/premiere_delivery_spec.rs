//! Read-only, exact-job technical delivery-spec acceptance for Premiere MP4.
 //! Never promotes file metadata conformance to Adobe encoder completion,
 //! correct edits, human playback or production delivery.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use crate::{premiere_export_jobs::Job,premiere_final_delivery};

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Spec {
    pub schema_version:u8,
    pub expected_duration_seconds:f64,
    pub duration_tolerance_seconds:f64,
    pub width:u32,
    pub height:u32,
    pub require_audio:bool,
}
impl Spec {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1
            ||!self.expected_duration_seconds.is_finite()
            ||!(1.0..=3600.0).contains(&self.expected_duration_seconds)
            ||!self.duration_tolerance_seconds.is_finite()
            ||self.duration_tolerance_seconds<0.0
            ||self.duration_tolerance_seconds>10.0
            ||self.duration_tolerance_seconds>self.expected_duration_seconds*0.1
            ||!(128..=8192).contains(&self.width)
            ||!(128..=8192).contains(&self.height){
            return Err("Technical delivery spec requires bounded 1..3600 second duration, <=10% or 10s tolerance, and dimensions 128..8192.".into());
        }
        Ok(())
    }
}
pub fn evaluate(spec:&Spec,job:&Job,media:&Value)->Value{
    let mut failed:Vec<&str>=Vec::new();
    let integrity=media.get("delivery_media_integrity_verified")
        .and_then(Value::as_bool)==Some(true)
        &&media.get("file_bytes_unchanged_during_probe")
            .and_then(Value::as_bool)==Some(true)
        &&media.get("stream_metadata_parse_verified")
            .and_then(Value::as_bool)==Some(true);
    if !integrity{failed.push("mp4_hash_structure_or_stream_probe_unverified");}
    let metadata=media.pointer("/media_validation/media_probe_evidence/metadata");
    let duration=metadata.and_then(|m|m.get("duration_seconds")).and_then(Value::as_f64);
    let duration_matches=duration.is_some_and(|d|d.is_finite()
        &&d>0.0&&(d-spec.expected_duration_seconds).abs()
            <=spec.duration_tolerance_seconds+0.000001);
    if !duration_matches{failed.push("output_duration_mismatch_or_missing");}
    let tracks=metadata.and_then(|m|m.get("streams")).and_then(Value::as_array);
    let video:Vec<&Value>=tracks.iter().flat_map(|rows|rows.iter())
        .filter(|row|row.get("codec_type").and_then(Value::as_str)==Some("video"))
        .collect();
    let audio:Vec<&Value>=tracks.iter().flat_map(|rows|rows.iter())
        .filter(|row|row.get("codec_type").and_then(Value::as_str)==Some("audio"))
        .collect();
    let width=video.first().and_then(|stream|stream.get("width")).and_then(Value::as_u64);
    let height=video.first().and_then(|stream|stream.get("height")).and_then(Value::as_u64);
    let video_matches=video.len()==1&&width==Some(u64::from(spec.width))
        &&height==Some(u64::from(spec.height));
    if !video_matches{failed.push("video_stream_count_or_dimensions_mismatch");}
    let audio_matches=!spec.require_audio||(!audio.is_empty()&&audio.iter().all(|row|
        row.get("channels").and_then(Value::as_u64).is_some_and(|n|n>=1)
        &&row.get("sample_rate").and_then(Value::as_u64).is_some_and(|n|n>=1)));
    if !audio_matches{failed.push("required_audio_stream_missing_or_invalid");}
    let spec_match=integrity&&duration_matches&&video_matches&&audio_matches;
    json!({
        "schema_version":1,
        "job_id":job.job_id,"project_guid":job.project_guid,
        "sequence_guid":job.sequence_guid,"output":job.output,
        "declared_delivery_spec":spec,
        "observed_duration_seconds":duration,
        "observed_video_width":width,"observed_video_height":height,
        "observed_video_stream_count":video.len(),
        "observed_audio_stream_count":audio.len(),
        "hash_and_stream_metadata_verified":integrity,
        "duration_within_tolerance":duration_matches,
        "video_dimensions_verified":video_matches,
        "required_audio_metadata_verified":audio_matches,
        "technical_spec_conformance_verified":spec_match,
        "unmet_checks":failed,
        "spec_was_known_before_export":false,
        "file_generated_by_this_export_job_verified":false,
        "full_video_audio_decode_verified":false,
        "encoder_completion_verified":false,
        "human_playback_verified":false,
        "subtitle_readability_verified":false,
        "graphics_render_quality_verified":false,
        "audio_mix_quality_verified":false,
        "final_delivery_ready":false,
        "read_only":true,
        "note":"Retrospective media technical conformance only. A user-declared spec and ffprobe metadata do not prove it was required before editing, that Adobe encoded this file, or that the video looks/sounds correct."
    })
}
pub fn inspect(job:&Job,project_guid:&str,sequence_guid:&str,spec:&Spec)->Result<Value,String>{
    spec.validate()?;
    // Project and sequence are bound to an existing native export UUID;
    // unchanged MP4 bytes + trusted stream metadata come from existing gate.
    let evidence=premiere_final_delivery::inspect(job,project_guid,sequence_guid)?;
    Ok(evaluate(spec,job,&evidence))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->(Job,Spec,Value){
        let path=std::env::temp_dir().join("shuvi40-spec.mp4");
        let mut job=Job::new("technical-qc".into(),"project-guid","sequence-guid",
            path.to_str().unwrap(),None,false).unwrap();
        job.bridge_state="accepted".into();
        let spec=Spec{schema_version:1,expected_duration_seconds:30.0,
            duration_tolerance_seconds:1.0,width:1920,height:1080,require_audio:true};
        let media=json!({"delivery_media_integrity_verified":true,
            "file_bytes_unchanged_during_probe":true,
            "stream_metadata_parse_verified":true,
            "media_validation":{"media_probe_evidence":{"metadata":{
                "duration_seconds":30.3,"streams":[
                    {"codec_type":"video","width":1920,"height":1080},
                    {"codec_type":"audio","channels":2,"sample_rate":48000}]}}}});
        (job,spec,media)
    }
    #[test]fn matching_30s_media_is_technical_only(){
        let (job,spec,media)=fixture();
        let report=evaluate(&spec,&job,&media);
        assert_eq!(report["technical_spec_conformance_verified"],true);
        assert_eq!(report["final_delivery_ready"],false);
        assert_eq!(report["file_generated_by_this_export_job_verified"],false);
        assert_eq!(report["human_playback_verified"],false);
    }
    #[test]fn different_duration_dimensions_or_missing_audio_are_rejected(){
        let (job,spec,mut media)=fixture();
        media["media_validation"]["media_probe_evidence"]["metadata"]["duration_seconds"]=json!(60.0);
        assert_eq!(evaluate(&spec,&job,&media)["technical_spec_conformance_verified"],false);
        media["media_validation"]["media_probe_evidence"]["metadata"]["duration_seconds"]=json!(30.0);
        media["media_validation"]["media_probe_evidence"]["metadata"]["streams"][0]["width"]=json!(1280);
        assert_eq!(evaluate(&spec,&job,&media)["technical_spec_conformance_verified"],false);
        media["media_validation"]["media_probe_evidence"]["metadata"]["streams"][0]["width"]=json!(1920);
        media["media_validation"]["media_probe_evidence"]["metadata"]["streams"].as_array_mut().unwrap().pop();
        assert_eq!(evaluate(&spec,&job,&media)["technical_spec_conformance_verified"],false);
    }
    #[test]fn unsupported_or_unbounded_specs_fail_before_any_file_access(){
        let (_,mut spec,_)=fixture();
        spec.expected_duration_seconds=f64::NAN;
        assert!(spec.validate().is_err());
        spec.expected_duration_seconds=30.0;spec.duration_tolerance_seconds=11.0;
        assert!(spec.validate().is_err());
        spec.duration_tolerance_seconds=1.0;spec.width=0;
        assert!(spec.validate().is_err());
        spec.width=1920;spec.height=1080;
        assert!(spec.validate().is_ok());
        spec.expected_duration_seconds=300.0;spec.duration_tolerance_seconds=5.0;
        assert!(spec.validate().is_ok());
    }
}
