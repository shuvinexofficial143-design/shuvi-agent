use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const MAX_SEGMENTS: usize = 256;
const MAX_SELECTIONS: usize = 128;
const MAX_TEXT_CHARS: usize = 8_000;
const MAX_PADDING_SECONDS: f64 = 2.0;
const MAX_SEQUENCE_SECONDS: f64 = 86_400.0;
const EPSILON: f64 = 0.001;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Target {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selection {
    pub segment_id: String,
    pub action: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub schema_version: u8,
    pub item_id: String,
    pub video: Target,
    #[serde(default)]
    pub audio: Option<Target>,
    pub transcript_offset_seconds: f64,
    #[serde(default)]
    pub padding_seconds: f64,
    #[serde(default)]
    pub ripple: bool,
    pub selections: Vec<Selection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipState {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SegmentView {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub sequence_start: f64,
    pub sequence_end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum EditOperation {
    Trim {
        start_seconds: f64,
        end_seconds: f64,
    },
    Delete {
        ripple: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetEdit {
    pub target: Target,
    pub signature: String,
    pub operation: EditOperation,
}

#[derive(Debug, Clone, Serialize)]
pub struct MarkerPlan {
    pub segment_id: String,
    pub marker_type: String,
    pub name: String,
    pub seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub schema_version: u8,
    pub supported: bool,
    pub transcript_snapshot: String,
    pub catalog: Vec<SegmentView>,
    pub remove_ranges: Vec<[f64; 2]>,
    pub edits: Vec<TargetEdit>,
    pub markers: Vec<MarkerPlan>,
    pub unsupported_reasons: Vec<String>,
    pub linked_media_inferred: bool,
}

impl Request {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Talking-head transcript edit schema_version must be 1.".into());
        }
        if self.item_id.trim().is_empty() || self.item_id.len() > 240 {
            return Err("Transcript item_id is missing or too long.".into());
        }
        validate_target(&self.video, "video")?;
        if let Some(audio) = &self.audio {
            validate_target(audio, "audio")?;
        }
        if !self.transcript_offset_seconds.is_finite()
            || self.transcript_offset_seconds < 0.0
            || self.transcript_offset_seconds > MAX_SEQUENCE_SECONDS
        {
            return Err("transcript_offset_seconds is outside bounds.".into());
        }
        if !self.padding_seconds.is_finite()
            || self.padding_seconds < 0.0
            || self.padding_seconds > MAX_PADDING_SECONDS
        {
            return Err("padding_seconds must be between 0 and 2 seconds.".into());
        }
        if self.selections.is_empty() || self.selections.len() > MAX_SELECTIONS {
            return Err("Talking-head editing requires 1–128 explicit transcript selections.".into());
        }
        let mut seen = HashSet::new();
        for selection in &self.selections {
            if selection.segment_id.trim().is_empty() || selection.segment_id.len() > 32 {
                return Err("Transcript selection segment_id is invalid.".into());
            }
            if !seen.insert(selection.segment_id.as_str()) {
                return Err("Transcript selection IDs must be unique.".into());
            }
            if !matches!(selection.action.as_str(), "keep" | "remove" | "chapter" | "highlight") {
                return Err("Transcript selection action must be keep, remove, chapter, or highlight.".into());
            }
            if let Some(label) = &selection.label {
                if label.chars().count() > 120 {
                    return Err("Transcript marker label is too long.".into());
                }
            }
        }
        if self.ripple && self.audio.is_some() {
            return Err("Ripple transcript deletion is not allowed with separate video+audio targets because native linked membership is unverified.".into());
        }
        Ok(())
    }
}

fn validate_target(target: &Target, expected_kind: &str) -> Result<(), String> {
    if target.kind != expected_kind {
        return Err(format!("Expected an explicit {expected_kind} target."));
    }
    if target.track > 128 || target.clip_index > 10_000 {
        return Err("Talking-head target is outside track/clip bounds.".into());
    }
    Ok(())
}

fn finite_time(value: f64) -> bool {
    value.is_finite() && value >= 0.0 && value <= MAX_SEQUENCE_SECONDS
}

fn segment_id(index: usize) -> String {
    format!("seg-{:04}", index + 1)
}

fn hash_bytes(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn hash_text(hash: u64, value: &str) -> u64 {
    hash_bytes(hash, value.as_bytes())
}

fn transcript_catalog(segments: &[Value], offset: f64) -> Result<(Vec<SegmentView>, String), String> {
    if segments.is_empty() || segments.len() > MAX_SEGMENTS {
        return Err("Transcript requires 1–256 complete timed segments.".into());
    }
    let mut catalog = Vec::with_capacity(segments.len());
    let mut snapshot = 0xcbf29ce484222325u64;
    let mut previous_end = -1.0f64;

    for (index, segment) in segments.iter().enumerate() {
        let start = segment.get("start").and_then(Value::as_f64).ok_or("Transcript start is missing.")?;
        let end = segment.get("end").and_then(Value::as_f64).ok_or("Transcript end is missing.")?;
        let text = segment.get("text").and_then(Value::as_str).ok_or("Transcript text is missing.")?;
        if !finite_time(start)
            || !finite_time(end)
            || end <= start
            || start + EPSILON < previous_end
            || text.trim().is_empty()
            || text.chars().count() > MAX_TEXT_CHARS
        {
            return Err("Transcript segments must be complete, sorted, non-overlapping and bounded.".into());
        }
        let sequence_start = start + offset;
        let sequence_end = end + offset;
        if !finite_time(sequence_start) || !finite_time(sequence_end) {
            return Err("Mapped transcript timing lies outside the sequence time bound.".into());
        }
        let id = segment_id(index);
        snapshot = hash_text(snapshot, &id);
        snapshot = hash_text(snapshot, &format!("{start:.6}|{end:.6}|{text}"));
        catalog.push(SegmentView {
            id,
            start,
            end,
            sequence_start,
            sequence_end,
            text: text.to_string(),
        });
        previous_end = end;
    }
    Ok((catalog, format!("fnv1a64:{snapshot:016x}")))
}

fn clip_state<'a>(states: &'a [ClipState], target: &Target) -> Result<&'a ClipState, String> {
    states
        .iter()
        .find(|state| {
            state.kind == target.kind
                && state.track == target.track
                && state.clip_index == target.clip_index
        })
        .ok_or_else(|| format!("Exact {} target is missing from the inspected timeline.", target.kind))
}

fn merge_ranges(mut ranges: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    ranges.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut() {
            if range[0] <= last[1] + EPSILON {
                last[1] = last[1].max(range[1]);
                continue;
            }
        }
        merged.push(range);
    }
    merged
}

fn operation_for_clip(
    clip: &ClipState,
    ranges: &[[f64; 2]],
    ripple: bool,
) -> Result<Option<EditOperation>, String> {
    if !finite_time(clip.start_seconds)
        || !finite_time(clip.end_seconds)
        || clip.end_seconds <= clip.start_seconds
        || clip.signature.trim().is_empty()
    {
        return Err("Inspected clip timing/signature is incomplete.".into());
    }
    if ranges.is_empty() {
        return Ok(None);
    }
    for range in ranges {
        if range[0] < clip.start_seconds - EPSILON || range[1] > clip.end_seconds + EPSILON {
            return Err("A selected transcript range lies outside the exact target clip.".into());
        }
    }

    let mut left = clip.start_seconds;
    let mut right = clip.end_seconds;
    let mut interior = false;
    for range in ranges {
        let touches_left = range[0] <= clip.start_seconds + EPSILON;
        let touches_right = range[1] >= clip.end_seconds - EPSILON;
        if touches_left {
            left = left.max(range[1]);
        } else if touches_right {
            right = right.min(range[0]);
        } else {
            interior = true;
        }
    }
    if interior {
        return Err("Selected removal creates an interior hole; a verified split path is required before this cut can execute.".into());
    }
    if left >= right - EPSILON {
        return Ok(Some(EditOperation::Delete { ripple }));
    }
    if left > clip.start_seconds + EPSILON || right < clip.end_seconds - EPSILON {
        return Ok(Some(EditOperation::Trim {
            start_seconds: left,
            end_seconds: right,
        }));
    }
    Ok(None)
}

pub fn build_plan(
    segments: &[Value],
    request: &Request,
    states: &[ClipState],
) -> Result<Plan, String> {
    request.validate()?;
    let (catalog, snapshot) = transcript_catalog(segments, request.transcript_offset_seconds)?;
    let by_id: HashMap<&str, &SegmentView> = catalog.iter().map(|segment| (segment.id.as_str(), segment)).collect();

    let mut remove_ranges = Vec::new();
    let mut markers = Vec::new();
    for selection in &request.selections {
        let segment = by_id
            .get(selection.segment_id.as_str())
            .copied()
            .ok_or_else(|| format!("Unknown transcript segment ID {}.", selection.segment_id))?;
        match selection.action.as_str() {
            "remove" => {
                let start = (segment.sequence_start - request.padding_seconds).max(0.0);
                let end = (segment.sequence_end + request.padding_seconds).min(MAX_SEQUENCE_SECONDS);
                remove_ranges.push([start, end]);
            }
            "chapter" | "highlight" => {
                let marker_type = if selection.action == "chapter" { "Chapter" } else { "Comment" };
                let default_name = if selection.action == "chapter" { "Chapter" } else { "Highlight" };
                markers.push(MarkerPlan {
                    segment_id: selection.segment_id.clone(),
                    marker_type: marker_type.into(),
                    name: selection
                        .label
                        .as_deref()
                        .filter(|label| !label.trim().is_empty())
                        .unwrap_or(default_name)
                        .to_string(),
                    seconds: segment.sequence_start,
                });
            }
            "keep" => {}
            _ => unreachable!(),
        }
    }

    let remove_ranges = merge_ranges(remove_ranges);
    let video = clip_state(states, &request.video)?;
    let mut edits = Vec::new();
    let mut unsupported_reasons = Vec::new();

    match operation_for_clip(video, &remove_ranges, request.ripple) {
        Ok(Some(operation)) => edits.push(TargetEdit {
            target: request.video.clone(),
            signature: video.signature.clone(),
            operation,
        }),
        Ok(None) => {}
        Err(reason) => unsupported_reasons.push(reason),
    }

    if let Some(audio_target) = &request.audio {
        let audio = clip_state(states, audio_target)?;
        if (audio.start_seconds - video.start_seconds).abs() > EPSILON
            || (audio.end_seconds - video.end_seconds).abs() > EPSILON
        {
            unsupported_reasons.push(
                "Explicit audio/video targets do not share the same inspected sequence interval; no linked-media inference is allowed.".into(),
            );
        } else if unsupported_reasons.is_empty() {
            match operation_for_clip(audio, &remove_ranges, false) {
                Ok(Some(operation)) => edits.push(TargetEdit {
                    target: audio_target.clone(),
                    signature: audio.signature.clone(),
                    operation,
                }),
                Ok(None) => {}
                Err(reason) => unsupported_reasons.push(reason),
            }
        }
    }

    Ok(Plan {
        schema_version: 1,
        supported: unsupported_reasons.is_empty(),
        transcript_snapshot: snapshot,
        catalog,
        remove_ranges,
        edits,
        markers,
        unsupported_reasons,
        linked_media_inferred: false,
    })
}

pub fn clip_states_from_timeline(
    timeline: &Value,
    targets: &[Target],
) -> Result<Vec<ClipState>, String> {
    if timeline.get("truncated").and_then(Value::as_bool) != Some(false) {
        return Err("Talking-head editing requires a complete timeline inspection.".into());
    }
    let mut result = Vec::new();
    for target in targets {
        let key = if target.kind == "video" { "videoTracks" } else { "audioTracks" };
        let tracks = timeline.get(key).and_then(Value::as_array).ok_or("Timeline tracks are missing.")?;
        let track = tracks.iter().find(|row| row.get("index").and_then(Value::as_u64) == Some(target.track as u64))
            .ok_or_else(|| format!("{} track {} is missing.", target.kind, target.track))?;
        let items = track.get("items").and_then(Value::as_array).ok_or("Timeline track items are missing.")?;
        let item = items.get(target.clip_index as usize).ok_or_else(|| format!("{} clip {} is missing.", target.kind, target.clip_index))?;
        let start_seconds = item.get("startSeconds").and_then(Value::as_f64).ok_or("Clip start is missing.")?;
        let end_seconds = item.get("endSeconds").and_then(Value::as_f64).ok_or("Clip end is missing.")?;
        let signature = item.get("targetSignature").and_then(Value::as_str).ok_or("Clip target signature is missing.")?.to_string();
        result.push(ClipState {
            kind: target.kind.clone(),
            track: target.track,
            clip_index: target.clip_index,
            start_seconds,
            end_seconds,
            signature,
        });
    }
    Ok(result)
}

pub fn operation_arguments(edit: &TargetEdit) -> Value {
    match &edit.operation {
        EditOperation::Trim { start_seconds, end_seconds } => json!({
            "kind": &edit.target.kind,
            "track": edit.target.track,
            "clipIndex": edit.target.clip_index,
            "startSeconds": start_seconds,
            "endSeconds": end_seconds,
        }),
        EditOperation::Delete { ripple } => json!({
            "kind": edit.target.kind,
            "track": edit.target.track,
            "clipIndex": edit.target.clip_index,
            "ripple": ripple,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rows() -> Vec<Value> {
        vec![
            json!({"start":0.0,"end":2.0,"text":"intro"}),
            json!({"start":2.0,"end":4.0,"text":"middle"}),
            json!({"start":4.0,"end":6.0,"text":"outro"}),
        ]
    }

    fn request(selection: Selection) -> Request {
        Request {
            schema_version: 1,
            item_id: "dialogue".into(),
            video: Target { kind:"video".into(), track:0, clip_index:0 },
            audio: None,
            transcript_offset_seconds: 10.0,
            padding_seconds: 0.0,
            ripple: false,
            selections: vec![selection],
        }
    }

    fn states() -> Vec<ClipState> {
        vec![ClipState { kind:"video".into(), track:0, clip_index:0, start_seconds:10.0, end_seconds:16.0, signature:"sig".into() }]
    }

    #[test]
    fn start_selection_becomes_one_safe_trim() {
        let plan = build_plan(&rows(), &request(Selection{segment_id:"seg-0001".into(),action:"remove".into(),label:None}), &states()).unwrap();
        assert!(plan.supported);
        assert_eq!(plan.edits.len(), 1);
        assert!(matches!(plan.edits[0].operation, EditOperation::Trim{start_seconds,end_seconds} if (start_seconds-12.0).abs()<EPSILON && (end_seconds-16.0).abs()<EPSILON));
    }

    #[test]
    fn interior_selection_requires_verified_split() {
        let plan = build_plan(&rows(), &request(Selection{segment_id:"seg-0002".into(),action:"remove".into(),label:None}), &states()).unwrap();
        assert!(!plan.supported);
        assert!(plan.unsupported_reasons[0].contains("split path"));
    }

    #[test]
    fn chapter_is_marker_not_cut() {
        let plan = build_plan(&rows(), &request(Selection{segment_id:"seg-0002".into(),action:"chapter".into(),label:Some("Part 2".into())}), &states()).unwrap();
        assert!(plan.supported);
        assert!(plan.edits.is_empty());
        assert_eq!(plan.markers[0].seconds, 12.0);
    }

    #[test]
    fn separate_av_ripple_is_rejected() {
        let mut request = request(Selection{segment_id:"seg-0001".into(),action:"remove".into(),label:None});
        request.audio = Some(Target{kind:"audio".into(),track:0,clip_index:0});
        request.ripple = true;
        assert!(request.validate().is_err());
    }
}
