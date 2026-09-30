use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs, path::Path, time::{SystemTime, UNIX_EPOCH}};

const MAX_REPORT_BYTES: usize = 96 * 1024;
const MAX_EVIDENCE: usize = 64;
const SPECS: &[(&str, u8, bool, bool)] = &[
    ("bridge_pair",1,false,false),("project_inspection",1,true,false),
    ("sequence_inspection",1,true,false),("timeline_inspection",1,true,false),
    ("project_diagnostics",1,true,false),
    ("media_import",2,false,false),("trim",2,true,false),("delete_ripple",2,true,false),
    ("roll_edit",2,true,false),("move_clone",2,true,false),("subsequence",2,true,false),
    ("transition_add_remove",2,true,false),("video_effect_add_remove",3,true,false),
    ("static_parameter_set",3,true,false),("keyframes",3,true,false),
    ("audio_parameter_automation",4,true,false),("mogrt_insertion",5,true,false),
    ("mogrt_primitive_property_edit",5,true,false),
    ("transcript_export",6,true,false),("captions_srt_adapter",6,true,false),
    ("visual_review",7,false,false),("editorial_recipes",7,false,false),
    ("export_preflight",8,false,false),("export_immediate",8,true,false),
    ("export_ame",8,true,false),
    ("speed_write",2,false,true),("masks",3,true,false),
    ("vertical_track_move",2,true,false),("replacement_nesting",2,true,false),
    ("reliable_multicam",2,true,false),("linked_clip_membership",2,false,true),
    ("native_caption_write_import",6,true,false),("complex_mogrt_properties",5,true,false),
    ("scene_edit_detection",2,false,false),
];

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    pub name: String,
    pub group: u8,
    pub state: String,
    pub code_tested: bool,
    pub premiere_runtime_verified: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub timestamp_ms: u64,
    pub capability: String,
    pub action: String,
    pub result_category: String,
    pub premiere_version: Option<String>,
    pub project_guid: Option<String>,
    pub sequence_guid: Option<String>,
    pub native_capability: Option<String>,
    pub recovery: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub schema_version: u8,
    pub updated_at_ms: u64,
    pub capabilities: Vec<Capability>,
    pub evidence: Vec<Evidence>,
}

impl Default for Report {
    fn default() -> Self {
        Self {schema_version:1,updated_at_ms:now_ms(),
            capabilities:SPECS.iter().map(|(name,group,tested,unsupported)|Capability {
                name:(*name).into(),group:*group,
                state:if *unsupported {"unsupported_documented"} else {"implemented_unverified"}.into(),
                code_tested:*tested,premiere_runtime_verified:false,
                reason:unsupported.then(||"No verified safe typed adapter in the reviewed UXP surface.".into())
            }).collect(),evidence:vec![]}
    }
}

