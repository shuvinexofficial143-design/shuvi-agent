use serde::{Deserialize,Serialize};
use std::collections::HashSet;

#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Shot {pub item_id:String,pub timeline_seconds:f64,pub video_track:u32,pub audio_track:u32,pub mode:String,
    #[serde(default)]pub source_in:Option<f64>,#[serde(default)]pub source_out:Option<f64>}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Chapter {pub name:String,pub seconds:f64}
#[derive(Debug,Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Assembly {pub schema_version:u32,pub shots:Vec<Shot>,#[serde(default)]pub chapters:Vec<Chapter>}
impl Assembly {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1||self.shots.is_empty()||self.shots.len()>64||self.chapters.len()>32{return Err("Assembly v1 requires 1–64 shots and at most 32 chapters.".into());}
        let mut seen=HashSet::new();
        for (i,s) in self.shots.iter().enumerate(){
            if s.item_id.is_empty()||s.item_id.len()>240||!s.timeline_seconds.is_finite()||s.timeline_seconds<0.0||s.timeline_seconds>86400.0||s.video_track>128||s.audio_track>128||!matches!(s.mode.as_str(),"insert"|"overwrite") {return Err(format!("Shot {i} has invalid typed placement."));}
            if s.source_in.is_some()||s.source_out.is_some(){return Err(format!("Shot {i}: source ranges require an explicitly created subclip; batch source range mutation is unsupported."));}
            if !seen.insert((s.timeline_seconds.to_bits(),s.video_track)) {return Err("Shots cannot share the same video track/time without explicit order semantics.".into());}
        }
        for ch in &self.chapters{if ch.name.trim().is_empty()||ch.name.len()>240||!ch.seconds.is_finite()||ch.seconds<0.0||ch.seconds>86400.0{return Err("Chapter requires bounded explicit title and seconds.".into());}}
        Ok(())
    }
}
#[cfg(test)]mod tests {use super::*;
    #[test]fn validates_broll_and_source_guards(){let mut a=Assembly{schema_version:1,shots:vec![Shot{item_id:"exact".into(),timeline_seconds:1.0,video_track:1,audio_track:0,mode:"overwrite".into(),source_in:None,source_out:None}],chapters:vec![Chapter{name:"Chapter".into(),seconds:1.0}]};a.validate().unwrap();a.shots[0].source_in=Some(0.0);assert!(a.validate().is_err());a.shots[0].source_in=None;a.shots=vec![a.shots[0].clone();65];assert!(a.validate().is_err());}
}
