use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

use crate::premiere_audio::AudioPlanRequest;
use crate::premiere_graphics::Batch as GraphicsBatch;
use crate::premiere_keyframes::ParameterTarget;
use crate::premiere_recipes::RecipePlanRequest;

const MAX_VIDEO: usize = 32;
const MAX_AUDIO: usize = 32;
const MAX_TOTAL_TARGETS: usize = 48;
const MAX_REVIEW_SAMPLES: usize = 8;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VideoFinish {
    pub track: u32,
    pub clip_index: u32,
    pub request: RecipePlanRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioFinish {
    pub target: ParameterTarget,
    pub request: AudioPlanRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u8,
    #[serde(default)]
    pub videos: Vec<VideoFinish>,
    #[serde(default)]
    pub audios: Vec<AudioFinish>,
    #[serde(default)]
    pub graphics: Option<GraphicsBatch>,
    #[serde(default)]
    pub review: bool,
    #[serde(default)]
    pub review_prompt: Option<String>,
}

impl Request {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Mixed finishing schema_version must be 1.".into());
        }
        if self.videos.len() > MAX_VIDEO || self.audios.len() > MAX_AUDIO {
            return Err("Mixed finishing allows at most 32 video and 32 audio targets.".into());
        }
        let total = self.videos.len() + self.audios.len();
        if total > MAX_TOTAL_TARGETS {
            return Err("Mixed finishing allows at most 48 existing clip targets.".into());
        }
        if total == 0 && self.graphics.is_none() {
            return Err("Mixed finishing needs video, audio, and/or mapped graphics work.".into());
        }

        let mut video_seen = HashSet::new();
        for video in &self.videos {
            if video.track > 128 || video.clip_index > 10_000 || !video_seen.insert((video.track, video.clip_index)) {
                return Err("Video finishing targets must be unique and bounded.".into());
            }
            video.request.validate()?;
        }

        let mut audio_seen = HashSet::new();
        for audio in &self.audios {
            audio.target.validate()?;
            if audio.target.kind != "audio" {
                return Err("Mixed audio finishing requires exact audio targets.".into());
            }
            let key = (
                audio.target.track,
                audio.target.clip_index,
                audio.target.component_match_name.as_deref().unwrap_or(""),
                audio.target.component_display_name.as_deref().unwrap_or(""),
                audio.target.param_display_name.as_str(),
            );
            if !audio_seen.insert(key) {
                return Err("Audio finishing parameter targets must be unique.".into());
            }
            audio.request.validate()?;
        }

        if let Some(graphics) = &self.graphics {
            graphics.validate()?;
        }

        if let Some(prompt) = &self.review_prompt {
            if prompt.chars().count() > 4_000 {
                return Err("Finishing review prompt is too long.".into());
            }
        }
        if self.review && self.review_prompt.as_deref().unwrap_or("").trim().is_empty() {
            return Err("Review-enabled finishing requires an explicit bounded review_prompt.".into());
        }
        Ok(())
    }

    pub fn expected_clip_count(&self) -> usize {
        self.videos.len() + self.audios.len()
    }
}

pub fn review_times(timeline: &Value, videos: &[VideoFinish]) -> Result<Vec<f64>, String> {
    if videos.is_empty() {
        return Ok(Vec::new());
    }
    if timeline.get("truncated").and_then(Value::as_bool) != Some(false) {
        return Err("Representative finishing review requires a complete timeline inspection.".into());
    }
    let tracks = timeline.get("videoTracks").and_then(Value::as_array).ok_or("Timeline video tracks missing.")?;
    let mut times = Vec::new();
    let mut seen = HashSet::new();

    for target in videos {
        let track = tracks.iter()
            .find(|row| row.get("index").and_then(Value::as_u64) == Some(target.track as u64))
            .ok_or_else(|| format!("Video track {} missing during review sampling.", target.track))?;
        let item = track.get("items").and_then(Value::as_array)
            .and_then(|items| items.get(target.clip_index as usize))
            .ok_or_else(|| format!("Video clip {} missing during review sampling.", target.clip_index))?;
        let start = item.get("startSeconds").and_then(Value::as_f64).ok_or("Review sample clip start missing.")?;
        let end = item.get("endSeconds").and_then(Value::as_f64).ok_or("Review sample clip end missing.")?;
        if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start || end > 86_400.0 {
            return Err("Review sample clip timing is invalid.".into());
        }
        let midpoint = start + (end - start) / 2.0;
        let key = (midpoint * 1000.0).round() as i64;
        if seen.insert(key) {
            times.push(midpoint);
            if times.len() == MAX_REVIEW_SAMPLES {
                break;
            }
        }
    }
    Ok(times)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn video() -> VideoFinish {
        serde_json::from_value(json!({
            "track":0,
            "clip_index":0,
            "request":{
                "preset":"natural_correction",
                "bindings":[{
                    "role":"contrast",
                    "component_match_name":"native",
                    "component_display_name":null,
                    "param_display_name":"Contrast",
                    "start_value":null,
                    "end_value":null,
                    "unit":1,
                    "min":0,
                    "max":2
                }],
                "start_seconds":null,
                "end_seconds":null,
                "strength":null
            }
        })).unwrap()
    }

    fn audio() -> AudioFinish {
        serde_json::from_value(json!({
            "target":{
                "kind":"audio","track":0,"clip_index":0,
                "component_match_name":"audio","component_display_name":null,
                "param_display_name":"Volume"
            },
            "request":{
                "mode":"fade_in","duration_seconds":10,"baseline":1,
                "value_unit":"native","target_value":0.5,"reduction_db":null,
                "attack_seconds":null,"release_seconds":null,"min":0,"max":2,"regions":[]
            }
        })).unwrap()
    }

    #[test]
    fn validates_mixed_targets() {
        let request = Request {
            schema_version:1, videos:vec![video()], audios:vec![audio()],
            graphics:None, review:false, review_prompt:None,
        };
        request.validate().unwrap();
    }

    #[test]
    fn rejects_duplicate_targets_and_empty_work() {
        let v = video();
        let request = Request {
            schema_version:1, videos:vec![v.clone(),v], audios:Vec::new(),
            graphics:None, review:false, review_prompt:None,
        };
        assert!(request.validate().is_err());
        let empty = Request {schema_version:1,videos:Vec::new(),audios:Vec::new(),graphics:None,review:false,review_prompt:None};
        assert!(empty.validate().is_err());
    }

    #[test]
    fn samples_only_affected_clip_midpoints() {
        let times = review_times(&json!({
            "truncated":false,
            "videoTracks":[{"index":0,"items":[{"startSeconds":2.0,"endSeconds":6.0}]}]
        }), &[video()]).unwrap();
        assert_eq!(times, vec![4.0]);
    }
}