impl Report {
    /// Invoked only after the desktop executes an approved typed edit and receives
    /// a matching live native post-inspection on the same disposable project.
    pub fn verified_timeline_edit(&mut self,capability:&str,action:&str,version:&str,project:&str,
        sequence:&str,checkpoint:&str)->Result<(),String>{
        let native_capability=match (capability,action) {
            ("trim","premiere_trim_clip")=>"accepted typed trim; exact native timing reinspected",
            ("move_clone","premiere_move_clip")=>"accepted typed move; exact native timing offset reinspected",
            ("move_clone","premiere_clone_clip")=>"accepted typed clone; original plus offset duplicate reinspected",
            ("delete_ripple","premiere_delete_clip")=>"accepted typed ripple delete; full affected track media/timing delta reinspected",
            _=>return Err("Timeline acceptance requires an allowlisted verified edit/action pair.".into()),
        };
        if version.is_empty() || project.is_empty() || sequence.is_empty() || checkpoint.is_empty() || checkpoint.len()>1024 {
            return Err("Timeline acceptance requires a verified exact edit and checkpoint.".into());
        }
        let index=self.capabilities.iter().position(|c|c.name==capability).ok_or("Unknown acceptance capability.")?;
        self.capabilities[index].state="runtime_verified".into();
        self.capabilities[index].premiere_runtime_verified=true;
        self.capabilities[index].reason=None;
        self.append(Evidence {timestamp_ms:self.next_timestamp(),capability:capability.into(),action:action.into(),
            result_category:"runtime_verified".into(),premiere_version:Some(version.into()),
            project_guid:Some(project.into()),sequence_guid:Some(sequence.into()),
            native_capability:Some(native_capability.into()),
            recovery:Some("Checkpoint recorded; rollback and recovery not yet verified.".into())})
    }
    fn next_timestamp(&self) -> u64 {
        now_ms().max(self.evidence.last().map(|e|e.timestamp_ms.saturating_add(1)).unwrap_or(0))
    }
    pub fn validate(&self) -> Result<(),String> {
        if self.schema_version!=1 || self.capabilities.len()!=SPECS.len() || self.evidence.len()>MAX_EVIDENCE {
            return Err("Invalid Premiere acceptance report version or bounds.".into());
        }
        let mut seen=HashSet::new();
        for (cap, spec) in self.capabilities.iter().zip(SPECS) {
            if cap.name!=spec.0 || cap.group!=spec.1 || cap.code_tested!=spec.2 || !seen.insert(&cap.name)
                || !matches!(cap.state.as_str(),"not_implemented"|"implemented_unverified"|"runtime_verified"|"unsupported_documented"|"runtime_failed"|"blocked_environment")
                || cap.premiere_runtime_verified!=(cap.state=="runtime_verified")
                || cap.reason.as_ref().is_some_and(|v|v.len()>300)
                || (spec.3 && cap.state=="runtime_verified") {
                return Err("Invalid Premiere capability or fake runtime promotion.".into());
            }
        }
        for e in &self.evidence {
            if !SPECS.iter().any(|s|s.0==e.capability) || e.action.len()>80
                || (e.result_category=="runtime_verified" && !supported_evidence_pair(&e.capability,&e.action))
                || !matches!(e.result_category.as_str(),"runtime_verified"|"runtime_failed"|"blocked_environment")
                || [&e.premiere_version,&e.project_guid,&e.sequence_guid,&e.native_capability,&e.recovery]
                    .into_iter().flatten().any(|v|v.len()>240 || v.contains("sk-") || v.contains("Bearer ")) {
                return Err("Invalid, oversized or sensitive Premiere acceptance evidence.".into());
            }
        }
        for cap in &self.capabilities {
            if cap.state=="runtime_verified" && !self.evidence.iter().any(|e|
                e.capability==cap.name && e.result_category=="runtime_verified"
                    && e.premiere_version.as_ref().is_some_and(|v|!v.is_empty())
                    && e.project_guid.as_ref().is_some_and(|v|!v.is_empty())
                    && e.sequence_guid.as_ref().is_some_and(|v|!v.is_empty())) {
                return Err("Runtime verified without host evidence.".into());
            }
        }
        let data=serde_json::to_vec(self).map_err(|e|e.to_string())?;
        if data.len()>MAX_REPORT_BYTES {return Err("Premiere acceptance report exceeds 96 KiB.".into());}
        Ok(())
    }

    fn append(&mut self, evidence: Evidence) -> Result<(),String> {
        if self.evidence.iter().any(|e|e.capability==evidence.capability && e.action==evidence.action
            && e.project_guid==evidence.project_guid && e.sequence_guid==evidence.sequence_guid
            && e.result_category==evidence.result_category && e.timestamp_ms==evidence.timestamp_ms) {
            return Err("Duplicate Premiere acceptance evidence.".into());
        }
        if self.evidence.len()==MAX_EVIDENCE {
            let removable=self.evidence.iter().position(|old| {
                if old.result_category!="runtime_verified" {return true;}
                let verified=self.capabilities.iter().any(|c|c.name==old.capability && c.premiere_runtime_verified);
                !verified || self.evidence.iter().filter(|e|e.capability==old.capability && e.result_category=="runtime_verified").count()>1
            }).ok_or("Premiere evidence history is full of required verification records.")?;
            self.evidence.remove(removable);
        }
        self.evidence.push(evidence);
        self.updated_at_ms=now_ms();
        self.validate()
    }

