use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_ITEMS: usize = 64;
const MAX_ITEM_ID: usize = 240;
const MAX_MEDIA_PATH: usize = 32768;
const MAX_LUT_ID: usize = 512;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PixelAspect {
    pub numerator: f64,
    pub denominator: f64,
}

impl PixelAspect {
    pub fn validate(&self) -> Result<(), String> {
        if !self.numerator.is_finite() || !self.denominator.is_finite()
            || self.numerator <= 0.0 || self.denominator <= 0.0
            || self.numerator > 10_000.0 || self.denominator > 10_000.0
        {
            return Err("Pixel aspect numerator/denominator must be finite positive values no greater than 10000.".into());
        }
        Ok(())
    }

    pub fn ratio(&self) -> f64 {
        self.numerator / self.denominator
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ItemPrep {
    pub item_id: String,
    #[serde(default)]
    pub expected_media_path: Option<String>,
    #[serde(default)]
    pub override_frame_rate: Option<f64>,
    #[serde(default)]
    pub pixel_aspect: Option<PixelAspect>,
    #[serde(default)]
    pub scale_to_frame_size: bool,
    #[serde(default)]
    pub input_lut_id: Option<String>,
}

impl ItemPrep {
    pub fn validate(&self) -> Result<(), String> {
        if self.item_id.trim().is_empty() || self.item_id.len() > MAX_ITEM_ID {
            return Err("Media preparation requires a bounded exact project item ID.".into());
        }
        if self.expected_media_path.as_ref().is_some_and(|path| path.trim().is_empty() || path.len() > MAX_MEDIA_PATH) {
            return Err("Expected media path is empty or oversized.".into());
        }
        if let Some(rate) = self.override_frame_rate {
            if !rate.is_finite() || rate < 1.0 || rate > 1000.0 {
                return Err("Override frame rate must be finite between 1 and 1000 fps.".into());
            }
        }
        if let Some(pixel) = &self.pixel_aspect {
            pixel.validate()?;
        }
        if let Some(lut) = &self.input_lut_id {
            if lut.trim().is_empty() || lut.len() > MAX_LUT_ID || lut.chars().any(|ch| matches!(ch, '\r' | '\n' | '\0')) {
                return Err("Input LUT ID must be a bounded non-empty native identifier.".into());
            }
        }
        if self.override_frame_rate.is_none() && self.pixel_aspect.is_none()
            && !self.scale_to_frame_size && self.input_lut_id.is_none()
        {
            return Err("Media preparation contains no requested native change.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub schema_version: u8,
    pub items: Vec<ItemPrep>,
}

impl Batch {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Media preparation batch schema_version must be 1.".into());
        }
        if self.items.is_empty() || self.items.len() > MAX_ITEMS {
            return Err("Media preparation batch requires 1–64 explicit project items.".into());
        }
        let mut seen = HashSet::new();
        for item in &self.items {
            item.validate()?;
            if !seen.insert(item.item_id.as_str()) {
                return Err("Media preparation batch cannot mutate the same project item twice.".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WorkArea {
    pub in_seconds: f64,
    pub out_seconds: f64,
}

impl WorkArea {
    pub fn validate(&self) -> Result<(), String> {
        if !self.in_seconds.is_finite() || !self.out_seconds.is_finite()
            || self.in_seconds < 0.0 || self.out_seconds <= self.in_seconds
            || self.out_seconds > 86_400.0
        {
            return Err("Work area requires 0 <= in < out <= 86400 seconds.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_fractional_professional_frame_rates() {
        let item = ItemPrep {
            item_id:"clip".into(), expected_media_path:None,
            override_frame_rate:Some(23.976), pixel_aspect:None,
            scale_to_frame_size:false, input_lut_id:None,
        };
        item.validate().unwrap();
    }

    #[test]
    fn rejects_empty_media_mutation() {
        let item = ItemPrep {
            item_id:"clip".into(), expected_media_path:None,
            override_frame_rate:None, pixel_aspect:None,
            scale_to_frame_size:false, input_lut_id:None,
        };
        assert!(item.validate().is_err());
    }

    #[test]
    fn rejects_duplicate_batch_items() {
        let item = ItemPrep {
            item_id:"clip".into(), expected_media_path:None,
            override_frame_rate:Some(25.0), pixel_aspect:None,
            scale_to_frame_size:false, input_lut_id:None,
        };
        let batch = Batch {schema_version:1,items:vec![item.clone(),item]};
        assert!(batch.validate().is_err());
    }

    #[test]
    fn validates_work_area_order() {
        WorkArea{in_seconds:2.0,out_seconds:5.0}.validate().unwrap();
        assert!(WorkArea{in_seconds:5.0,out_seconds:2.0}.validate().is_err());
    }
}
