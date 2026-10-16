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
#[cfg(test)]mod tests {
    use super::*;
    fn mapping()->premiere_graphics::SavedMapping {
        serde_json::from_value(json!({"revision":4,"mapping":{
            "schema_version":1,"name":"Captions","template":{"source":"library",
            "library_name":"Shuvi","element_name":"Dynamic Caption"},
            "fields":[
              {"role":"caption_text","component_match_name":"native.text","component_display_name":null,"param_display_name":"Source Text","primitive_type":"string"},
              {"role":"accent","component_match_name":"native.accent","component_display_name":null,"param_display_name":"Show Accent","primitive_type":"boolean"}]
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
            static_fields:BTreeMap::from([("accent".into(),json!(true))])},path)
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
