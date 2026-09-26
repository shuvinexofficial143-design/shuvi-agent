use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::collections::HashSet;

use crate::premiere_graphics::Batch as GraphicsBatch;

const MAX_SHOTS: usize = 64;
const MAX_CHAPTERS: usize = 32;
const MAX_TRANSITIONS: usize = 32;
const MAX_MUSIC: usize = 8;
const MAX_BEATS: usize = 256;
const MAX_REVIEW_TIMES: usize = 8;
const EPSILON: f64 = 0.001;

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Shot {
    pub item_id:String,
    pub timeline_seconds:f64,
    pub video_track:u32,
    pub audio_track:u32,
    pub mode:String,
    #[serde(default)] pub source_in:Option<f64>,
    #[serde(default)] pub source_out:Option<f64>,
    #[serde(default)] pub role:Option<String>,
    #[serde(default)] pub beat_index:Option<u32>,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Chapter {pub name:String,pub seconds:f64}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub shot_index:u32,
    pub match_name:String,
    pub duration_seconds:f64,
    pub position:String,
    #[serde(default)] pub force_single_sided:bool,
}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Music {
    pub item_id:String,
    pub timeline_seconds:f64,
    pub video_track:u32,
    pub audio_track:u32,
    #[serde(default="insert_mode")] pub mode:String,
}

fn insert_mode()->String{"insert".into()}

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Assembly {
    pub schema_version:u32,
    pub shots:Vec<Shot>,
    #[serde(default)] pub chapters:Vec<Chapter>,
    #[serde(default)] pub transitions:Vec<Transition>,
    #[serde(default)] pub music:Vec<Music>,
    #[serde(default)] pub graphics:Option<GraphicsBatch>,
    #[serde(default)] pub beats:Vec<f64>,
    #[serde(default)] pub review:bool,
}

fn bounded_time(value:f64)->bool {
    value.is_finite() && (0.0..=86400.0).contains(&value)
}
fn item_id_ok(value:&str)->bool {
    !value.trim().is_empty() && value.len()<=240
}

impl Assembly {
    pub fn shot_seconds(&self, shot:&Shot)->Result<f64,String>{
        if let Some(index)=shot.beat_index {
            self.beats.get(index as usize).copied().ok_or_else(||format!("Shot beat_index {index} is outside supplied beats."))
        } else {
            Ok(shot.timeline_seconds)
        }
    }

    pub fn all_item_ids(&self)->Vec<&str>{
        self.shots.iter().map(|shot|shot.item_id.as_str())
            .chain(self.music.iter().map(|music|music.item_id.as_str())).collect()
    }

    pub fn review_times(&self)->Result<Vec<f64>,String>{
        let mut result=Vec::new();
        let mut seen=HashSet::new();
        for shot in &self.shots {
            let seconds=self.shot_seconds(shot)?;
            let key=(seconds*1000.0).round() as i64;
            if seen.insert(key) {
                result.push(seconds);
                if result.len()==MAX_REVIEW_TIMES {break;}
            }
        }
        Ok(result)
    }