    /// Called only by a desktop bridge probe after a real paired host response.
    pub fn verified_probe(&mut self, capability:&str, action:&str, version:&str, project:&str, sequence:&str) -> Result<(),String> {
        if !matches!((capability,action),
            ("bridge_pair","inspect_context")|("project_inspection","inspect_context")|
            ("sequence_inspection","inspect_context")|("timeline_inspection","inspect_timeline")|
            ("project_diagnostics","project_diagnostics")) || version.is_empty() || project.is_empty() || sequence.is_empty() {
            return Err("Runtime verification needs a live paired host response and exact identities.".into());
        }
        let index=self.capabilities.iter().position(|c|c.name==capability).ok_or("Unknown capability.")?;
        self.capabilities[index].state="runtime_verified".into();
        self.capabilities[index].premiere_runtime_verified=true;
        self.capabilities[index].reason=None;
        self.append(Evidence {timestamp_ms:self.next_timestamp(),capability:capability.into(),action:action.into(),
            result_category:"runtime_verified".into(),premiere_version:Some(version.into()),
            project_guid:Some(project.into()),sequence_guid:Some(sequence.into()),
            native_capability:Some("paired UXP returned structured data".into()),recovery:None})
    }

    pub fn verified_scene_detection(&mut self, action:&str, version:&str, project:&str, sequence:&str,
        checkpoint:&str, marker_count:usize, selection_restored:bool) -> Result<(),String> {
        if action!="premiere_detect_scene_markers" || version.is_empty() || project.is_empty() || sequence.is_empty()
            || checkpoint.is_empty() || checkpoint.len()>1024 || marker_count==0 || marker_count>1000 || !selection_restored {
            return Err("Scene detection acceptance requires observed native marker delta, restored selection and checkpoint.".into());
        }
        let capability="scene_edit_detection";
        let index=self.capabilities.iter().position(|c|c.name==capability).ok_or("Unknown acceptance capability.")?;
        self.capabilities[index].state="runtime_verified".into();
        self.capabilities[index].premiere_runtime_verified=true;
        self.capabilities[index].reason=None;
        self.append(Evidence {timestamp_ms:self.next_timestamp(),capability:capability.into(),action:action.into(),
            result_category:"runtime_verified".into(),premiere_version:Some(version.into()),
            project_guid:Some(project.into()),sequence_guid:Some(sequence.into()),
            native_capability:Some(format!("Native scene marker detection produced {marker_count} observed marker delta(s); selection restored.")),
            recovery:Some("Checkpoint retained; generated markers remain until explicitly removed.".into())})
    }

    pub fn native_failure(&mut self, capability:&str, action:&str, version:&str, project:&str, sequence:&str, reason:&str) -> Result<(),String> {
        if !matches!((capability,action),("timeline_inspection","inspect_timeline")|("project_diagnostics","project_diagnostics"))
            || version.is_empty() || project.is_empty() || sequence.is_empty() || reason.is_empty() || reason.len()>200 {
            return Err("Runtime failure requires explicit bounded host evidence.".into());
        }
        let index=self.capabilities.iter().position(|c|c.name==capability).ok_or("Unknown capability.")?;
        self.capabilities[index].state="runtime_failed".into();
        self.capabilities[index].premiere_runtime_verified=false;
        self.capabilities[index].reason=Some(reason.into());
        self.append(Evidence {timestamp_ms:self.next_timestamp(),capability:capability.into(),action:action.into(),
            result_category:"runtime_failed".into(),premiere_version:Some(version.into()),
            project_guid:Some(project.into()),sequence_guid:Some(sequence.into()),
            native_capability:None,recovery:Some("Inspect before retry; no automatic mutation.".into())})
    }

    pub fn blocked(&mut self, group:u8, reason:&str) -> Result<(),String> {
        if !(1..=8).contains(&group) || reason.is_empty() || reason.len()>200 {return Err("Invalid acceptance block reason.".into());}
        for cap in &mut self.capabilities {
            if cap.group==group && cap.state=="implemented_unverified" {
                cap.state="blocked_environment".into();cap.reason=Some(reason.into());
            }
        }
        self.append(Evidence {timestamp_ms:self.next_timestamp(),capability:self.capabilities.iter().find(|c|c.group==group).unwrap().name.clone(),
            action:format!("group_{group}"),result_category:"blocked_environment".into(),
            premiere_version:None,project_guid:None,sequence_guid:None,
            native_capability:None,recovery:Some(reason.into())})
    }

