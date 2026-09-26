use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_LAYER_OPS: usize = 32;
const MAX_TRACK_RENAMES: usize = 32;
const MAX_NAME_CHARS: usize = 120;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceTarget {
    pub kind: String,
    pub track: u32,
    pub clip_index: u32,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloneToTrack {
    pub source: SourceTarget,
    pub destination_track: u32,
    pub destination_seconds: f64,
    pub mode: String,
    #[serde(default = "default_align")]
    pub align_to_video: bool,
}

fn default_align() -> bool { true }

impl CloneToTrack {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.source.kind.as_str(), "video" | "audio") {
            return Err("Layer source kind must be video or audio.".into());
        }
        if self.source.track > 128 || self.source.clip_index > 10_000
            || self.source.signature.is_empty() || self.source.signature.len() > 4096
            || self.destination_track > 128
        {
            return Err("Layer source/destination is outside bounds.".into());
        }
        if self.destination_track == self.source.track {
            return Err("Cross-track clone requires a different existing destination track.".into());
        }
        if !self.destination_seconds.is_finite()
            || !(0.0..=86_400.0).contains(&self.destination_seconds)
        {
            return Err("Layer destination_seconds must be between 0 and 86400.".into());
        }
        if !matches!(self.mode.as_str(), "insert" | "overwrite") {
            return Err("Layer mode must be insert or overwrite.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LayerBatch {
    pub schema_version: u8,
    pub operations: Vec<CloneToTrack>,
}

impl LayerBatch {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Layer batch schema_version must be 1.".into());
        }
        if self.operations.is_empty() || self.operations.len() > MAX_LAYER_OPS {
            return Err("Layer batch requires 1–32 explicit clone operations.".into());
        }
        let mut destinations = HashSet::new();
        for operation in &self.operations {
            operation.validate()?;
            let key = (
                operation.source.kind.clone(),
                operation.destination_track,
                (operation.destination_seconds * 1_000_000.0).round() as i64,
            );
            if !destinations.insert(key) {
                return Err("Layer batch cannot contain duplicate destination kind/track/time placements.".into());
            }
        }
        Ok(())
    }

    pub fn unique_sources(&self) -> Vec<&SourceTarget> {
        let mut seen = HashSet::new();
        let mut values = Vec::new();
        for operation in &self.operations {
            let key = (
                operation.source.kind.as_str(),
                operation.source.track,
                operation.source.clip_index,
            );
            if seen.insert(key) {
                values.push(&operation.source);
            }
        }
        values
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrackRename {
    pub kind: String,
    pub track: u32,
    pub name: String,
}

impl TrackRename {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.kind.as_str(), "video" | "audio" | "caption") || self.track > 128 {
            return Err("Track rename requires a bounded video, audio, or caption track.".into());
        }
        let count = self.name.chars().count();
        if self.name.trim().is_empty() || count > MAX_NAME_CHARS {
            return Err("Track name must contain 1–120 characters.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrackOrganization {
    pub schema_version: u8,
    pub tracks: Vec<TrackRename>,
}

impl TrackOrganization {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Track organization schema_version must be 1.".into());
        }
        if self.tracks.is_empty() || self.tracks.len() > MAX_TRACK_RENAMES {
            return Err("Track organization requires 1–32 explicit existing tracks.".into());
        }
        let mut seen = HashSet::new();
        for track in &self.tracks {
            track.validate()?;
            if !seen.insert((track.kind.as_str(), track.track)) {
                return Err("Track organization contains the same track more than once.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(kind:&str,source:u32,destination:u32,time:f64)->CloneToTrack {
        CloneToTrack {
            source:SourceTarget{kind:kind.into(),track:source,clip_index:0,signature:"sig".into()},
            destination_track:destination,
            destination_seconds:time,
            mode:"overwrite".into(),
            align_to_video:true,
        }
    }

    #[test]
    fn cross_track_clone_requires_distinct_existing_index() {
        assert!(op("video",0,1,5.0).validate().is_ok());
        assert!(op("video",0,0,5.0).validate().is_err());
    }

    #[test]
    fn batch_rejects_duplicate_destination() {
        let batch=LayerBatch{schema_version:1,operations:vec![op("video",0,1,5.0),op("video",2,1,5.0)]};
        assert!(batch.validate().is_err());
    }

    #[test]
    fn track_organization_is_unique_and_bounded() {
        let org=TrackOrganization{schema_version:1,tracks:vec![
            TrackRename{kind:"video".into(),track:0,name:"A-Roll".into()},
            TrackRename{kind:"audio".into(),track:0,name:"Dialogue".into()},
        ]};
        org.validate().unwrap();
    }
}
