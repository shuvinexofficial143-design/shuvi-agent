use serde::Deserialize;
use std::{fs::{self, OpenOptions}, io::Write, path::Path};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cue { pub start: f64, pub end: f64, pub text: String }

pub fn serialize(cues: &[Cue]) -> Result<String, String> {
    if cues.is_empty() || cues.len() > 5000 { return Err("SRT requires 1–5000 explicit cues.".into()); }
    let mut out = String::new();
    let mut text_bytes = 0usize;
    let mut ordered: Vec<_> = cues.iter().collect();
    ordered.sort_by(|a,b| a.start.total_cmp(&b.start).then(a.end.total_cmp(&b.end)));
    for (i,c) in ordered.into_iter().enumerate() {
        if !c.start.is_finite() || !c.end.is_finite() || c.start < 0.0 || c.end > 86400.0 || c.end <= c.start ||
           (c.end * 1000.0).round() <= (c.start * 1000.0).round() { return Err("Invalid cue timing.".into()); }
        let text = c.text.replace("\r\n", "\n").replace('\r', "\n");
        let text = text.trim();
        text_bytes += text.len();
        if text.is_empty() || text.len() > 8000 || text_bytes > 512 * 1024 { return Err("Caption text exceeds bounds or is empty.".into()); }
        out.push_str(&format!("{}\n{} --> {}\n{}\n\n",i+1,timestamp(c.start),timestamp(c.end),text));
        if out.len() > 1024 * 1024 { return Err("SRT output exceeds 1 MiB.".into()); }
    }
    Ok(out)
}

fn timestamp(seconds: f64) -> String {
    let ms = (seconds * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02},{:03}",ms/3_600_000,(ms/60_000)%60,(ms/1000)%60,ms%1000)
}

pub fn validate_output(path: &str, overwrite: bool) -> Result<(), String> {
    if path.len() > 4096 || path.is_empty() || path.chars().any(|c|c.is_control()) { return Err("SRT path exceeds bound or contains controls.".into()); }
    let p = Path::new(path);
    if !p.is_absolute() || !p.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("srt")) || !p.parent().is_some_and(Path::is_dir) {
        return Err("SRT requires an absolute .srt path with an existing parent.".into());
    }
    let filename = p.file_name().and_then(|s|s.to_str()).ok_or("SRT filename is invalid.")?;
    if filename.ends_with(' ') || filename.ends_with('.') || filename.chars().any(|c| "<>:\"|?*".contains(c)) ||
       matches!(filename.split('.').next().unwrap_or("").to_ascii_uppercase().as_str(), "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"LPT1") {
        return Err("SRT filename is invalid or reserved.".into());
    }
    if let Ok(m) = fs::symlink_metadata(p) {
        if !m.is_file() || m.file_type().is_symlink() { return Err("SRT output must be a regular file, never a symlink or directory.".into()); }
        if !overwrite { return Err("SRT exists; explicit overwrite=true required.".into()); }
    }
    Ok(())
}

pub fn write(path: &str, overwrite: bool, cues: &[Cue]) -> Result<serde_json::Value, String> {
    let srt = serialize(cues)?;
    validate_output(path, overwrite)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(!overwrite).create(overwrite).truncate(overwrite);
    let mut file = options.open(path).map_err(|e| format!("SRT output could not be opened: {e}"))?;
    file.write_all(srt.as_bytes()).map_err(|e|format!("SRT write failed: {e}"))?;
    file.sync_all().map_err(|e|format!("SRT sync failed: {e}"))?;
    Ok(serde_json::json!({"path":path,"cue_count":cues.len(),"duration":cues.iter().map(|c|c.end).fold(0.0,f64::max),"bytes_written":srt.len()}))
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn write_safe_srt() {
        let path=std::env::temp_dir().join(format!("shuvi-sub-{}.srt",std::process::id()));
        let _=fs::remove_file(&path);
        let p=path.to_str().unwrap();
        let cues=[Cue{start:0.0,end:2.5,text:"Hi 👋".into()}];
        assert_eq!(write(p,false,&cues).unwrap()["cue_count"],1);
        assert!(fs::read_to_string(p).unwrap().contains("00:00:02,500"));
        assert!(write(p,false,&cues).is_err());
        assert_eq!(write(p,true,&cues).unwrap()["bytes_written"].as_u64().unwrap(),fs::metadata(p).unwrap().len());
        fs::remove_file(&path).unwrap();
    }
    #[test] fn rejects_bad_timing_and_path() {
        assert!(serialize(&[Cue{start:1.0,end:1.0,text:"bad".into()}]).is_err());
        assert!(serialize(&vec![Cue{start:0.0,end:1.0,text:"x".into()};5001]).is_err());
        assert!(validate_output("relative.srt",false).is_err());
        assert!(validate_output(std::env::temp_dir().to_str().unwrap(),false).is_err());
    }
}