    pub fn verified_count(&self) -> usize {self.capabilities.iter().filter(|c|c.premiere_runtime_verified).count()}
}

pub fn known_verification_gaps() -> Value {
    serde_json::json!({
        "caption_track_text_write":{"state":"unsupported_documented","retry_safe":false,
            "reason":"Caption source files can be imported and verified as project items, but the reviewed CaptionTrack API has no native text/cue creation or edit action."},
        "multicam_creation_switching":{"state":"unsupported_documented","retry_safe":false,
            "reason":"Current reviewed UXP exposes isMulticamClip() for existing items but no native multicam creation or angle-switch action."},
        "mask_creation_editing":{"state":"unsupported_documented","retry_safe":false,
            "reason":"Premiere 26.3 ObjectMaskUtils exposes hasObjectMask presence inspection, not a reviewed native mask creation/edit route."},
        "project_save_persistence":{"state":"accepted_unverified","retry_safe":false,
            "reason":"Native Project.save() success is not an independent persisted-file readback."},
        "video_transition_presence":{"state":"accepted_unverified","retry_safe":false,
            "reason":"No reviewed stable transition presence/removal inspection is available in the current adapter."},
        "source_in_out":{"state":"accepted_unverified","retry_safe":false,
            "reason":"No reviewed independent source-bound in/out getter is available in the current adapter."},
        "scale_to_frame":{"state":"accepted_unverified","retry_safe":false,
            "reason":"No dedicated scale-to-frame state getter is available in the current adapter."},
        "stable_track_identity":{"state":"not_established",
            "reason":"Track index/name observations are not promoted to a stable native track UUID."},
        "export_completion":{"state":"not_verified","retry_safe":false,
            "reason":"Observed output files do not prove encoder completion or encoded-media validity."},
        "windows_premiere_runtime":{"state":"not_verified",
            "reason":"Current source revision still requires fresh Windows/Premiere host acceptance evidence."}
    })
}

pub fn evidence_dimensions(report: &Report, recovery_count: usize, export_count: usize) -> Value {
    serde_json::json!({
        "source_implementation":{"state":"CODE_PRESENT","completion_percentage":null},
        "static_schema_tests":{"state":"not_verified","current_revision_attestation":false},
        "mock_tests":{"state":"not_verified","coverage_declarations_are_run_evidence":false},
        "rust_unit_tests":{"state":"not_verified"},
        "frontend_tests":{"state":"not_verified"},
        "windows_runtime":{"state":"not_verified"},
        "uxp_bridge_pairing":{"state":"not_verified","historical_evidence_count":report.evidence.iter().filter(|e|e.capability=="bridge_pair"&&e.result_category=="runtime_verified").count()},
        "native_mutation_acceptance":{"state":"not_verified","historical_verified_capabilities":report.capabilities.iter().filter(|c|c.group!=1&&c.premiere_runtime_verified).count()},
        "checkpoint_recovery":{"state":"not_verified","historical_verified_entries":recovery_count},
        "export_completion":{"state":"not_verified","historical_verified_jobs":export_count},
        "cancellation":{"state":"not_verified"},
        "known_unsupported":report.capabilities.iter().filter(|c|c.state=="unsupported_documented").map(|c|c.name.as_str()).collect::<Vec<_>>(),
        "current_source_revision_bound":false,"production_ready":false
    })
}

fn supported_evidence_pair(capability: &str, action: &str) -> bool {
    matches!((capability, action),
        ("bridge_pair","inspect_context") | ("project_inspection","inspect_context") |
        ("sequence_inspection","inspect_context") | ("timeline_inspection","inspect_timeline") |
        ("project_diagnostics","project_diagnostics") | ("trim","premiere_trim_clip") |
        ("move_clone","premiere_move_clip") | ("move_clone","premiere_clone_clip") |
        ("delete_ripple","premiere_delete_clip") |
        ("scene_edit_detection","premiere_detect_scene_markers"))
}

