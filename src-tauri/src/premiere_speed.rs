use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeedMode { Rate, Duration, Preset, Ramp, Freeze }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeedPoint {
    pub source_offset_seconds: f64,
    pub rate: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeedRequest {
    pub mode: SpeedMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<SpeedPoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preserve_audio_pitch: Option<bool>,
}

impl SpeedRequest {
    pub fn validate(&self) -> Result<(), String> {
        let rate = |value: f64| value.is_finite() && (0.01..=100.0).contains(&value);
        let time = |value: f64| value.is_finite() && (0.0..=86400.0).contains(&value);
        if self.rate.is_some_and(|v| !rate(v))
            || self.duration_seconds.is_some_and(|v| !time(v) || v < 0.001)
            || self.source_seconds.is_some_and(|v| !time(v)) {
            return Err("Speed rate/time exceeds planning limits.".into());
        }
        if let Some(points) = &self.points {
            if !(2..=32).contains(&points.len()) || points.iter().any(|p| !rate(p.rate) || !time(p.source_offset_seconds)) {
                return Err("Speed ramp requires 2–32 bounded source-time/rate points.".into());
            }
        }
        // Reject incompatible fields rather than silently ignoring model intent.
        let actual = [self.rate.is_some(), self.duration_seconds.is_some(), self.source_seconds.is_some(), self.preset.is_some(), self.points.is_some()];
        let expected = match self.mode {
            SpeedMode::Rate => [true, false, false, false, false],
            SpeedMode::Duration => [false, true, false, false, false],
            SpeedMode::Preset => [false, false, false, true, false],
            SpeedMode::Ramp => [false, false, false, false, true],
            SpeedMode::Freeze => [false, true, true, false, false],
        };
        if actual != expected { return Err("Speed fields do not match the requested mode.".into()); }
        if self.preset.as_deref().is_some_and(|p| !matches!(p, "normal" | "slow_motion" | "fast_motion")) {
            return Err("Unknown speed preset.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validates_modes_and_limits() {
        for value in [json!({"mode":"rate","rate":2}), json!({"mode":"freeze","source_seconds":2,"duration_seconds":4})] {
            serde_json::from_value::<SpeedRequest>(value).unwrap().validate().unwrap();
        }
        for value in [json!({"mode":"rate","rate":0}), json!({"mode":"duration"}), json!({"mode":"rate","rate":1,"preset":"normal"})] {
            assert!(serde_json::from_value::<SpeedRequest>(value).unwrap().validate().is_err());
        }
        assert!(serde_json::from_value::<SpeedRequest>(json!({"mode":"rate","rate":1,"script":"bad"})).is_err());
    }
}
