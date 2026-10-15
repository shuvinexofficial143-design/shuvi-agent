//! Read-only Premiere export media validation bound to an existing native job.
 //! Media parsing or stable bytes do NOT prove Adobe encoder completion or full decode.
use serde_json::{json,Value};
use std::{path::Path,time::Duration};
use crate::premiere_media_relink::{self,MediaFingerprint};
use crate::premiere_export_jobs::Job;

pub fn eligible_job(job:&Job,expected_project_guid:&str,expected_sequence_guid:&str)->Result<(),String>{
    job.validate()?;
    if job.project_guid!=expected_project_guid||job.sequence_guid!=expected_sequence_guid{
        return Err("Export job is not bound to the exact expected Premiere project and sequence.".into());
    }
    if !matches!(job.bridge_state.as_str(),"accepted"|"queued"|"execution_status_unknown"){
        return Err("Export job has no accepted/queued or uncertain native dispatch record.".into());
    }
    let output=Path::new(&job.output);
    if !output.is_absolute()||output.extension().and_then(|v|v.to_str())
        .is_none_or(|v|!v.eq_ignore_ascii_case("mp4")){
        return Err("This delivery verifier only supports an exact .mp4 export job output.".into());
    }
    Ok(())
}
pub fn inspect(job:&Job,expected_project_guid:&str,expected_sequence_guid:&str)->Result<Value,String>{
    eligible_job(job,expected_project_guid,expected_sequence_guid)?;
    let before=premiere_media_relink::fingerprint(&job.output)?;
    let output_bytes=before.size_bytes;
    let media=crate::after_effects_media_validation::validate_with_budget(
        &job.output,Some(output_bytes),Duration::from_secs(9));
    let after=premiere_media_relink::fingerprint(&job.output)?;
    Ok(assess(job,&before,&after,&media))
}
pub fn assess(job:&Job,before:&MediaFingerprint,after:&MediaFingerprint,media:&Value)->Value{
    let file_unchanged=premiere_media_relink::same_file(before,after);
    let structural=media.get("media_structure_verified").and_then(Value::as_bool)==Some(true);
    let streams_parsed=media.get("media_parse_verified").and_then(Value::as_bool)==Some(true);
    let metadata_bound=media.get("size_bytes").and_then(Value::as_u64)==Some(after.size_bytes)
        &&media.get("output_file").and_then(Value::as_str)==Some(job.output.as_str());
    let bytes_and_metadata_verified=file_unchanged&&structural&&streams_parsed&&metadata_bound;
    let export_completion_verified=job.encoder_completion_verified; // Store currently cannot assert this.
    json!({
        "job_id":job.job_id,"project_guid":job.project_guid,"sequence_guid":job.sequence_guid,
        "output":job.output,"bridge_state":job.bridge_state,
        "output_existed_before_dispatch":job.output_existed_before,
        "source_output_sha256":after.sha256,"file_bytes_unchanged_during_probe":file_unchanged,
        "container_structure_verified":structural,"stream_metadata_parse_verified":streams_parsed,
        "media_metadata_bound_to_output":metadata_bound,
        "delivery_media_integrity_verified":bytes_and_metadata_verified,
        "full_media_decode_verified":false,"playback_verified":false,
        "encoder_completion_verified":export_completion_verified,
        "export_job_output_attribution_verified":false,
        "final_delivery_complete_verified":false,
        "retry_safe":false,
        "media_validation":media,
        "note":"Stable SHA256, MP4 structure and trusted ffprobe stream metadata are observational evidence. They do not prove full decode, Premiere/AME completion or a one-to-one encoder-job output correlation."
    })
}
#[cfg(test)]
mod tests{
    use super::*;
    use crate::premiere_export_jobs::Job;
    #[test]fn matching_mp4_metadata_does_not_upgrade_encoder_completion(){
        let job=Job::new("job-1".into(),"project-1","sequence-1",
            "/tmp/shuvi-test.mp4",None,false).unwrap();
        let f=MediaFingerprint{path:job.output.clone(),size_bytes:500,
            modified_ms:Some(5),sha256:"a".repeat(64)};
        let parsed=json!({"media_structure_verified":true,"media_parse_verified":true,
            "output_file":job.output,"size_bytes":500});
        let result=assess(&job,&f,&f,&parsed);
        assert_eq!(result["delivery_media_integrity_verified"],true);
        assert_eq!(result["final_delivery_complete_verified"],false);
        assert_eq!(result["encoder_completion_verified"],false);
        let mut changed=f.clone();changed.sha256="b".repeat(64);
        assert_eq!(assess(&job,&f,&changed,&parsed)["delivery_media_integrity_verified"],false);
    }
    #[test]fn reject_wrong_project_or_no_native_acceptance(){
        let job=Job::new("job-2".into(),"P","S","/tmp/shuvi-test.mp4",None,false).unwrap();
        assert!(eligible_job(&job,"P","S").is_err());
        assert!(eligible_job(&job,"wrong","S").is_err());
        let mut accepted=job.clone();accepted.bridge_state="accepted".into();
        assert!(eligible_job(&accepted,"P","S").is_ok());
        assert!(eligible_job(&accepted,"P","wrong").is_err());
    }
}