pub fn host_probe_identity(context:&Value,timeline:&Value,diagnostics:&Value) -> Result<(String,String,String),String> {
    let version=context.get("premiereVersion").and_then(Value::as_str).filter(|v|!v.is_empty())
        .ok_or("Premiere version unavailable.")?;
    let project=context.get("projectGuid").and_then(Value::as_str).filter(|v|!v.is_empty())
        .ok_or("Active Premiere project unavailable.")?;
    let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).filter(|v|!v.is_empty())
        .ok_or("Active Premiere sequence unavailable.")?;
    if context.get("projectDetected").and_then(Value::as_bool)!=Some(true)
        || context.get("sequenceDetected").and_then(Value::as_bool)!=Some(true)
        || context.pointer("/capabilities/targetExpectations").and_then(Value::as_u64)!=Some(1)
        || timeline.get("sequenceGuid").and_then(Value::as_str)!=Some(sequence)
        || timeline.pointer("/expected/project_guid").and_then(Value::as_str)!=Some(project)
        || timeline.pointer("/expected/sequence_guid").and_then(Value::as_str)!=Some(sequence)
        || !timeline.get("videoTracks").is_some_and(Value::is_array)
        || !timeline.get("audioTracks").is_some_and(Value::is_array)
        || diagnostics.pointer("/project/guid").and_then(Value::as_str)!=Some(project)
        || diagnostics.pointer("/activeSequence/guid").and_then(Value::as_str)!=Some(sequence)
        || diagnostics.get("readOnly").and_then(Value::as_bool)!=Some(true) {
        return Err("Host probe identity, shape or read-only contract changed.".into());
    }
    if context.get("projectPath").and_then(Value::as_str).is_some_and(|p|
        timeline.pointer("/expected/project_path").and_then(Value::as_str)!=Some(p)) {
        return Err("Host project path changed during acceptance probe.".into());
    }
    Ok((version.into(),project.into(),sequence.into()))
}

fn current_report(mut report:Report)->Result<Report,String>{
    if report.schema_version!=1 {return Err("Unsupported Premiere acceptance report version.".into());}
    if report.capabilities.len()==SPECS.len() {
        report.validate()?;
        return Ok(report);
    }
    if report.capabilities.len()+1!=SPECS.len()
        || report.capabilities.iter().any(|c|c.name=="scene_edit_detection")
        || !report.capabilities.iter().zip(SPECS.iter()).all(|(cap,spec)|
            cap.name==spec.0 && cap.group==spec.1 && cap.code_tested==spec.2)
    {
        return Err("Premiere acceptance report does not match the current or immediately previous capability schema.".into());
    }
    let fresh=Report::default().capabilities.last().cloned().ok_or("Acceptance capability defaults unavailable.")?;
    report.capabilities.push(fresh);
    report.validate()?;
    Ok(report)
}

pub fn load(path:&Path) -> Result<Report,String> {
    if !path.exists() && !path.with_extension("json.bak").exists() {return Ok(Report::default());}
    let read=|p:&Path| -> Result<Report,String> {
        let bytes=crate::read_file_bytes_bounded(p, MAX_REPORT_BYTES, "Premiere persisted state")?;
        if bytes.len()>MAX_REPORT_BYTES {return Err("Oversized Premiere acceptance file.".into());}
        let report:Report=serde_json::from_slice(&bytes).map_err(|e|format!("Corrupt Premiere acceptance report: {e}"))?;
        current_report(report)
    };
    read(path).or_else(|e|if path.with_extension("json.bak").exists(){read(&path.with_extension("json.bak"))}else{Err(e)})
}