    pub fn validate(&self)->Result<(),String>{
        if !matches!(self.schema_version,1|2)
            || self.shots.is_empty()||self.shots.len()>MAX_SHOTS
            || self.chapters.len()>MAX_CHAPTERS
        {
            return Err("Assembly requires schema v1/v2, 1–64 shots and at most 32 chapters.".into());
        }
        if self.schema_version==1 && (!self.transitions.is_empty()||!self.music.is_empty()||self.graphics.is_some()||!self.beats.is_empty()||self.review) {
            return Err("Advanced transitions/music/graphics/beats/review require assembly schema_version 2.".into());
        }
        if self.transitions.len()>MAX_TRANSITIONS||self.music.len()>MAX_MUSIC||self.beats.len()>MAX_BEATS {
            return Err("Advanced assembly exceeds transition/music/beat bounds.".into());
        }
        for beat in &self.beats {
            if !bounded_time(*beat){return Err("Supplied beat timestamps must be finite sequence seconds.".into());}
        }

        let mut seen=HashSet::new();
        for (i,shot) in self.shots.iter().enumerate(){
            if !item_id_ok(&shot.item_id)||!bounded_time(shot.timeline_seconds)
                ||shot.video_track>128||shot.audio_track>128
                ||!matches!(shot.mode.as_str(),"insert"|"overwrite")
            {
                return Err(format!("Shot {i} has invalid typed placement."));
            }
            if let Some(role)=&shot.role {
                if !matches!(role.as_str(),"a_roll"|"b_roll"|"overlay") {
                    return Err(format!("Shot {i} role must be a_roll, b_roll, or overlay."));
                }
            }
            let source_range=match (shot.source_in,shot.source_out) {
                (None,None)=>None,
                (Some(start),Some(end)) if bounded_time(start)&&bounded_time(end)&&end>start=>Some((start,end)),
                _=>return Err(format!("Shot {i} source range requires both valid source_in and source_out.")),
            };
            if self.schema_version==1 && source_range.is_some() {
                return Err(format!("Shot {i}: source ranges require assembly schema_version 2."));
            }
            let seconds=self.shot_seconds(shot)?;
            if !bounded_time(seconds){return Err(format!("Shot {i} resolved timeline time is invalid."));}
            if !seen.insert((seconds.to_bits(),shot.video_track)) {
                return Err("Shots cannot share the same video track/time without explicit order semantics.".into());
            }
        }

        for (i,transition) in self.transitions.iter().enumerate(){
            if transition.shot_index as usize>=self.shots.len()
                ||transition.match_name.trim().is_empty()||transition.match_name.len()>240
                ||!transition.duration_seconds.is_finite()||transition.duration_seconds<=0.0||transition.duration_seconds>60.0
                ||!matches!(transition.position.as_str(),"start"|"end")
            {
                return Err(format!("Transition {i} is invalid or references an unknown shot."));
            }
        }

        for (i,music) in self.music.iter().enumerate(){
            if !item_id_ok(&music.item_id)||!bounded_time(music.timeline_seconds)
                ||music.video_track>128||music.audio_track>128
                ||!matches!(music.mode.as_str(),"insert"|"overwrite")
            {
                return Err(format!("Music placement {i} is invalid."));
            }
        }

        for chapter in &self.chapters {
            if chapter.name.trim().is_empty()||chapter.name.len()>240||!bounded_time(chapter.seconds) {
                return Err("Chapter requires bounded explicit title and seconds.".into());
            }
        }
        if let Some(graphics)=&self.graphics {graphics.validate()?;}
        Ok(())
    }
}

pub fn resolve_video_clip_index(timeline:&Value,track:u32,seconds:f64)->Result<u32,String>{
    if timeline.get("truncated").and_then(Value::as_bool)!=Some(false) {
        return Err("Transition correlation requires a complete timeline inspection.".into());
    }
    let tracks=timeline.get("videoTracks").and_then(Value::as_array).ok_or("Timeline video tracks missing.")?;
    let row=tracks.iter().find(|row|row.get("index").and_then(Value::as_u64)==Some(track as u64))
        .ok_or("Transition target video track missing.")?;
    let items=row.get("items").and_then(Value::as_array).ok_or("Transition target clips missing.")?;
    let hits:Vec<_>=items.iter().enumerate().filter(|(_,item)|
        item.get("startSeconds").and_then(Value::as_f64).is_some_and(|start|(start-seconds).abs()<=EPSILON)
    ).collect();
    if hits.len()!=1 {
        return Err("Could not correlate exactly one inserted video clip at the requested shot time.".into());
    }
    Ok(hits[0].0 as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shot()->Shot{Shot{item_id:"exact".into(),timeline_seconds:1.0,video_track:1,audio_track:0,mode:"overwrite".into(),source_in:None,source_out:None,role:Some("b_roll".into()),beat_index:None}}
    #[test]fn v1_stays_compatible_and_advanced_fields_require_v2(){
        let a=Assembly{schema_version:1,shots:vec![shot()],chapters:vec![],transitions:vec![],music:vec![],graphics:None,beats:vec![],review:false};
        a.validate().unwrap();
        let mut b=a.clone();b.schema_version=2;b.shots[0].source_in=Some(1.0);b.shots[0].source_out=Some(3.0);b.validate().unwrap();
        b.schema_version=1;assert!(b.validate().is_err());
    }
    #[test]fn supplied_beats_resolve_shot_time(){
        let mut s=shot();s.beat_index=Some(1);
        let a=Assembly{schema_version:2,shots:vec![s],chapters:vec![],transitions:vec![],music:vec![],graphics:None,beats:vec![2.0,4.5],review:true};
        a.validate().unwrap();assert_eq!(a.review_times().unwrap(),vec![4.5]);
    }
    #[test]fn transition_clip_resolution_is_exact(){
        let timeline=json!({"truncated":false,"videoTracks":[{"index":1,"items":[{"startSeconds":1.0},{"startSeconds":5.0}]}]});
        assert_eq!(resolve_video_clip_index(&timeline,1,5.0).unwrap(),1);
        let ambiguous=json!({"truncated":false,"videoTracks":[{"index":1,"items":[{"startSeconds":1.0},{"startSeconds":1.0}]}]});
        assert!(resolve_video_clip_index(&ambiguous,1,1.0).is_err());
    }
}
