use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::premiere_assembly::{Assembly, Shot, Transition};
use crate::premiere_target::PremiereExpectation;

const MAX_CATALOG: usize = 256;
const MAX_ASSEMBLY_SHOTS: usize = 64;
const MAX_B_ROLL: usize = 32;
const MAX_TRANSITIONS: usize = 32;
const MAX_REVIEW_TIMES: usize = 8;
const MAX_TEXT: usize = 240;
const EPSILON: f64 = 0.001;

fn default_true() -> bool { true }

fn bounded_time(value: f64) -> bool {
    value.is_finite() && (0.0..=86400.0).contains(&value)
}

fn bounded_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_TEXT
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VisualDescription {
    #[serde(default)] pub person_visible: Option<bool>,
    #[serde(default)] pub product_visible: Option<bool>,
    #[serde(default)] pub framing: Option<String>,
    #[serde(default)] pub lighting: Option<String>,
    #[serde(default)] pub text_graphics_visible: Option<bool>,
}

impl VisualDescription {
    fn validate(&self) -> Result<(), String> {
        for value in [&self.framing, &self.lighting].into_iter().flatten() {
            if !bounded_text(value) {
                return Err("Visual framing/lighting text must be non-empty and at most 240 bytes.".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogShot {
    pub id: String,
    pub item_id: String,
    pub source_start: f64,
    pub source_end: f64,
    #[serde(default)] pub sequence_start: Option<f64>,
    #[serde(default)] pub sequence_end: Option<f64>,
    #[serde(default)] pub source_speed: Option<f64>,
    #[serde(default)] pub visual: Option<VisualDescription>,
}

impl CatalogShot {
    fn validate(&self) -> Result<(), String> {
        if !bounded_text(&self.id) || !bounded_text(&self.item_id)
            || !bounded_time(self.source_start) || !bounded_time(self.source_end)
            || self.source_end <= self.source_start
        {
            return Err("Catalog shots require bounded IDs and an exact positive source range.".into());
        }
        match (self.sequence_start, self.sequence_end) {
            (None, None) => {}
            (Some(start), Some(end)) if bounded_time(start) && bounded_time(end) && end > start => {}
            _ => return Err("Catalog sequence timing must provide both valid sequence_start and sequence_end.".into()),
        }
        if let Some(speed) = self.source_speed {
            if !speed.is_finite() || (speed - 1.0).abs() > 0.0001 {
                return Err("Scene rough cut currently supports ordinary forward 1x source ranges only.".into());
            }
        }
        if let Some(visual) = &self.visual { visual.validate()?; }
        Ok(())
    }

    fn duration(&self) -> f64 { self.source_end - self.source_start }
    fn source_midpoint(&self) -> Option<f64> {
        match (self.sequence_start, self.sequence_end) {
            (Some(start), Some(end)) => Some(start + (end - start) / 2.0),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Destination {
    pub mode: String,
    pub sequence_guid: String,
    #[serde(default)] pub start_seconds: f64,
    pub video_track: u32,
    pub audio_track: u32,
    #[serde(default = "default_true")] pub take_audio: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BrollPlacement {
    pub shot_id: String,
    pub seconds: f64,
    pub video_track: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionRequest {
    pub after_shot_id: String,
    pub match_name: String,
    pub duration_seconds: f64,
    #[serde(default = "transition_end")] pub position: String,
    #[serde(default)] pub force_single_sided: bool,
}

fn transition_end() -> String { "end".into() }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u8,
    pub catalog_source: String,
    pub shots: Vec<CatalogShot>,
    pub selection: Vec<String>,
    pub destination: Destination,
    #[serde(default)] pub b_roll: Vec<BrollPlacement>,
    #[serde(default)] pub transitions: Vec<TransitionRequest>,
    #[serde(default)] pub request_review: bool,
    #[serde(default)] pub describe_shots: bool,
}

impl Request {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || !matches!(self.catalog_source.as_str(), "scene_detection" | "explicit") {
            return Err("Scene rough cut requires schema v1 and catalog_source scene_detection|explicit.".into());
        }
        if self.shots.is_empty() || self.shots.len() > MAX_CATALOG {
            return Err("Shot catalog requires 1–256 explicit entries.".into());
        }
        if self.selection.is_empty() || self.selection.len() > MAX_ASSEMBLY_SHOTS
            || self.b_roll.len() > MAX_B_ROLL
            || self.selection.len() + self.b_roll.len() > MAX_ASSEMBLY_SHOTS
        {
            return Err("Rough cut requires 1–64 total explicit A-roll/B-roll placements, with at most 32 B-roll placements.".into());
        }
        if self.transitions.len() > MAX_TRANSITIONS {
            return Err("Rough cut supports at most 32 explicit transitions.".into());
        }

        let mut ids = HashSet::new();
        for shot in &self.shots {
            shot.validate()?;
            if self.catalog_source == "scene_detection" && shot.source_speed.is_none() {
                return Err("Scene-detection catalog entries require an observed 1x source_speed; unknown retiming is not assumed safe.".into());
            }
            if !ids.insert(shot.id.as_str()) {
                return Err("Shot catalog IDs must be unique.".into());
            }
        }

        let mut selected = HashSet::new();
        for id in &self.selection {
            if !ids.contains(id.as_str()) || !selected.insert(id.as_str()) {
                return Err("Selection must contain unique explicit shot IDs from the catalog.".into());
            }
        }

        if self.destination.mode != "explicit_empty_active_sequence"
            || !bounded_text(&self.destination.sequence_guid)
            || !bounded_time(self.destination.start_seconds)
            || self.destination.video_track > 128
            || self.destination.audio_track > 128
        {
            return Err("Destination must be an explicit empty active sequence with bounded tracks/time.".into());
        }

        let mut b_roll_keys = HashSet::new();
        for row in &self.b_roll {
            if !ids.contains(row.shot_id.as_str()) || !bounded_time(row.seconds) || row.video_track > 128
                || !b_roll_keys.insert((row.shot_id.as_str(), row.seconds.to_bits(), row.video_track))
            {
                return Err("B-roll requires unique explicit catalog shot/time/video-track placements.".into());
            }
        }

        for transition in &self.transitions {
            if !selected.contains(transition.after_shot_id.as_str())
                || !bounded_text(&transition.match_name)
                || !transition.duration_seconds.is_finite()
                || transition.duration_seconds <= 0.0
                || transition.duration_seconds > 60.0
                || !matches!(transition.position.as_str(), "start" | "end")
            {
                return Err("Transitions must target a selected A-roll shot with bounded explicit native transition settings.".into());
            }
        }
        Ok(())
    }
}

fn destination_expectation(request: &Request, timeline: &Value, captions: &Value) -> Result<PremiereExpectation, String> {
    if timeline.get("truncated").and_then(Value::as_bool) != Some(false) {
        return Err("Scene rough cut requires a complete empty-destination timeline inspection.".into());
    }
    let active_guid = timeline.get("sequenceGuid").and_then(Value::as_str)
        .ok_or("Active destination sequence GUID is unavailable.")?;
    if active_guid != request.destination.sequence_guid {
        return Err("The active sequence is not the explicitly requested rough-cut destination.".into());
    }

    let video = timeline.get("videoTracks").and_then(Value::as_array).ok_or("Destination video tracks are missing.")?;
    let audio = timeline.get("audioTracks").and_then(Value::as_array).ok_or("Destination audio tracks are missing.")?;
    if !video.iter().any(|row| row.get("index").and_then(Value::as_u64) == Some(request.destination.video_track as u64))
        || !audio.iter().any(|row| row.get("index").and_then(Value::as_u64) == Some(request.destination.audio_track as u64))
    {
        return Err("Requested destination video/audio track does not exist.".into());
    }
    for placement in &request.b_roll {
        if !video.iter().any(|row| row.get("index").and_then(Value::as_u64) == Some(placement.video_track as u64)) {
            return Err("Requested B-roll destination video track does not exist.".into());
        }
    }
    for row in video.iter().chain(audio.iter()) {
        let count = row.get("items").and_then(Value::as_array).map(Vec::len)
            .ok_or("Destination track items are unavailable.")?;
        if count != 0 {
            return Err("Rough cut destination must be completely empty; existing timeline media is never overwritten by default.".into());
        }
    }
    if captions.get("count").and_then(Value::as_u64).ok_or("Caption-track count is unavailable.")? != 0 {
        return Err("Rough cut destination must have no caption tracks.".into());
    }

    let expected: PremiereExpectation = serde_json::from_value(
        timeline.get("expected").cloned().ok_or("Destination expectation is missing.")?
    ).map_err(|e| format!("Invalid destination expectation: {e}"))?;
    expected.validate()?;
    if expected.sequence_guid.as_deref() != Some(active_guid) || !expected.clips.is_empty() {
        return Err("Destination expectation must contain the exact sequence and no stale clip targets.".into());
    }
    Ok(expected)
}

pub fn build_plan(request: &Request, timeline: &Value, captions: &Value) -> Result<Value, String> {
    request.validate()?;
    let expected = destination_expectation(request, timeline, captions)?;
    let by_id: HashMap<&str, &CatalogShot> = request.shots.iter().map(|shot| (shot.id.as_str(), shot)).collect();

    let mut cursor = request.destination.start_seconds;
    let mut assembly_shots = Vec::with_capacity(request.selection.len() + request.b_roll.len());
    let mut placements = Vec::with_capacity(request.selection.len());
    let mut selected_indexes = HashMap::new();
    let mut review_times = Vec::new();

    for id in &request.selection {
        let shot = by_id.get(id.as_str()).ok_or("Selected shot disappeared from catalog.")?;
        let start = cursor;
        let end = start + shot.duration();
        if !bounded_time(end) {
            return Err("Selected rough cut exceeds the supported 24-hour sequence bound.".into());
        }
        let index = assembly_shots.len() as u32;
        selected_indexes.insert(id.as_str(), index);
        assembly_shots.push(Shot {
            item_id: shot.item_id.clone(),
            timeline_seconds: start,
            video_track: request.destination.video_track,
            audio_track: request.destination.audio_track,
            mode: "insert".into(),
            source_in: Some(shot.source_start),
            source_out: Some(shot.source_end),
            take_video: true,
            take_audio: request.destination.take_audio,
            role: Some("a_roll".into()),
            beat_index: None,
        });
        placements.push(json!({
            "shot_id":id,
            "source_item":shot.item_id,
            "source_start":shot.source_start,
            "source_end":shot.source_end,
            "destination_start":start,
            "destination_end":end,
            "role":"a_roll"
        }));
        if request.request_review && review_times.len() < MAX_REVIEW_TIMES {
            review_times.push(start + (end - start) / 2.0);
        }
        cursor = end;
    }

    let rough_end = cursor;
    let mut b_roll_placements = Vec::new();
    for row in &request.b_roll {
        let shot = by_id.get(row.shot_id.as_str()).ok_or("B-roll shot disappeared from catalog.")?;
        let end = row.seconds + shot.duration();
        if row.seconds + EPSILON < request.destination.start_seconds || end > rough_end + EPSILON {
            return Err("B-roll placement must stay inside the explicit A-roll rough-cut duration.".into());
        }
        assembly_shots.push(Shot {
            item_id: shot.item_id.clone(),
            timeline_seconds: row.seconds,
            video_track: row.video_track,
            audio_track: request.destination.audio_track,
            mode: "overwrite".into(),
            source_in: Some(shot.source_start),
            source_out: Some(shot.source_end),
            take_video: true,
            take_audio: false,
            role: Some("b_roll".into()),
            beat_index: None,
        });
        b_roll_placements.push(json!({
            "shot_id":row.shot_id,
            "source_item":shot.item_id,
            "source_start":shot.source_start,
            "source_end":shot.source_end,
            "destination_start":row.seconds,
            "destination_end":end,
            "video_track":row.video_track,
            "audio_included":false
        }));
    }

    let mut transitions = Vec::with_capacity(request.transitions.len());
    for row in &request.transitions {
        transitions.push(Transition {
            shot_index: *selected_indexes.get(row.after_shot_id.as_str()).ok_or("Transition target disappeared from explicit selection.")?,
            match_name: row.match_name.clone(),
            duration_seconds: row.duration_seconds,
            position: row.position.clone(),
            force_single_sided: row.force_single_sided,
        });
    }

    let assembly = Assembly {
        schema_version: 2,
        shots: assembly_shots,
        chapters: Vec::new(),
        transitions,
        music: Vec::new(),
        graphics: None,
        beats: Vec::new(),
        review: request.request_review,
    };
    assembly.validate()?;

    let representative_source_frames: Vec<Value> = request.selection.iter()
        .filter_map(|id| by_id.get(id.as_str()).and_then(|shot| shot.source_midpoint().map(|seconds| json!({
            "shot_id":id,
            "seconds":seconds
        }))))
        .take(MAX_REVIEW_TIMES)
        .collect();
    let missing_visual_times = request.describe_shots && representative_source_frames.len() < request.selection.len().min(MAX_REVIEW_TIMES);
    let post_review = if request.request_review {
        json!({
            "tool":"premiere_review_frames",
            "arguments":{
                "seconds":review_times,
                "prompt":"Review these rough-cut frames for factual continuity, framing, visible products/people, lighting, and visible text/graphics. Do not identify people, rank shots, or choose a best shot."
            },
            "run_after_apply":true,
            "requires_separate_approval":true
        })
    } else { Value::Null };

    Ok(json!({
        "schema_version":1,
        "catalog_source":request.catalog_source,
        "catalog":request.shots,
        "selection":request.selection,
        "ordered_placements":placements,
        "b_roll_placements":b_roll_placements,
        "estimated_duration_seconds":rough_end-request.destination.start_seconds,
        "destination_requirements":{
            "mode":"explicit_empty_active_sequence",
            "sequence_guid":request.destination.sequence_guid,
            "video_track":request.destination.video_track,
            "audio_track":request.destination.audio_track,
            "verified_empty":true
        },
        "assembly":assembly,
        "expected":expected,
        "apply_proposal":{
            "tool":"premiere_apply_assembly",
            "arguments":{"assembly":assembly,"expected":expected},
            "requires_separate_approval":true
        },
        "representative_source_frames":representative_source_frames,
        "visual_description_workflow":{
            "requested":request.describe_shots,
            "existing_tool":"premiere_review_frames",
            "must_run_while_source_sequence_is_active":true,
            "factual_fields":["person_visible","product_visible","framing","lighting","text_graphics_visible"],
            "identify_people":false,
            "rank_shots":false,
            "automatic_selection":false
        },
        "post_apply_review_proposal":post_review,
        "review_times":review_times,
        "missing_dependencies":if missing_visual_times {vec!["source sequence timing is missing for one or more requested visual-description samples"]} else {Vec::<&str>::new()},
        "source_original_sequence_mutated":false,
        "new_insert_engine":false,
        "assembly_engine":"Y2 source-range subclip + insert/overwrite",
        "b_roll_strategy":"explicit project-item source range; video-only subclip",
        "automatic_shot_selection":false,
        "random_selection":false
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Request {
        Request {
            schema_version:1,
            catalog_source:"explicit".into(),
            shots:vec![
                CatalogShot{id:"s1".into(),item_id:"m1".into(),source_start:1.0,source_end:3.0,sequence_start:Some(10.0),sequence_end:Some(12.0),source_speed:Some(1.0),visual:None},
                CatalogShot{id:"s2".into(),item_id:"m2".into(),source_start:5.0,source_end:8.0,sequence_start:Some(20.0),sequence_end:Some(23.0),source_speed:Some(1.0),visual:None},
                CatalogShot{id:"b1".into(),item_id:"m3".into(),source_start:2.0,source_end:3.0,sequence_start:None,sequence_end:None,source_speed:None,visual:None},
            ],
            selection:vec!["s2".into(),"s1".into()],
            destination:Destination{mode:"explicit_empty_active_sequence".into(),sequence_guid:"dest".into(),start_seconds:0.0,video_track:0,audio_track:0,take_audio:true},
            b_roll:vec![BrollPlacement{shot_id:"b1".into(),seconds:1.0,video_track:1}],
            transitions:vec![TransitionRequest{after_shot_id:"s2".into(),match_name:"Cross Dissolve".into(),duration_seconds:0.5,position:"end".into(),force_single_sided:false}],
            request_review:true,
            describe_shots:true,
        }
    }
    fn timeline() -> Value {
        json!({
            "sequenceGuid":"dest","truncated":false,
            "expected":{"project_guid":"p","project_path":"C:/x.prproj","sequence_guid":"dest","clips":[]},
            "videoTracks":[{"index":0,"items":[]},{"index":1,"items":[]}],
            "audioTracks":[{"index":0,"items":[]}]
        })
    }

    #[test] fn explicit_order_builds_existing_y2_assembly() {
        let plan=build_plan(&request(),&timeline(),&json!({"count":0})).unwrap();
        assert_eq!(plan["apply_proposal"]["tool"],"premiere_apply_assembly");
        assert_eq!(plan["ordered_placements"][0]["shot_id"],"s2");
        assert_eq!(plan["ordered_placements"][0]["destination_start"],0.0);
        assert_eq!(plan["ordered_placements"][1]["destination_start"],3.0);
        assert_eq!(plan["automatic_shot_selection"],false);
    }

    #[test] fn non_empty_destination_fails_closed() {
        let mut value=timeline();
        value["videoTracks"][0]["items"]=json!([{"clipIndex":0}]);
        assert!(build_plan(&request(),&value,&json!({"count":0})).is_err());
    }

    #[test] fn b_roll_is_video_only_and_explicit() {
        let plan=build_plan(&request(),&timeline(),&json!({"count":0})).unwrap();
        assert_eq!(plan["assembly"]["shots"][2]["role"],"b_roll");
        assert_eq!(plan["assembly"]["shots"][2]["take_audio"],false);
        assert_eq!(plan["assembly"]["shots"][2]["mode"],"overwrite");
    }

    #[test] fn review_is_bounded_and_never_selects_shots() {
        let plan=build_plan(&request(),&timeline(),&json!({"count":0})).unwrap();
        assert!(plan["review_times"].as_array().unwrap().len()<=MAX_REVIEW_TIMES);
        assert_eq!(plan["visual_description_workflow"]["identify_people"],false);
        assert_eq!(plan["visual_description_workflow"]["rank_shots"],false);
    }

    #[test] fn retimed_scene_catalog_is_rejected() {
        let mut value=request();
        value.shots[0].source_speed=Some(0.5);
        assert!(value.validate().is_err());
    }

    #[test] fn transition_must_target_selected_a_roll() {
        let mut value=request();
        value.transitions[0].after_shot_id="b1".into();
        assert!(value.validate().is_err());
    }
}
