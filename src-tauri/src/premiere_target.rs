use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use crate::premiere_bridge::PremiereBridgeShared;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedClip {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PremiereExpectation {
    pub project_guid: String,
    pub project_path: Option<String>,
    pub sequence_guid: Option<String>,
    #[serde(default)]
    pub clips: Vec<ExpectedClip>,
}

impl PremiereExpectation {
    pub fn validate(&self) -> Result<(), String> {
        if self.project_guid.is_empty() || self.project_guid.len() > 240
            || self.project_path.as_ref().is_some_and(|p| p.is_empty() || p.len() > 32768)
            || self.sequence_guid.as_ref().is_some_and(|s| s.is_empty() || s.len() > 240)
            || self.clips.len() > 64 {
            return Err("Invalid or oversized Premiere project/sequence expectations.".into());
        }
        if !self.clips.is_empty() && self.sequence_guid.is_none() {
            return Err("Clip expectations require the inspected sequence GUID.".into());
        }
        let mut seen = HashSet::new();
        for clip in &self.clips {
            if !matches!(clip.kind.as_str(), "video" | "audio") || clip.track > 128 || clip.clip_index > 10000
                || clip.signature.is_empty() || clip.signature.len() > 4096
                || !seen.insert((clip.kind.clone(), clip.track, clip.clip_index)) {
                return Err("Premiere clip expectations must be unique, bounded inspected targets.".into());
            }
        }
        Ok(())
    }
}

/// Per-action client: expectations never enter shared global desktop state.
pub struct PremiereClient<'a> {
    pub bridge: &'a PremiereBridgeShared,
    pub expected: Option<&'a PremiereExpectation>,
}

impl PremiereClient<'_> {
    pub async fn request(&self, action: &str, mut arguments: Value, timeout: Duration) -> Result<Value, String> {
        if mutation_requires_expectation(action) {
            let expected = self.expected.ok_or("Native Premiere mutation requires an inspected project expectation; inspect again before approval.")?;
            expected.validate()?;
            if expected.project_path.is_none() {
                return Err("Native Premiere mutation requires the inspected saved project path.".into());
            }
            if !matches!(action, "save_project" | "create_bin" | "rename_project_item" | "move_project_item"
                | "relink_media" | "prepare_media_item" | "attach_proxy" | "import_media"
                | "set_source_inout" | "clear_source_inout" | "create_subclip" | "transcribe_item"
                | "import_transcript" | "create_sequence_from_media" | "create_sequence_from_preset")
                && expected.sequence_guid.is_none() {
                return Err("Timeline mutation requires an inspected sequence GUID.".into());
            }
        }
        if let Some(expected) = self.expected {
            expected.validate()?;
            let context = self.bridge.request("inspect_context", json!({}), Duration::from_secs(8)).await?;
            if context.pointer("/capabilities/targetExpectations").and_then(Value::as_u64) != Some(1) {
                return Err("Paired Premiere panel cannot enforce target expectations. Reload the updated panel before editing.".into());
            }
            let object = arguments.as_object_mut().ok_or("Premiere command arguments must be an object.")?;
            object.insert("_expected".into(), serde_json::to_value(expected).map_err(|e| e.to_string())?);
        }
        self.bridge.request(action, arguments, timeout).await
    }
}

/// Unknown actions are never implicitly read-only. Keep this list in sync with
/// the native dispatch allowlist; capability presence is not host acceptance.
pub fn mutation_requires_expectation(action: &str) -> bool {
    !matches!(action, "inspect_context" | "inspect_timeline" | "list_root_items" | "project_tree"
        | "inspect_media_interpretation" | "get_work_area" | "scene_detection_capabilities"
        | "list_transcription_languages" | "export_transcript" | "plan_transcript_rebuild"
        | "release_transcript_rebuild" | "inspect_assembly_items" | "timeline_capabilities"
        | "plan_video_recipe" | "plan_audio_automation" | "inspect_mogrt_properties"
        | "plan_mogrt_recipe" | "project_diagnostics" | "caption_tracks"
        | "list_video_transitions" | "list_video_effects" | "inspect_clip_effects"
        | "list_audio_effects" | "inspect_audio_clip_effects" | "list_markers"
        | "inspect_export" | "inspect_keyframes" | "inspect_effect_lifecycle"
        | "inspect_clip_speed" | "plan_clip_speed" | "set_playhead")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_incomplete_or_duplicate_clip_expectations() {
        let mut expected = PremiereExpectation { project_guid: "project".into(), project_path: None, sequence_guid: None, clips: vec![] };
        expected.validate().unwrap();
        let clip = ExpectedClip { kind: "video".into(), track: 0, clip_index: 0, signature: "inspected".into() };
        expected.clips.push(clip.clone());
        assert!(expected.validate().is_err());
        expected.sequence_guid = Some("sequence".into());
        expected.validate().unwrap();
        expected.clips.push(clip);
        assert!(expected.validate().is_err());
    }
}
