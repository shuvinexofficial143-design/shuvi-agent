use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterTarget {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub component_match_name: Option<String>,
    pub component_display_name: Option<String>,
    pub param_display_name: String,
}

impl ParameterTarget {
    pub fn validate(&self) -> Result<(), String> {
        let valid_name = |v: &str| !v.trim().is_empty() && v.chars().count() <= 240;
        if !matches!(self.kind.as_str(), "video" | "audio") || self.track > 128 || self.clip_index > 10000 {
            return Err("Keyframe target requires video/audio and bounded track/clip indexes.".into());
        }
        if self.component_match_name.is_none() && self.component_display_name.is_none() {
            return Err("Inspect effects and supply an exact component match/display name.".into());
        }
        if !valid_name(&self.param_display_name) || [self.component_match_name.as_ref(), self.component_display_name.as_ref()]
            .into_iter().flatten().any(|v| !valid_name(v)) {
            return Err("Parameter/component names must contain 1–240 characters.".into());
        }
        Ok(())
    }

    pub fn bridge_arguments(&self) -> Value {
        json!({"kind":self.kind,"track":self.track,"clipIndex":self.clip_index,
            "componentMatchName":self.component_match_name,"componentDisplayName":self.component_display_name,
            "paramDisplayName":self.param_display_name})
    }
}