pub fn save(path:&Path,report:&Report) -> Result<(),String> {
    report.validate()?;
    let bytes=serde_json::to_vec(report).map_err(|e|e.to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_REPORT_BYTES,|data|{
        let report:Report=serde_json::from_slice(data).map_err(|e|e.to_string())?;
        current_report(report).map(|_|())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn declarations_and_historical_evidence_do_not_promote_current_build() {
        let mut r=Report::default();
        r.verified_probe("project_inspection","inspect_context","26.3","p","s").unwrap();
        let dimensions=evidence_dimensions(&r,1,1);
        for key in ["static_schema_tests","mock_tests","rust_unit_tests","frontend_tests","windows_runtime",
            "uxp_bridge_pairing","native_mutation_acceptance","checkpoint_recovery","export_completion","cancellation"] {
            assert_eq!(dimensions[key]["state"],"not_verified");
        }
        assert_eq!(dimensions["production_ready"],false);
        r.evidence[0].action="unrelated_action".into();
        assert!(r.validate().is_err());
    }
    #[test] fn host_shape_checks_identity_and_read_only() {
        let context=json!({"premiereVersion":"25.6","projectDetected":true,"sequenceDetected":true,
            "projectGuid":"p","projectPath":"C:/test.prproj","activeSequence":{"guid":"s"},
            "capabilities":{"targetExpectations":1}});
        let timeline=json!({"sequenceGuid":"s","expected":{"project_guid":"p","project_path":"C:/test.prproj",
            "sequence_guid":"s"},"videoTracks":[],"audioTracks":[]});
        let diagnostics=json!({"readOnly":true,"project":{"guid":"p"},"activeSequence":{"guid":"s"}});
        assert!(host_probe_identity(&context,&timeline,&diagnostics).is_ok());
        let mut stale=timeline.clone();stale["sequenceGuid"]=json!("other");
        assert!(host_probe_identity(&context,&stale,&diagnostics).is_err());
        let mut stale=diagnostics.clone();stale["project"]["guid"]=json!("other");
        assert!(host_probe_identity(&context,&timeline,&stale).is_err());
        let mut unsafe_diag=diagnostics.clone();unsafe_diag["readOnly"]=json!(false);
        assert!(host_probe_identity(&context,&timeline,&unsafe_diag).is_err());
    }
    #[test] fn states_and_real_probe_guard() {
        let mut r=Report::default();
        assert_eq!(r.verified_count(),0);
        assert!(r.verified_probe("trim","inspect_context","25.6","p","s").is_err());
        assert!(r.verified_probe("project_inspection","inspect_context","","p","s").is_err());
        r.verified_probe("project_inspection","inspect_context","25.6","p","s").unwrap();
        assert_eq!(r.verified_count(),1);
        assert!(!r.capabilities.iter().find(|c|c.name=="trim").unwrap().premiere_runtime_verified);
        r.blocked(2,"No provably disposable test project.").unwrap();
        assert_eq!(r.capabilities.iter().find(|c|c.name=="trim").unwrap().state,"blocked_environment");
    }
    #[test] fn rejects_fake_promotion_and_secrets() {
        let mut r=Report::default();let cap=r.capabilities.iter_mut().find(|c|c.name=="speed_write").unwrap();
        cap.state="runtime_verified".into();cap.premiere_runtime_verified=true;
        assert!(r.validate().is_err());
        let mut r=Report::default();
        assert!(r.verified_probe("project_inspection","inspect_context","sk-secret","p","s").is_err());
    }
    #[test] fn persistence_restore_and_corruption() {
        let path=std::env::temp_dir().join(format!("shuvi-acceptance-{}.json",std::process::id()));
        let r=Report::default();save(&path,&r).unwrap();assert_eq!(load(&path).unwrap().schema_version,1);
        fs::write(&path,"{corrupt").unwrap();assert!(load(&path).is_err());fs::remove_file(path).unwrap();
    }
    #[test] fn duplicate_evidence_failure_bounds_and_fake_persistence() {
        let mut r=Report::default();
        r.native_failure("timeline_inspection","inspect_timeline","25.6","p","s","Native rejection").unwrap();
        assert_eq!(r.capabilities.iter().find(|c|c.name=="timeline_inspection").unwrap().state,"runtime_failed");
        let repeated=r.evidence[0].clone();assert!(r.append(repeated).is_err());
        let mut bad=r.clone();bad.evidence[0].premiere_version=Some("Bearer secret".into());assert!(bad.validate().is_err());
        let mut bad=Report::default();bad.schema_version=2;assert!(bad.validate().is_err());
        let mut bad=Report::default();bad.capabilities.pop();assert!(bad.validate().is_err());
        let mut bad=Report::default();bad.capabilities[0].state="runtime_verified".into();
        bad.capabilities[0].premiere_runtime_verified=true;assert!(bad.validate().is_err());
    }
    #[test] fn timeline_promotion_accepts_only_exact_trim_move_clone_pairs() {
        let mut r=Report::default();
        assert!(r.verified_timeline_edit("move_clone","premiere_trim_clip","26.0","p","s","C:/backup.prproj").is_err());
        r.verified_timeline_edit("move_clone","premiere_move_clip","26.0","p","s","C:/backup.prproj").unwrap();
        r.verified_timeline_edit("move_clone","premiere_clone_clip","26.0","p","s","C:/backup2.prproj").unwrap();
        let cap=r.capabilities.iter().find(|c|c.name=="move_clone").unwrap();
        assert!(cap.premiere_runtime_verified);
        assert!(r.evidence.iter().any(|e|e.capability=="move_clone" && e.action=="premiere_move_clip"));
        assert!(r.evidence.iter().any(|e|e.capability=="move_clone" && e.action=="premiere_clone_clip"));
    }
    #[test] fn scene_detection_promotion_requires_real_marker_delta_and_restored_selection() {
        let mut r=Report::default();
        assert!(r.verified_scene_detection("premiere_detect_scene_markers","26.0","p","s","C:/backup.prproj",0,true).is_err());
        assert!(r.verified_scene_detection("premiere_detect_scene_markers","26.0","p","s","C:/backup.prproj",1,false).is_err());
        r.verified_scene_detection("premiere_detect_scene_markers","26.0","p","s","C:/backup.prproj",2,true).unwrap();
        let cap=r.capabilities.iter().find(|c|c.name=="scene_edit_detection").unwrap();
        assert!(cap.premiere_runtime_verified);
        assert!(r.evidence.iter().any(|e|e.capability=="scene_edit_detection" && e.action=="premiere_detect_scene_markers"));
    }
    #[test] fn legacy_report_adds_new_scene_detection_capability_without_promoting_it() {
        let path=std::env::temp_dir().join(format!("shuvi-acceptance-legacy-{}.json",std::process::id()));
        let mut legacy=Report::default();
        legacy.capabilities.pop();
        fs::write(&path,serde_json::to_vec(&legacy).unwrap()).unwrap();
        let loaded=load(&path).unwrap();
        let cap=loaded.capabilities.last().unwrap();
        assert_eq!(cap.name,"scene_edit_detection");
        assert_eq!(cap.state,"implemented_unverified");
        assert!(!cap.premiere_runtime_verified);
        fs::remove_file(path).unwrap();
    }
    #[test] fn interrupted_replace_recovers_backup() {
        let path=std::env::temp_dir().join(format!("shuvi-acceptance-restore-{}.json",std::process::id()));
        let backup=path.with_extension("json.bak");
        let r=Report::default();save(&path,&r).unwrap();
        fs::rename(&path,&backup).unwrap();assert_eq!(load(&path).unwrap().schema_version,1);
        fs::write(&path,"{corrupt").unwrap();assert_eq!(load(&path).unwrap().schema_version,1);
        fs::remove_file(path).unwrap();fs::remove_file(backup).unwrap();
    }
    #[test] fn bounded_history_keeps_proof_for_promoted_capability() {
        let mut report=Report::default();
        report.verified_probe("project_inspection","inspect_context","25.6","p","s").unwrap();
        for i in 0..100 {
            report.append(Evidence {timestamp_ms:report.next_timestamp().saturating_add(i),capability:"trim".into(),
                action:"group_2".into(),result_category:"blocked_environment".into(),
                premiere_version:None,project_guid:None,sequence_guid:None,native_capability:None,
                recovery:Some("No disposable test project.".into())}).unwrap();
        }
        assert_eq!(report.evidence.len(),MAX_EVIDENCE);
        assert!(report.evidence.iter().any(|e|e.capability=="project_inspection" && e.result_category=="runtime_verified"));
        report.validate().unwrap();
    }
}
