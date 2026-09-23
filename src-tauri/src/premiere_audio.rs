use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DialogueRegion { pub start: f64, pub end: f64 }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AudioPlanRequest {
    pub mode: String, pub duration_seconds: f64, pub baseline: f64, pub value_unit: String,
    pub target_value: Option<f64>, pub reduction_db: Option<f64>, pub attack_seconds: Option<f64>, pub release_seconds: Option<f64>,
    pub min: Option<f64>, pub max: Option<f64>, #[serde(default)] pub regions: Vec<DialogueRegion>,
}
impl AudioPlanRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.mode.as_str(), "duck" | "fade_in" | "fade_out" | "pan") || !matches!(self.value_unit.as_str(), "db" | "linear_amplitude" | "native")
            || !self.duration_seconds.is_finite() || self.duration_seconds <= 0.0 || self.duration_seconds > 86400.0 || !self.baseline.is_finite() || self.regions.len() > 128 {
            return Err("Invalid or oversized audio plan request.".into());
        }
        Ok(())
    }
}
