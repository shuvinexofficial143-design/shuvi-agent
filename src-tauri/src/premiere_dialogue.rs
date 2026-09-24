use serde_json::Value;
use crate::premiere_audio::DialogueRegion;

pub fn regions(segments:&[Value],transcript_offset:f64,music_start:f64,duration:f64,merge_gap:f64)->Result<Vec<DialogueRegion>,String>{
    if segments.is_empty()||segments.len()>128||![transcript_offset,music_start,duration,merge_gap].iter().all(|n|n.is_finite())||transcript_offset<0.0||music_start<0.0||duration<=0.0||duration>86400.0||merge_gap<0.0||merge_gap>5.0 {return Err("Dialogue requires 1–128 explicitly timed segments and bounded offsets/gap.".into());}
    let mut result=Vec::<DialogueRegion>::new();
    for segment in segments {
        let start=segment.get("start").and_then(Value::as_f64).ok_or("Transcript start is missing.")?;
        let end=segment.get("end").and_then(Value::as_f64).ok_or("Transcript end is missing.")?;
        let text=segment.get("text").and_then(Value::as_str).ok_or("Transcript text is missing.")?;
        if text.trim().is_empty()||text.len()>8000||!start.is_finite()||!end.is_finite()||start<0.0||end<=start{return Err("Transcript segment is invalid.".into());}
        let relative_start=start+transcript_offset-music_start;
        let relative_end=end+transcript_offset-music_start;
        if relative_start<0.0||relative_end>duration {return Err("Transcript region lies outside the explicitly mapped music parameter time domain.".into());}
        if let Some(last)=result.last_mut() {
            if relative_start<last.end {return Err("Transcript regions overlap; inspect and resolve before automation.".into());}
            if relative_start-last.end<=merge_gap {last.end=relative_end;continue;}
        }
        result.push(DialogueRegion{start:relative_start,end:relative_end});
    }
    Ok(result)
}

#[cfg(test)] mod tests {use super::*;use serde_json::json;
    #[test]fn merges_only_explicit_gaps(){let rows=[json!({"start":0,"end":1,"text":"A"}),json!({"start":1.1,"end":2,"text":"B"})];assert_eq!(regions(&rows,2.0,2.0,10.0,0.2).unwrap().len(),1);assert_eq!(regions(&rows,2.0,2.0,10.0,0.0).unwrap().len(),2);}
    #[test]fn refuses_overlaps_and_ungrounded_offsets(){let rows=[json!({"start":0,"end":2,"text":"A"}),json!({"start":1,"end":3,"text":"B"})];assert!(regions(&rows,0.0,0.0,10.0,0.0).is_err());assert!(regions(&rows,0.0,1.0,10.0,0.0).is_err());}
}
