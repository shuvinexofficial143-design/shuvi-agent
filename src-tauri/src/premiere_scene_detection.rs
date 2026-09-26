use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::premiere_target::{ExpectedClip, PremiereExpectation};

const MAX_TARGETS: usize = 16;
const MAX_SIGNATURE: usize = 4096;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub track: u32,
    pub clip_index: u32,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u8,
    pub mode: String,
    pub targets: Vec<Target>,
}

impl Request {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Scene detection schema_version must be 1.".into());
        }
        if !matches!(self.mode.as_str(), "cuts" | "markers") {
            return Err("Scene detection mode must be cuts or markers.".into());
        }
        if self.targets.is_empty() || self.targets.len() > MAX_TARGETS {
            return Err("Scene detection requires 1–16 explicit video targets.".into());
        }
        let mut seen = HashSet::new();
        for target in &self.targets {
            if target.track > 128 || target.clip_index > 10_000
                || target.signature.is_empty() || target.signature.len() > MAX_SIGNATURE
                || !seen.insert((target.track, target.clip_index))
            {
                return Err("Scene detection targets must be unique bounded inspected video clips.".into());
            }
        }
        Ok(())
    }
}

fn find_timeline_clip<'a>(timeline: &'a Value, target: &Target) -> Result<&'a Value, String> {
    if timeline.get("truncated").and_then(Value::as_bool) != Some(false) {
        return Err("Scene detection requires a complete timeline inspection.".into());
    }
    let tracks = timeline.get("videoTracks").and_then(Value::as_array)
        .ok_or("Timeline video tracks are missing.")?;
    let track = tracks.iter()
        .find(|row| row.get("index").and_then(Value::as_u64) == Some(target.track as u64))
        .ok_or_else(|| format!("Video track {} is missing.", target.track))?;
    let items = track.get("items").and_then(Value::as_array)
        .ok_or("Timeline video items are missing.")?;
    items.get(target.clip_index as usize)
        .ok_or_else(|| format!("Video clip {} on track {} is missing.", target.clip_index, target.track))
}

pub fn build_plan(request: &Request, timeline: &Value, capabilities: &Value) -> Result<Value, String> {
    request.validate()?;
    if capabilities.get("supported").and_then(Value::as_bool) != Some(true) {
        return Ok(json!({
            "schema_version":1,
            "supported":false,
            "mode":request.mode,
            "targets":request.targets,
            "reason":capabilities.get("reason").and_then(Value::as_str).unwrap_or("Native scene edit detection is unavailable."),
            "capabilities":capabilities
        }));
    }
    let operation_key = if request.mode == "cuts" { "applyCut" } else { "createMarker" };
    if capabilities.get(operation_key).and_then(Value::as_bool) != Some(true) {
        return Ok(json!({
            "schema_version":1,
            "supported":false,
            "mode":request.mode,
            "targets":request.targets,
            "reason":"Requested stable native scene detection operation is unavailable.",
            "capabilities":capabilities
        }));
    }

    let base: PremiereExpectation = serde_json::from_value(
        timeline.get("expected").cloned().ok_or("Timeline expectation is missing.")?
    ).map_err(|e| format!("Invalid timeline expectation: {e}"))?;

    let mut clips = Vec::with_capacity(request.targets.len());
    let mut summaries = Vec::with_capacity(request.targets.len());
    for target in &request.targets {
        let item = find_timeline_clip(timeline, target)?;
        let current_signature = item.get("targetSignature").and_then(Value::as_str)
            .ok_or("Scene detection target signature is unavailable.")?;
        if current_signature != target.signature {
            return Err("Scene detection target changed since inspection; plan again.".into());
        }
        let start = item.get("startSeconds").and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or("Scene detection target start is unavailable.")?;
        let end = item.get("endSeconds").and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > start)
            .ok_or("Scene detection target end is unavailable.")?;
        clips.push(ExpectedClip {
            kind: "video".into(),
            track: target.track,
            clip_index: target.clip_index,
            signature: target.signature.clone(),
        });
        summaries.push(json!({
            "track":target.track,
            "clip_index":target.clip_index,
            "start_seconds":start,
            "end_seconds":end,
            "duration_seconds":end-start,
            "signature":target.signature
        }));
    }

    let expected = PremiereExpectation {
        project_guid: base.project_guid,
        project_path: base.project_path,
        sequence_guid: base.sequence_guid,
        clips,
    };
    expected.validate()?;

    Ok(json!({
        "schema_version":1,
        "supported":true,
        "mode":request.mode,
        "native_operation": if request.mode=="cuts" {"SequenceOperation.APPLYCUT"} else {"SequenceOperation.CREATEMARKER"},
        "api_since":"25.6",
        "targets":summaries,
        "expected":expected,
        "checkpoint_required":true,
        "selection_scope":"exact_explicit_video_targets_only",
        "selection_restore_attempted":true,
        "blind_retry":false,
        "capabilities":capabilities
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(mode: &str) -> Request {
        Request {
            schema_version:1,
            mode:mode.into(),
            targets:vec![Target{track:0,clip_index:0,signature:"sig".into()}],
        }
    }
    fn timeline() -> Value {
        json!({
            "expected":{"project_guid":"p","project_path":"C:/x.prproj","sequence_guid":"s","clips":[]},
            "truncated":false,
            "videoTracks":[{"index":0,"items":[{"targetSignature":"sig","startSeconds":1.0,"endSeconds":5.0}]}],
            "audioTracks":[]
        })
    }
    fn caps() -> Value {
        json!({"supported":true,"applyCut":true,"createMarker":true,"apiSince":"25.6"})
    }

    #[test]
    fn validates_exact_targets_and_builds_expectation() {
        let plan = build_plan(&request("cuts"), &timeline(), &caps()).unwrap();
        assert_eq!(plan["supported"], true);
        assert_eq!(plan["expected"]["clips"][0]["signature"], "sig");
        assert_eq!(plan["native_operation"], "SequenceOperation.APPLYCUT");
    }

    #[test]
    fn marker_mode_uses_documented_constant() {
        let plan = build_plan(&request("markers"), &timeline(), &caps()).unwrap();
        assert_eq!(plan["native_operation"], "SequenceOperation.CREATEMARKER");
    }

    #[test]
    fn stale_signature_is_rejected() {
        let mut req = request("cuts");
        req.targets[0].signature = "stale".into();
        assert!(build_plan(&req, &timeline(), &caps()).is_err());
    }

    #[test]
    fn unsupported_host_returns_non_executable_plan() {
        let plan = build_plan(&request("cuts"), &timeline(), &json!({"supported":false,"reason":"missing"})).unwrap();
        assert_eq!(plan["supported"], false);
    }
}
