use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct DiagnosticsLimits { pub max_items: u32, pub max_depth: u32, pub max_detail_items: u32 }
impl Default for DiagnosticsLimits {
    fn default() -> Self { Self {max_items: 10000, max_depth: 32, max_detail_items: 200} }
}
impl DiagnosticsLimits {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=10000).contains(&self.max_items) || !(1..=32).contains(&self.max_depth) || !(1..=200).contains(&self.max_detail_items) {
            return Err("Diagnostics limits: items 1–10000, depth 1–32, details 1–200.".into());
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_hard_bounds() {
        let mut limits: DiagnosticsLimits = serde_json::from_str("{}").unwrap(); limits.validate().unwrap();
        limits.max_items = 10001; assert!(limits.validate().is_err());
        limits.max_items = 1; limits.max_depth = 33; assert!(limits.validate().is_err());
        limits.max_depth = 1; limits.max_detail_items = 0; assert!(limits.validate().is_err());
        assert!(serde_json::from_str::<DiagnosticsLimits>(r#"{"recursive":true}"#).is_err());
    }
}
