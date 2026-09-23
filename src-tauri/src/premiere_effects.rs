use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentTarget {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub component_match_name: Option<String>,
    pub component_display_name: Option<String>,
}
impl ComponentTarget {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.kind.as_str(), "video" | "audio") || self.track > 128 || self.clip_index > 10000 {
            return Err("Effect target requires video/audio and bounded track/clip indexes.".into());
        }
        if self.component_match_name.is_none() && self.component_display_name.is_none() {
            return Err("Inspect effects and supply an exact component match/display name.".into());
        }
        if [self.component_match_name.as_ref(), self.component_display_name.as_ref()].into_iter().flatten()
            .any(|v| v.trim().is_empty() || v.chars().count() > 240) {
            return Err("Component names must contain 1–240 characters.".into());
        }
        Ok(())
    }
    pub fn bridge_arguments(&self) -> Value {
        json!({"kind":self.kind,"track":self.track,"clipIndex":self.clip_index,
            "componentMatchName":self.component_match_name,"componentDisplayName":self.component_display_name})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_exact_bounded_component_target() {
        let mut target = ComponentTarget { kind: "video".into(), track: 0, clip_index: 0, component_match_name: None, component_display_name: None };
        assert!(target.validate().is_err());
        target.component_match_name = Some("exact".into()); target.validate().unwrap();
        target.track = 129; assert!(target.validate().is_err());
        target.track = 0; target.kind = "unknown".into(); assert!(target.validate().is_err());
    }
}
