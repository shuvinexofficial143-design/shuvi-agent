//! Bounded, data-only template mappings and checkpointed graphics batches.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, HashSet}, fs, io::{Read, Write}, path::Path,
    sync::{Mutex, atomic::{AtomicBool, Ordering}}, future::Future};

const MAX_BYTES: usize = 96 * 1024;
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "source", rename_all = "snake_case", deny_unknown_fields)]
pub enum Template {
    Path { path: String },
    Library { library_name: String, element_name: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub role: String,
    pub component_match_name: Option<String>,
    pub component_display_name: Option<String>,
    pub param_display_name: String,
    pub primitive_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mapping {
    pub schema_version: u8,
    pub name: String,
    pub template: Template,
    pub fields: Vec<Field>,
}

fn name_ok(s: &str) -> bool { !s.trim().is_empty() && s == s.trim() && s.encode_utf16().count() <= 240 && !s.contains('\0') }
pub fn validate_name(s: &str) -> Result<(), String> {
    if name_ok(s) { Ok(()) } else { Err("Mapping names must contain 1–240 characters without surrounding whitespace or NUL.".into()) }
}
fn primitive_type(v: &Value) -> Option<&'static str> {
    match v {
        Value::String(s) if s.encode_utf16().count() <= 2048 => Some("string"),
        Value::Bool(_) => Some("boolean"),
        Value::Number(n) if n.as_f64().is_some_and(f64::is_finite) => Some("number"),
        _ => None,
    }
}
fn bounded<T: Serialize>(v: &T) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(v).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES { return Err("Graphics data exceeds 96 KiB.".into()); }
    Ok(bytes)
}

