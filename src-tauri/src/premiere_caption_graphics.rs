//! Exact source-bound bridge from selective SRT captions to existing native
//! mapped-MOGRT graphics batches. Planning is READ-ONLY. Applying the returned
//! Premiere graphics batch requires its own owner-approved high-risk action.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs::{self,File},io::Read,path::Path};
use crate::{premiere_selective_captions,premiere_graphics};

const MAX_SOURCE_BYTES:u64=128*1024;
const MAX_GRAPHICS:usize=32;

#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version:u8,
    pub captions:premiere_selective_captions::Request,
    pub expected_srt_sha256:String,
    pub mapping:String,
    pub revision:u32,
    pub video_track:u32,
    pub audio_track:u32,
    // Explicit values for EVERY mapping field other than "caption_text".
    // There are no silent defaults, UI guesses or style inference.
    pub static_fields:BTreeMap<String,Value>,
}
impl Request {
    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1 || self.expected_srt_sha256.len()!=64
            || !self.expected_srt_sha256.bytes().all(|b|b.is_ascii_hexdigit())
            || self.revision==0||self.video_track>128||self.audio_track>128
            || self.static_fields.len()>15||self.static_fields.contains_key("caption_text"){
            return Err("Caption graphics requires a bounded SRT SHA, mapping revision, existing tracks and explicitly separate static roles.".into());
        }
        self.captions.validate()?;
        premiere_graphics::validate_name(&self.mapping)?;
        let count=self.captions.cues.iter().filter(|c|c.selected).count();
        if count==0||count>MAX_GRAPHICS {
            return Err("One caption graphics batch supports 1–32 selected cues; split and approve larger groups separately.".into());
        }
        Ok(())
    }
}
fn read_exact_srt(request:&Request)->Result<(String,u64),String>{
    let (expected,_selected_indexes)=request.captions.render()?;
    let path=Path::new(&request.captions.output);
    let before=fs::symlink_metadata(path).map_err(|e|format!("Caption graphics source missing: {e}"))?;
    if !before.is_file()||before.file_type().is_symlink()||before.len()==0
        ||before.len()>MAX_SOURCE_BYTES||before.len()!=expected.len() as u64 {
        return Err("Caption graphics requires a regular exact-size generated SRT source.".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if before.file_attributes() & 0x400 != 0 {
            return Err("Caption source is a Windows reparse point.".into());
        }
    }
    let mut read=Vec::with_capacity(expected.len());
    let file=File::open(path).map_err(|e|e.to_string())?;
    file.take(MAX_SOURCE_BYTES+1).read_to_end(&mut read)
        .map_err(|e|format!("Cannot verify caption bytes: {e}"))?;
    let after=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if !after.is_file()||after.file_type().is_symlink()
        ||after.len()!=before.len()||after.modified().ok()!=before.modified().ok()
        ||read!=expected{
        return Err("Caption file content or metadata differs from the exact selected manifest.".into());
    }
    let hash=format!("{:x}",Sha256::digest(&read));
    if !hash.eq_ignore_ascii_case(&request.expected_srt_sha256) {
        return Err("Caption SRT SHA256 no longer matches the owner-approved source identity.".into());
    }
    Ok((hash,read.len() as u64))
}
/// Strict, exact data-only conversion. No MOGRT installation, project writes,
/// Adobe calls, or unapproved animation actions occur in this function.
pub fn plan(req:&Request,saved:&premiere_graphics::SavedMapping)->Result<Value,String>{
    req.validate()?;
    if req.mapping!=saved.mapping.name||req.revision!=saved.revision {
        return Err("MOGRT mapping changed; inspect and approve its new exact revision.".into());
    }
    saved.mapping.validate()?;
    let text_fields:Vec<_>=saved.mapping.fields.iter()
        .filter(|f|f.role=="caption_text"&&f.primitive_type=="string").collect();
    if text_fields.len()!=1 || saved.mapping.fields.iter().any(|f|
        f.role=="caption_text"&&f.primitive_type!="string") {
        return Err("The saved MOGRT needs exactly one string caption_text role; never infer arbitrary text parameters.".into());
    }
    let others=saved.mapping.fields.iter().filter(|f|f.role!="caption_text").count();
    if req.static_fields.len()!=others
        ||saved.mapping.fields.iter().filter(|f|f.role!="caption_text").any(|f|
            !req.static_fields.contains_key(&f.role)) {
        return Err("Every non-caption MOGRT role needs one explicit static value.".into());
    }
    let (sha,size)=read_exact_srt(req)?;
    let mut items=Vec::new();
    let mut origin_indexes=Vec::new();
    for (index,cue) in req.captions.cues.iter().enumerate(){
        if !cue.selected {continue;}
        let mut fields=req.static_fields.clone();
        fields.insert("caption_text".into(),json!(cue.text));
        let start=(cue.start_seconds*1000.0).round()/1000.0;
        let end=(cue.end_seconds*1000.0).round()/1000.0;
        if end<=start {return Err("Caption duration lost precision at the millisecond grid.".into());}
        items.push(premiere_graphics::Item{seconds:start,
            duration_seconds:Some(end-start),fields});
        origin_indexes.push(index);
    }
    let batch=premiere_graphics::Batch{
        mapping:req.mapping.clone(),revision:req.revision,
        video_track:req.video_track,audio_track:req.audio_track,items
    };
    batch.resolve(saved)?;
    Ok(json!({
        "schema_version":1,
        "caption_graphics_plan_ready":true,
        "generated_batch":batch,
        "source_srt_path":req.captions.output,
        "source_srt_sha256":sha,
        "source_srt_bytes":size,
        "selected_original_cue_indexes":origin_indexes,
        "mapped_caption_role":"caption_text",
        "requires_next_tool":"premiere_batch_graphics",
        "requires_new_high_risk_approval":true,
        "mapping_revision_bound":saved.revision,
        "saved_mapping_reference_inspected":false,
        "native_timeline_collision_checked":false,
        "native_graphics_inserted":false,
        "captions_burned_in":false,
        "adobe_host_tested":false,
        "retry_automatically":false
    }))
}
/// Read-only, fail-closed occupancy check against an exact native Premiere
/// timeline snapshot. It eliminates known collisions BEFORE starting a batch,
/// but does not guarantee that a later Adobe write cannot race this snapshot.
pub fn preflight_timeline(
    batch:&premiere_graphics::Batch,
    timeline:&Value,
    project_guid:&str,
    project_path:Option<&str>,
    sequence_guid:&str
)->Result<Value,String>{
    batch.validate()?;
    if timeline.get("truncated")!=Some(&json!(false))
        ||timeline.get("sequenceGuid").and_then(Value::as_str)!=Some(sequence_guid)
        ||timeline.pointer("/expected/project_guid").and_then(Value::as_str)!=Some(project_guid)
        ||timeline.pointer("/expected/sequence_guid").and_then(Value::as_str)!=Some(sequence_guid)
        ||project_path.is_some_and(|path|
            timeline.pointer("/expected/project_path").and_then(Value::as_str)!=Some(path)) {
        return Err("Native Premiere timeline snapshot is missing, truncated, or changed project/sequence identity.".into());
    }
    let mut checked=0usize;
    let mut destination_rows=0usize;
    for (category,track_index) in [
        ("videoTracks",batch.video_track),("audioTracks",batch.audio_track)
    ] {
        let tracks=timeline.get(category).and_then(Value::as_array)
            .ok_or("Native timeline is missing destination tracks.")?;
        if tracks.len()>129 {return Err("Timeline track inventory is oversized.".into());}
        let matches:Vec<&Value>=tracks.iter().filter(|t|
            t.get("index").and_then(Value::as_u64)==Some(track_index as u64)).collect();
        if matches.len()!=1 {return Err("Missing or ambiguous caption graphics destination track.".into());}
        let clips=matches[0].get("items").and_then(Value::as_array)
            .ok_or("Caption destination lacks a complete native item inventory.")?;
        if clips.len()>240 {return Err("Caption destination track inventory is oversized.".into());}
        for clip in clips {
            let start=clip.get("startSeconds").and_then(Value::as_f64)
                .ok_or("Destination clip missing start time.")?;
            let end=clip.get("endSeconds").and_then(Value::as_f64)
                .ok_or("Destination clip missing end time.")?;
            if !start.is_finite()||!end.is_finite()||start<0.0||end<=start||end>86400.0 {
                return Err("Destination clip has incomplete or invalid native timing.".into());
            }
            destination_rows+=1;
            for item in &batch.items {
                let end_caption=item.seconds+item.duration_seconds
                    .ok_or("Caption graphics preflight requires exact per-cue duration.")?;
                if item.seconds<end && start<end_caption {
                    return Err(format!(
                        "Caption graphics destination {category} track {track_index} is occupied at requested caption time; no native insert attempted."
                    ));
                }
                checked+=1;
            }
        }
    }
    Ok(json!({
        "destination_video_track":batch.video_track,
        "destination_audio_track":batch.audio_track,
        "caption_count":batch.items.len(),
        "existing_destination_clips":destination_rows,
        "interval_pairs_checked":checked,
        "conflicts_found":0,
        "native_snapshot_collision_preflight_passed":true,
        "native_insertion_race_excluded":false,
        "adobe_runtime_verified":false,
        "retry_automatically":false
    }))
}

#[cfg(test)]mod tests {
    use super::*;
    fn mapping()->premiere_graphics::SavedMapping {
        serde_json::from_value(json!({"revision":4,"mapping":{
            "schema_version":1,"name":"Captions","template":{"source":"library",
            "library_name":"Shuvi","element_name":"Dynamic Caption"},
            "fields":[
              {"role":"caption_text","component_match_name":"native.text","component_display_name":null,"param_display_name":"Source Text","primitive_type":"string"},
              {"role":"accent","component_match_name":"native.accent","component_display_name":null,"param_display_name":"Show Accent","primitive_type":"boolean"},
              {"role":"position","component_match_name":"native.position","component_display_name":null,"param_display_name":"Text Position","primitive_type":"point"},
              {"role":"accent_color","component_match_name":"native.color","component_display_name":null,"param_display_name":"Accent RGBA","primitive_type":"color"}]
        }})).unwrap()
    }
    fn fixture()->(Request,std::path::PathBuf) {
        let path=std::env::temp_dir().join(format!("shuvi-mogrt-captions-{}.srt",uuid::Uuid::new_v4()));
        let captions=premiere_selective_captions::Request {
            schema_version:1,output:path.to_string_lossy().into_owned(),duration_seconds:30.0,
            cues:vec![
                premiere_selective_captions::Cue{start_seconds:0.0,end_seconds:1.5,text:"Hello there".into(),selected:true},
                premiere_selective_captions::Cue{start_seconds:1.5,end_seconds:2.2,text:"not selected".into(),selected:false},
                premiere_selective_captions::Cue{start_seconds:2.2,end_seconds:4.1,text:"बढ़िया है".into(),selected:true}],
            source_transcript_sha256:None
        };
        let bytes=captions.render().unwrap().0;
        let sha=format!("{:x}",Sha256::digest(&bytes));
        fs::write(&path,&bytes).unwrap();
        (Request{schema_version:1,captions,expected_srt_sha256:sha,
            mapping:"Captions".into(),revision:4,video_track:2,audio_track:0,
            static_fields:BTreeMap::from([
                ("accent".into(),json!(true)),
                ("position".into(),json!({"type":"point","x":0.5,"y":0.82})),
                ("accent_color".into(),json!({"type":"color","red":1,"green":0.28,"blue":0.08,"alpha":1}))
            ])},path)
    }
    #[test] fn exact_manifest_hash_and_mapping_yield_native_executable_batch_without_host_write(){
        let (request,path)=fixture();
        let result=plan(&request,&mapping()).unwrap();
        assert_eq!(result["caption_graphics_plan_ready"],true);
        assert_eq!(result["generated_batch"]["items"].as_array().unwrap().len(),2);
        assert_eq!(result["generated_batch"]["items"][0]["fields"]["caption_text"],"Hello there");
        assert_eq!(result["generated_batch"]["items"][1]["fields"]["caption_text"],"बढ़िया है");
        assert_eq!(result["generated_batch"]["items"][1]["seconds"],2.2);
        assert!((result["generated_batch"]["items"][1]["duration_seconds"].as_f64().unwrap()-1.9).abs()<1e-9);
        assert_eq!(result["selected_original_cue_indexes"],json!([0,2]));
        assert_eq!(result["generated_batch"]["items"][0]["fields"]["position"]["type"],"point");
        assert_eq!(result["generated_batch"]["items"][0]["fields"]["accent_color"]["type"],"color");
        assert_eq!(result["generated_batch"]["items"][1]["fields"]["accent_color"]["green"],json!(0.28));
        assert_eq!(result["requires_new_high_risk_approval"],true);
        assert_eq!(result["native_graphics_inserted"],false);
        fs::remove_file(path).unwrap();
    }
    #[test] fn edited_srt_bytes_bad_hash_and_wrong_mapping_fail_closed(){
        let (mut request,path)=fixture();
        request.expected_srt_sha256="0".repeat(64);
        assert!(plan(&request,&mapping()).is_err());
        request.expected_srt_sha256=format!("{:x}",Sha256::digest(fs::read(&path).unwrap()));
        fs::write(&path,b"modified").unwrap();
        assert!(plan(&request,&mapping()).is_err());
        fs::remove_file(path).unwrap();
        assert!(plan(&request,&mapping()).is_err());
    }
    #[test] fn structured_caption_style_coordinates_and_rgba_must_match_saved_types(){
        let (mut request,path)=fixture();
        plan(&request,&mapping()).unwrap();
        request.static_fields.insert("position".into(),json!({"x":0.5,"y":0.82}));
        assert!(plan(&request,&mapping()).is_err());
        request.static_fields.insert("position".into(),json!({"type":"point","x":0.5,"y":0.82,"script":"bad"}));
        assert!(plan(&request,&mapping()).is_err());
        request.static_fields.insert("position".into(),json!({"type":"point","x":0.5,"y":0.82}));
        request.static_fields.insert("accent_color".into(),json!({"type":"color","red":1,"green":1,"blue":1,"alpha":-0.5}));
        assert!(plan(&request,&mapping()).is_err());
        fs::remove_file(path).unwrap();
    }
    #[test] fn caption_timeline_preflight_blocks_occupied_destination_before_edit(){
        let (request,path)=fixture();
        let batch:premiere_graphics::Batch=serde_json::from_value(
            plan(&request,&mapping()).unwrap()["generated_batch"].clone()).unwrap();
        let base=json!({"truncated":false,"sequenceGuid":"S",
            "expected":{"project_guid":"P","project_path":"C:/edit.prproj","sequence_guid":"S","clips":[]},
            "videoTracks":[{"index":2,"items":[]}],
            "audioTracks":[{"index":0,"items":[]}]});
        let good=preflight_timeline(&batch,&base,"P",Some("C:/edit.prproj"),"S").unwrap();
        assert_eq!(good["native_snapshot_collision_preflight_passed"],true);
        assert_eq!(good["native_insertion_race_excluded"],false);
        let mut occupied=base.clone();
        occupied["videoTracks"][0]["items"]=json!([{"startSeconds":2.5,"endSeconds":3.0}]);
        assert!(preflight_timeline(&batch,&occupied,"P",Some("C:/edit.prproj"),"S")
            .unwrap_err().contains("occupied"));
        occupied["videoTracks"][0]["items"]=json!([]);
        occupied["audioTracks"][0]["items"]=json!([{"startSeconds":0.2,"endSeconds":0.8}]);
        assert!(preflight_timeline(&batch,&occupied,"P",Some("C:/edit.prproj"),"S").is_err());
        let mut truncated=base.clone();
        truncated["truncated"]=json!(true);
        assert!(preflight_timeline(&batch,&truncated,"P",Some("C:/edit.prproj"),"S").is_err());
        let mut changed=base.clone();
        changed["sequenceGuid"]=json!("other");
        assert!(preflight_timeline(&batch,&changed,"P",Some("C:/edit.prproj"),"S").is_err());
        let mut no_times=base;
        no_times["videoTracks"][0]["items"]=json!([{"startSeconds":1.0,"endSeconds":null}]);
        assert!(preflight_timeline(&batch,&no_times,"P",Some("C:/edit.prproj"),"S").is_err());
        fs::remove_file(path).unwrap();
    }
    #[test] fn missing_caption_role_bad_static_field_and_too_many_cues_fail(){
        let (mut request,path)=fixture();
        let mut map=mapping();
        map.mapping.fields[0].role="unknown_text".into();
        assert!(plan(&request,&map).is_err());
        request.static_fields.insert("unexpected".into(),json!(1));
        assert!(plan(&request,&mapping()).is_err());
        request.static_fields.remove("unexpected");
        request.captions.cues=(0..33).map(|i|premiere_selective_captions::Cue{
            start_seconds:i as f64,end_seconds:i as f64+0.5,text:"x".into(),selected:true}).collect();
        assert!(request.validate().is_err());
        fs::remove_file(path).unwrap();
    }
}
