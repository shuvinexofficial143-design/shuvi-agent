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