impl Mapping {
    pub fn validate(&self) -> Result<(), String> {
        validate_name(&self.name)?;
        if self.schema_version != 1 || self.fields.is_empty() || self.fields.len() > 16 {
            return Err("Graphics mapping v1 requires 1–16 explicit fields.".into());
        }
        match &self.template {
            Template::Path { path } => {
                // This is a Windows desktop application. Also accept POSIX absolute paths in schema tests.
                let bytes = path.as_bytes();
                let absolute = Path::new(path).is_absolute() || (bytes.len() > 3 && bytes[0].is_ascii_alphabetic()
                    && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\'));
                if !absolute || path.len() > 2048 || path.contains('\0') || !path.to_ascii_lowercase().ends_with(".mogrt") {
                    return Err("Template must be an absolute bounded .mogrt path.".into());
                }
            }
            Template::Library { library_name, element_name } => {
                if !name_ok(library_name) || !name_ok(element_name) { return Err("Exact bounded library and element names required.".into()); }
            }
        }
        let mut roles = HashSet::new();
        let mut selectors = HashSet::new();
        for f in &self.fields {
            if !name_ok(&f.role) || !roles.insert(&f.role) || !name_ok(&f.param_display_name)
                || !matches!(f.primitive_type.as_str(), "string" | "number" | "boolean")
                || (f.component_match_name.is_none() && f.component_display_name.is_none())
                || [f.component_match_name.as_ref(), f.component_display_name.as_ref()].into_iter().flatten().any(|s| !name_ok(s))
                || !selectors.insert((&f.component_match_name, &f.component_display_name, &f.param_display_name)) {
                return Err("Mapping needs unique user-defined roles and exact primitive parameter selectors.".into());
            }
        }
        bounded(self)?;
        Ok(())
    }

    pub fn validate_local_template(&self) -> Result<(), String> {
        self.validate()?;
        if let Template::Path { path } = &self.template {
            if !fs::metadata(path).map_err(|e| format!("MOGRT file unavailable: {e}"))?.is_file() {
                return Err("Template path must identify an existing regular .mogrt file.".into());
            }
        }
        Ok(())
    }

    pub fn validate_inspection(&self, inspected: &Value) -> Result<(), String> {
        self.validate()?;
        if inspected["truncated"] != false { return Err("Mapping requires complete native inspection.".into()); }
        let components = inspected["components"].as_array().ok_or("Missing inspected components.")?;
        let mut resolved = HashSet::new();
        for f in &self.fields {
            let matches: Vec<_> = components.iter().enumerate().filter(|(_, c)|
                f.component_match_name.as_ref().is_none_or(|n| c["matchName"] == *n)
                && f.component_display_name.as_ref().is_none_or(|n| c["displayName"] == *n)).collect();
            if matches.len() != 1 { return Err("Template component missing or ambiguous.".into()); }
            let params = matches[0].1["params"].as_array().ok_or("Missing inspected parameters.")?;
            let hits: Vec<_> = params.iter().enumerate().filter(|(_, p)| p["displayName"] == f.param_display_name).collect();
            if hits.len() != 1 || !resolved.insert((matches[0].0, hits[0].0)) {
                return Err("Template parameter missing, ambiguous or mapped twice.".into());
            }
            let p = hits[0].1;
            if p["editable"] != true || p["type"] != f.primitive_type || primitive_type(&p["value"]) != Some(f.primitive_type.as_str()) {
                return Err("Template primitive type or static edit capability mismatches inspection.".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SavedMapping { pub revision: u32, pub mapping: Mapping }
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Library { entries: Vec<SavedMapping> }
impl Library {
    fn validate(&self) -> Result<(), String> {
        if self.entries.len() > 64 { return Err("At most 64 saved graphics mappings.".into()); }
        let mut seen = HashSet::new();
        for e in &self.entries {
            e.mapping.validate()?;
            if e.revision == 0 || !seen.insert(&e.mapping.name) { return Err("Invalid mapping revision or duplicate name.".into()); }
        }
        bounded(self)?;
        Ok(())
    }
}
fn read_library(path: &Path) -> Result<Library, String> {
    if path.with_extension("json.bak").exists() {
        return Err("Graphics library has an interrupted update (.json.bak); inspect/recover it before continuing.".into());
    }
    if !path.exists() { return Ok(Library::default()); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|e| e.to_string())?.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES { return Err("Graphics library exceeds 96 KiB.".into()); }
    let lib: Library = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    lib.validate()?;
    Ok(lib)
}
fn write_library(path: &Path, lib: &Library) -> Result<(), String> {
    lib.validate()?;
    let bytes = bounded(lib)?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)
        .map_err(|e| format!("Graphics temporary file unavailable; inspect interrupted updates: {e}"))?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    if path.exists() { fs::rename(path, &backup).map_err(|e| e.to_string())?; }
    if let Err(e) = fs::rename(&temp, path) {
        if backup.exists() { let _ = fs::rename(&backup, path); }
        return Err(e.to_string());
    }
    if backup.exists() { fs::remove_file(backup).map_err(|e| e.to_string())?; }
    Ok(())
}
pub fn list(path: &Path) -> Result<Vec<SavedMapping>, String> {
    let _lock = STORE_LOCK.lock().map_err(|_| "Graphics library lock unavailable.")?;
    Ok(read_library(path)?.entries)
}
pub fn save(path: &Path, mapping: Mapping, expected_revision: Option<u32>) -> Result<SavedMapping, String> {
    mapping.validate()?;
    let _lock = STORE_LOCK.lock().map_err(|_| "Graphics library lock unavailable.")?;
    let mut lib = read_library(path)?;
    let index = lib.entries.iter().position(|e| e.mapping.name == mapping.name);
    let revision = match index {
        Some(i) if expected_revision == Some(lib.entries[i].revision) => lib.entries[i].revision.checked_add(1).ok_or("Revision exhausted.")?,
        Some(_) => return Err("Mapping already exists or changed; supply its exact expected_revision to update.".into()),
        None if expected_revision.is_none() => 1,
        None => return Err("Mapping no longer exists.".into()),
    };
    let saved = SavedMapping { revision, mapping };
    if let Some(i) = index { lib.entries[i] = saved.clone(); } else { lib.entries.push(saved.clone()); }
    write_library(path, &lib)?;
    Ok(saved)
}
pub fn delete(path: &Path, name: &str, revision: u32) -> Result<(), String> {
    validate_name(name)?;
    let _lock = STORE_LOCK.lock().map_err(|_| "Graphics library lock unavailable.")?;
    let mut lib = read_library(path)?;
    let i = lib.entries.iter().position(|e| e.mapping.name == name && e.revision == revision).ok_or("Unknown or changed graphics mapping.")?;
    lib.entries.remove(i);
    write_library(path, &lib)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Item { pub seconds: f64, pub fields: BTreeMap<String, Value>, pub duration_seconds: Option<f64> }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Batch { pub mapping: String, pub revision: u32, pub video_track: u32, pub audio_track: u32, pub items: Vec<Item> }
impl Batch {
    pub fn validate(&self) -> Result<(), String> {
        validate_name(&self.mapping)?;
        if self.revision == 0 || self.video_track > 128 || self.audio_track > 128 || self.items.is_empty() || self.items.len() > 32 {
            return Err("Batch needs mapping revision, existing tracks and 1–32 graphics.".into());
        }
        let mut times = HashSet::new();
        for i in &self.items {
            if !i.seconds.is_finite() || !(0.0..=86400.0).contains(&i.seconds) || !times.insert(i.seconds.to_bits())
                || i.duration_seconds.is_some_and(|d| !d.is_finite() || d <= 0.0 || i.seconds + d > 86400.0)
                || i.fields.is_empty() || i.fields.len() > 16 || i.fields.iter().any(|(r, v)| !name_ok(r) || primitive_type(v).is_none()) {
                return Err("Invalid graphics time, duration, duplicate placement or primitive fields.".into());
            }
        }
        bounded(self)?;
        Ok(())
    }
    pub fn resolve(&self, saved: &SavedMapping) -> Result<(), String> {
        self.validate()?;
        saved.mapping.validate()?;
        if self.mapping != saved.mapping.name || self.revision != saved.revision { return Err("Unknown or changed graphics mapping; list mappings again.".into()); }
        for i in &self.items {
            // All mapped roles are required: never silently retain a prior person's name/default CTA.
            if i.fields.len() != saved.mapping.fields.len() || saved.mapping.fields.iter().any(|f|
                i.fields.get(&f.role).and_then(primitive_type) != Some(f.primitive_type.as_str())) {
                return Err("Every mapped role needs an explicit value of its saved primitive type; no role inference.".into());
            }
        }
        Ok(())
    }
}

pub enum BatchStep { Checkpoint, Insert(Value) }
/// Callback binds only a project checkpoint and the fixed insert_mapped_graphic route.
/// Every transport error after dispatch is conservative uncertainty, regardless of error wording.
pub async fn run_batch<F, Fut>(batch: &Batch, saved: &SavedMapping, cancelled: &AtomicBool, mut dispatch: F) -> Result<Value, String>
where F: FnMut(BatchStep) -> Fut, Fut: Future<Output = Result<Value, String>> {
    batch.resolve(saved)?;
    let mut results = Vec::new();
    let mut checkpoint = Value::Null;
    let mut uncertain = false;
    let mut output_limit_reached = false;
    for (index, item) in batch.items.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) { break; }
        if serde_json::to_vec(&results).map_err(|e| e.to_string())?.len() > 64 * 1024 {
            output_limit_reached = true;
            break;
        }
        if checkpoint.is_null() {
            checkpoint = dispatch(BatchStep::Checkpoint).await?;
            if !checkpoint.as_str().is_some_and(|p| !p.is_empty()) { return Err("Durable project checkpoint missing.".into()); }
        }
        if cancelled.load(Ordering::Acquire) { break; }
        let reply = dispatch(BatchStep::Insert(json!({"mapping":saved.mapping,"item":item,
            "videoTrack":batch.video_track,"audioTrack":batch.audio_track}))).await;
        match reply {
            Ok(result) if matches!(result["status"].as_str(), Some("applied" | "failed" | "uncertain"))
                && serde_json::to_vec(&result).is_ok_and(|b| b.len() <= 16 * 1024)
                && (result["status"] != "applied" || (result["inserted"] == true && result["populated"] == true && result["expected"].is_object())) => {
                uncertain = result["uncertain"].as_bool().unwrap_or(true) || result["status"] == "uncertain";
                let stop = uncertain || result["stop_batch"].as_bool().unwrap_or(true);
                results.push(json!({"index":index,"result":result}));
                if stop { break; }
            }
            reply => {
                uncertain = true;
                let reason = match reply { Err(e) => e, _ => "Invalid native graphics receipt.".into() };
                results.push(json!({"index":index,"result":{"status":"uncertain","uncertain":true,
                    "reason":reason.chars().take(240).collect::<String>(),"inserted":null}}));
                break;
            }
        }
    }
    let cancelled = cancelled.load(Ordering::Acquire);
    let applied = results.iter().filter(|r| r["result"]["status"] == "applied").count();
    Ok(json!({"schema_version":1,"mapping":batch.mapping,"revision":batch.revision,"checkpoint":checkpoint,
        "requested":batch.items.len(),"processed":results.len(),"applied":applied,"cancelled":cancelled,
        "complete":applied==batch.items.len()&&!cancelled&&!uncertain,"uncertain":uncertain,"items":results,
        "output_limit_reached":output_limit_reached,"automatic_rollback":false,"review_recommended":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::Future, pin::pin, sync::Arc, task::{Context, Poll, Wake, Waker}};
    // Test hosts finish immediately; a pending future is a test error, never a busy wait.
    fn ready<F: Future>(future: F) -> F::Output {
        struct NoWake;
        impl Wake for NoWake { fn wake(self: Arc<Self>) {} }
        let waker = Waker::from(Arc::new(NoWake));
        match pin!(future).poll(&mut Context::from_waker(&waker)) {
            Poll::Ready(v) => v, Poll::Pending => panic!("Mock unexpectedly awaited I/O"),
        }
    }
    fn mapping() -> Mapping {
        serde_json::from_value(json!({"schema_version":1,"name":"doctor","template":{"source":"library","library_name":"Medical","element_name":"Lower Third"},
            "fields":[{"role":"name","component_match_name":"native","param_display_name":"Field","primitive_type":"string"}]})).unwrap()
    }
    fn batch(count: usize) -> Batch {
        Batch {mapping:"doctor".into(),revision:1,video_track:1,audio_track:1,
            items:(0..count).map(|n| Item {seconds:n as f64 * 10.0,fields:BTreeMap::from([("name".into(),json!("Doctor"))]),duration_seconds:None}).collect()}
    }
    fn saved() -> SavedMapping { SavedMapping {revision:1,mapping:mapping()} }
    fn applied() -> Value { json!({"status":"applied","inserted":true,"populated":true,"expected":{},"uncertain":false,"stop_batch":false}) }
    fn inspection() -> Value { json!({"truncated":false,"components":[{"matchName":"native","displayName":"Native","params":[{"displayName":"Field","editable":true,"type":"string","value":"Original"}]}]}) }

    #[test] fn mapping_types_roles_and_inspection_are_exact() {
        let mut m = mapping(); let mut native = inspection();
        m.validate_inspection(&native).unwrap();
        m.fields[0].role = "user_defined_cta".into(); m.validate_inspection(&native).unwrap();
        native["components"][0]["params"][0]["type"] = json!("number");
        assert!(m.validate_inspection(&native).is_err());
        for (kind,value) in [("number",json!(12)),("boolean",json!(true))] {
            m.fields[0].primitive_type = kind.into();
            native["components"][0]["params"][0]["type"] = json!(kind);
            native["components"][0]["params"][0]["value"] = value;
            m.validate_inspection(&native).unwrap();
        }
        native["truncated"] = json!(true); assert!(m.validate_inspection(&native).is_err());
        let mut duplicate = mapping(); duplicate.fields.push(duplicate.fields[0].clone()); assert!(duplicate.validate().is_err());
        let mut alias = mapping(); let mut field = alias.fields[0].clone(); field.role = "cta".into(); field.component_match_name = None; field.component_display_name = Some("Native".into()); alias.fields.push(field);
        assert!(alias.validate_inspection(&inspection()).is_err());
    }
    #[test] fn closed_schema_bounds_and_unknown_mapping() {
        assert!(batch(0).validate().is_err()); batch(32).validate().unwrap(); assert!(batch(33).validate().is_err());
        let mut b = batch(1); b.mapping = "unknown".into(); assert!(b.resolve(&saved()).is_err());
        b.mapping = "doctor".into(); b.revision = 2; assert!(b.resolve(&saved()).is_err());
        b.revision = 1; b.items[0].fields.insert("name".into(),json!(false)); assert!(b.resolve(&saved()).is_err());
        b.items[0].fields = BTreeMap::from([("title".into(),json!("Doctor"))]); assert!(b.resolve(&saved()).is_err());
        let mut v = serde_json::to_value(mapping()).unwrap(); v["script"] = json!("anything"); assert!(serde_json::from_value::<Mapping>(v).is_err());
        let mut m = mapping(); m.template = Template::Path {path:"relative.mogrt".into()}; assert!(m.validate().is_err());
        let mut b = batch(2); b.items[1].seconds = b.items[0].seconds; assert!(b.validate().is_err());
        let mut b = batch(1); b.items[0].duration_seconds = Some(-1.0); assert!(b.validate().is_err());
    }
    #[test] fn durable_library_save_update_delete_and_revisions() {
        let dir = std::env::temp_dir().join(format!("shuvi-graphics-{}",uuid::Uuid::new_v4())); fs::create_dir(&dir).unwrap();
        let path = dir.join("mappings.json");
        assert_eq!(save(&path,mapping(),None).unwrap().revision,1);
        assert!(save(&path,mapping(),None).is_err());
        assert_eq!(save(&path,mapping(),Some(1)).unwrap().revision,2);
        assert!(save(&path,mapping(),Some(1)).is_err()); assert!(delete(&path,"doctor",1).is_err());
        assert_eq!(list(&path).unwrap().len(),1); delete(&path,"doctor",2).unwrap(); assert!(list(&path).unwrap().is_empty());
        fs::write(&path,vec![b' ';MAX_BYTES+1]).unwrap(); assert!(list(&path).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn library_limits_and_interrupted_write_fail_closed() {
        let mut lib = Library::default();
        for n in 0..64 { let mut s = saved(); s.mapping.name = format!("mapping{n}"); lib.entries.push(s); }
        lib.validate().unwrap(); let mut extra = saved(); extra.mapping.name = "extra".into(); lib.entries.push(extra); assert!(lib.validate().is_err());
        let dir = std::env::temp_dir().join(format!("shuvi-graphics-{}",uuid::Uuid::new_v4())); fs::create_dir(&dir).unwrap();
        let path = dir.join("mappings.json"); save(&path,mapping(),None).unwrap();
        fs::write(path.with_extension("json.bak"),b"{}").unwrap(); assert!(list(&path).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn one_and_many_execute_once_with_one_checkpoint() {
        for n in [1,32] {
            let cancel = AtomicBool::new(false); let mut checkpoints = 0; let mut inserts = 0;
            let report = ready(run_batch(&batch(n),&saved(),&cancel,|step| {
                let result = match step { BatchStep::Checkpoint => {checkpoints+=1;json!("C:/checkpoint.prproj")}, BatchStep::Insert(args) => {inserts+=1;assert_eq!(args["mapping"]["name"],"doctor");applied()} };
                std::future::ready(Ok(result))
            })).unwrap();
            assert_eq!(report["complete"],true); assert_eq!(report["applied"],n); assert_eq!(inserts,n); assert_eq!(checkpoints,1);
        }
    }
    #[test] fn partial_mapping_failure_preserves_prior_results_and_continues() {
        let cancel = AtomicBool::new(false); let mut inserts = 0;
        let report = ready(run_batch(&batch(3),&saved(),&cancel,|step| std::future::ready(Ok(match step {
            BatchStep::Checkpoint => json!("C:/checkpoint.prproj"), BatchStep::Insert(_) => {inserts+=1;if inserts==2 {json!({"status":"failed","inserted":true,"uncertain":false,"stop_batch":false})} else {applied()}}
        })))).unwrap();
        assert_eq!(report["applied"],2); assert_eq!(report["processed"],3); assert_eq!(report["complete"],false); assert_eq!(report["automatic_rollback"],false);
    }
    #[test] fn every_dispatch_error_and_uncertain_reply_stops_without_retry() {
        for failure in [Err("Connection reset without timeout wording".to_owned()),Ok(json!({"status":"uncertain","uncertain":true,"stop_batch":true})),Ok(json!({"status":"applied"}))] {
            let cancel = AtomicBool::new(false); let mut inserts = 0;
            let report = ready(run_batch(&batch(3),&saved(),&cancel,|step| std::future::ready(match step {
                BatchStep::Checkpoint => Ok(json!("C:/checkpoint.prproj")), BatchStep::Insert(_) => {inserts+=1;failure.clone()}
            }))).unwrap();
            assert_eq!(inserts,1); assert_eq!(report["uncertain"],true); assert_eq!(report["complete"],false);
        }
    }
    #[test] fn cancellation_before_after_checkpoint_and_between_items() {
        for when in [0,1,2] {
            let cancel = AtomicBool::new(when==0); let mut inserts = 0;
            let report = ready(run_batch(&batch(3),&saved(),&cancel,|step| std::future::ready(Ok(match step {
                BatchStep::Checkpoint => {if when==1 {cancel.store(true,Ordering::Release);} json!("checkpoint")},
                BatchStep::Insert(_) => {inserts+=1;cancel.store(true,Ordering::Release);applied()}
            })))).unwrap();
            assert_eq!(report["cancelled"],true); assert_eq!(report["complete"],false); assert_eq!(inserts,usize::from(when==2));
        }
    }
    #[test] fn failed_checkpoint_never_inserts() {
        let cancel = AtomicBool::new(false);
        assert!(ready(run_batch(&batch(1),&saved(),&cancel,|step| {
            assert!(matches!(step,BatchStep::Checkpoint));std::future::ready(Err("checkpoint failed".into()))
        })).is_err());
    }
}
