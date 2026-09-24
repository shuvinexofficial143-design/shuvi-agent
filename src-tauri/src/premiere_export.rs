use serde::Serialize;
use std::{fs, path::Path};

const MAX_PATH: usize = 4096;

#[derive(Debug, Clone, Serialize)]
pub struct LocalPreflight {
    pub executable: bool,
    pub output: String,
    pub output_exists: bool,
    pub parent_exists: bool,
    pub preset: Option<String>,
    pub preset_exists: Option<bool>,
    pub overwrite: bool,
    pub warnings: Vec<String>,
}

fn same_path(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    { a.replace('/', "\\").eq_ignore_ascii_case(&b.replace('/', "\\")) }
    #[cfg(not(windows))]
    { a == b }
}

fn bounded_absolute(path: &str) -> Result<&Path, String> {
    if path.is_empty() || path.len() > MAX_PATH || path.chars().any(|c| c.is_control()) {
        return Err("Export path must be a bounded absolute path without control characters.".into());
    }
    let path = Path::new(path);
    if !path.is_absolute() { return Err("Export path must be absolute.".into()); }
    Ok(path)
}

fn valid_filename(path: &Path) -> Result<(), String> {
    let name = path.file_name().and_then(|v| v.to_str())
        .ok_or("Export requires a valid filename.")?;
    if name.ends_with('.') || name.ends_with(' ') || name.chars().any(|c| "<>:\"|?*".contains(c))
        || matches!(name, "." | "..") {
        return Err("Export filename is invalid or reserved.".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|"LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9") {
        return Err("Export filename is a reserved Windows device name.".into());
    }
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("");
    if ext.is_empty() || ext.len() > 16 || !ext.bytes().all(|b| b.is_ascii_alphanumeric())
        || matches!(ext.to_ascii_lowercase().as_str(), "prproj"|"epr") {
        return Err("Export requires a usable media filename extension.".into());
    }
    Ok(())
}

pub fn inspect(output: &str, preset: Option<&str>, overwrite: bool, project_path: Option<&str>) -> Result<LocalPreflight, String> {
    let output_path = bounded_absolute(output)?;
    valid_filename(output_path)?;
    let parent = output_path.parent().ok_or("Export output has no parent directory.")?;
    let parent_exists = parent.is_dir();
    let output_exists = output_path.exists();
    let mut warnings = Vec::new();
    if !parent_exists { warnings.push("Output parent directory does not exist.".into()); }
    if output_exists && !output_path.is_file() { warnings.push("Output is not a regular file.".into()); }
    if fs::symlink_metadata(output_path).is_ok_and(|m|m.file_type().is_symlink()) {
        warnings.push("Output is a symbolic link; choose a regular file path.".into());
    }
    if output_exists && !overwrite { warnings.push("Output exists; explicit overwrite=true is required.".into()); }
    if output_exists && overwrite { warnings.push("Approved export may replace the existing file.".into()); }
    if project_path.is_some_and(|p| same_path(output, p)) {
        warnings.push("Output matches the active Premiere project path.".into());
    }
    let preset_exists = if let Some(preset) = preset {
        let path = bounded_absolute(preset)?;
        if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("epr")) {
            return Err("Preset must be an existing .epr file.".into());
        }
        if same_path(output, preset) { warnings.push("Output matches the export preset path.".into()); }
        let exists = path.is_file();
        if !exists { warnings.push("Preset is not an existing regular file.".into()); }
        Some(exists)
    } else { None };
    let executable = warnings.is_empty() || warnings.iter().all(|w| w=="Approved export may replace the existing file.");
    Ok(LocalPreflight {executable,output:output.into(),output_exists,parent_exists,
        preset:preset.map(str::to_string),preset_exists,overwrite,warnings})
}

pub fn observation(output: &str, existed_before: bool) -> serde_json::Value {
    let metadata = fs::metadata(output).ok().filter(|m|m.is_file());
    serde_json::json!({"existed_before":existed_before,
        "exists_after":metadata.is_some(),"size_bytes_after":metadata.as_ref().map(|m|m.len()),
        "completion_verified":false})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn normal_collision_and_no_delete() {
        let dir=std::env::temp_dir().join(format!("shuvi-export-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let out=dir.join("final.mp4");let s=out.to_str().unwrap();
        assert!(inspect(s,None,false,None).unwrap().executable);
        fs::write(&out,b"prior").unwrap();
        assert!(!inspect(s,None,false,None).unwrap().executable);
        assert!(inspect(s,None,true,None).unwrap().executable);
        assert_eq!(fs::read(&out).unwrap(),b"prior");
        assert!(!inspect(s,None,true,Some(s)).unwrap().executable);
        assert!(inspect(s,Some(s),true,None).is_err());
        assert_eq!(observation(s,true)["completion_verified"],false);
        fs::remove_file(out).unwrap();fs::remove_dir(dir).unwrap();
    }
    #[test] fn rejects_directory_missing_parent_preset_and_reserved_names() {
        let dir=std::env::temp_dir().join(format!("shuvi-export-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let s=dir.join("missing").join("final.mp4");assert!(!inspect(s.to_str().unwrap(),None,false,None).unwrap().executable);
        let dir_as_file=dir.join("folder.mp4");fs::create_dir_all(&dir_as_file).unwrap();
        assert!(!inspect(dir_as_file.to_str().unwrap(),None,true,None).unwrap().executable);
        let out=dir.join("final.mp4");let wrong=dir.join("wrong.txt");
        assert!(inspect(out.to_str().unwrap(),Some(wrong.to_str().unwrap()),false,None).is_err());
        assert!(!inspect(out.to_str().unwrap(),Some(dir.join("missing.epr").to_str().unwrap()),false,None).unwrap().executable);
        for name in ["CON.mp4","noextension","final.prproj"] {assert!(inspect(dir.join(name).to_str().unwrap(),None,false,None).is_err());}
        assert!(inspect(&format!("/{}", "a".repeat(4097)),None,false,None).is_err());
        fs::remove_dir(dir_as_file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
