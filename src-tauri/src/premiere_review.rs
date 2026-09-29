use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::Path};

const MAX_BYTES: usize = 96 * 1024;
const CATEGORIES: &[&str] = &["exposure", "color", "framing", "continuity", "motion", "transition", "graphics", "caption", "audio_visual", "other"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Issue {
    pub id: String,
    pub category: String,
    pub severity: String,
    pub confidence: f64,
    pub frame_seconds: Vec<f64>,
    pub observation: String,
    pub suggested_action_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub iteration: u8,
    pub issues: Vec<Issue>,
    pub overall_confidence: f64,
    pub stop_recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    pub fingerprint: String,
    pub issue_id: String,
    pub outcome: String,
    pub before: String,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub schema_version: u8,
    pub created_at_ms: u64,
    pub session_id: String,
    pub project_guid: String,
    pub sequence_guid: String,
    pub objective: String,
    pub reference: String,
    pub sample_times: Vec<f64>,
    pub iteration: u8,
    pub max_iterations: u8,
    #[serde(default)]
    pub model_calls: u8,
    pub status: String,
    pub reviews: Vec<Review>,
    pub attempted_fixes: Vec<Attempt>,
}

fn short(s: &str, max: usize) -> bool { !s.trim().is_empty() && s.chars().count() <= max }
fn samples_ok(times: &[f64]) -> bool {
    !times.is_empty() && times.len() <= 4 && times.iter().all(|t| t.is_finite() && (0.0..=86_400.0).contains(t))
}

impl Session {
    pub fn new(id: String, project: String, sequence: String, objective: String, reference: String, samples: Vec<f64>, max: u8, created_at_ms: u64) -> Result<Self, String> {
        if !short(&id, 80) || !short(&project, 240) || !short(&sequence, 240)
            || !short(&objective, 300) || reference.chars().count() > 2000
            || !samples_ok(&samples) || !(1..=8).contains(&max) || created_at_ms == 0 {
            return Err("Invalid or oversized Premiere review session input.".into());
        }
        Ok(Self { schema_version: 2, created_at_ms, session_id: id, project_guid: project, sequence_guid: sequence,
            objective, reference, sample_times: samples, iteration: 1, max_iterations: max, model_calls: 0, status: "reviewing".into(),
            reviews: vec![], attempted_fixes: vec![] })
    }

    pub fn check_identity(&mut self, project: &str, sequence: &str) -> Result<(), String> {
        if self.project_guid != project || self.sequence_guid != sequence {
            self.status = "stagnated".into();
            return Err("Premiere project or active sequence changed; review session stopped.".into());
        }
        Ok(())
    }

    pub fn add_review(&mut self, review: Review) -> Result<Value, String> {
        if self.status != "reviewing" || review.iteration != self.iteration || self.reviews.len() >= 8 {
            return Err("Review session cannot accept this iteration.".into());
        }
        review.validate(&self.sample_times)?;
        let actionable = review.issues.iter().any(|i| i.confidence >= 0.65 && matches!(i.severity.as_str(), "medium" | "high"));
        let previous = self.reviews.last();
        let comparison = if let Some(before) = previous {
            let count = |r: &Review| r.issues.iter().filter(|i| i.confidence >= 0.65 && matches!(i.severity.as_str(), "medium" | "high")).count();
            if review.overall_confidence < 0.65 || before.overall_confidence < 0.65 { "uncertain" }
            else if count(&review) < count(before) { "improved" }
            else if count(&review) > count(before) { "regressed" }
            else { "unchanged" }
        } else { "uncertain" };
        if let Some(attempt) = self.attempted_fixes.last_mut() {
            if attempt.after.is_none() {
                attempt.after = Some(review.issues.iter().map(|i| i.observation.as_str()).take(4).collect::<Vec<_>>().join("; ").chars().take(800).collect());
                attempt.outcome = comparison.into();
            }
        }
        let low_confidence = review.overall_confidence < 0.65;
        let stop = review.stop_recommended || !actionable || low_confidence;
        self.reviews.push(review);
        self.status = if stop { "completed" } else if self.iteration >= self.max_iterations { "stagnated" } else { "awaiting_approval" }.into();
        Ok(json!({"comparison": comparison, "status": self.status, "iteration": self.iteration}))
    }

    pub fn record_fix(&mut self, issue_id: &str, fingerprint: &str, before: &str) -> Result<(), String> {
        if self.status != "awaiting_approval" || !short(issue_id, 80) || !short(fingerprint, 300) || !short(before, 800) {
            return Err("Review session is not ready for an approved fix.".into());
        }
        if !self.reviews.last().is_some_and(|r| r.issues.iter().any(|i| i.id == issue_id)) {
            return Err("Fix references an unknown issue.".into());
        }
        if self.attempted_fixes.iter().any(|a| a.fingerprint == fingerprint && a.outcome != "improved") {
            self.status = "stagnated".into();
            return Err("Same unsuccessful fix already attempted.".into());
        }
        self.attempted_fixes.push(Attempt { fingerprint: fingerprint.into(), issue_id: issue_id.into(),
            outcome: "uncertain".into(), before: before.into(), after: None });
        self.iteration += 1;
        self.status = "reviewing".into();
        Ok(())
    }

    pub fn cancel(&mut self) { self.status = "cancelled".into(); }
}

impl Review {
    pub fn validate(&self, samples: &[f64]) -> Result<(), String> {
        if self.issues.len() > 16 || !self.overall_confidence.is_finite()
            || !(0.0..=1.0).contains(&self.overall_confidence) {
            return Err("Premiere review exceeds issue or confidence bounds.".into());
        }
        let mut ids = HashSet::new();
        for issue in &self.issues {
            if !short(&issue.id, 80) || !ids.insert(&issue.id) || !CATEGORIES.contains(&issue.category.as_str())
                || !matches!(issue.severity.as_str(), "low" | "medium" | "high")
                || !issue.confidence.is_finite() || !(0.0..=1.0).contains(&issue.confidence)
                || issue.frame_seconds.is_empty() || issue.frame_seconds.len() > 4
                || issue.frame_seconds.iter().any(|t| !samples.contains(t))
                || !short(&issue.observation, 500) || !short(&issue.suggested_action_type, 80) {
                return Err("Premiere review contains an invalid or ungrounded issue.".into());
            }
        }
        Ok(())
    }
}

pub fn normalize_vision(text: &str, iteration: u8, samples: &[f64]) -> Result<Review, String> {
    if text.len() > 16_384 { return Err("Vision result exceeds 16 KB.".into()); }
    let clean = text.trim().strip_prefix("```json").unwrap_or(text.trim()).trim();
    let clean = clean.strip_suffix("```").unwrap_or(clean).trim();
    let review: Review = serde_json::from_str(clean).map_err(|_| "Vision must return bounded structured review JSON.".to_string())?;
    if review.iteration != iteration { return Err("Vision returned the wrong review iteration.".into()); }
    review.validate(samples)?;
    Ok(review)
}

pub fn fingerprint(category: &str, target: &str, planner: &str, settings: &Value) -> Result<String, String> {
    if !CATEGORIES.contains(&category) || !short(target, 300) || !short(planner, 80) {
        return Err("Invalid fix fingerprint target or planner.".into());
    }
    let settings = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    if settings.len() > 2048 { return Err("Fix settings too large.".into()); }
    Ok(format!("{category}|{target}|{planner}|{settings}"))
}

pub fn proposal(issue: &Issue) -> Value {
    let planner = match issue.category.as_str() {
        "color" | "exposure" => "premiere_plan_video_recipe",
        "framing" | "motion" => "premiere_plan_video_recipe",
        "audio_visual" => "premiere_plan_audio_automation",
        "graphics" => "premiere_plan_mogrt_recipe",
        "transition" => "premiere_add_video_transition",
        _ => "",
    };
    // A frame observation cannot provide an inspected clip signature, parameter binding
    // or an approved edit. Planning requires a fresh typed inspection and user approval.
    json!({"issue_id": issue.id, "supported": false, "planner": planner,
        "reason": if planner.is_empty() { "No safe typed planner for this observation." }
                  else { "Inspect an exact target and parameters, then invoke the normal permission-gated typed tool." }})
}

pub fn save(path: &Path, session: &Session) -> Result<(), String> {
    let data = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    if data.len() > MAX_BYTES || session.reviews.len() > 8 || session.attempted_fixes.len() > 8 {
        return Err("Premiere review history exceeds bounded persistence.".into());
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    // Windows cannot replace an existing file with rename. Preserve the last good
    // snapshot as .bak until the new state is installed.
    let backup = path.with_extension("json.bak");
    if path.exists() { fs::rename(path, &backup).map_err(|e| e.to_string())?; }
    if let Err(error) = fs::rename(&tmp, path) {
        if backup.exists() { let _ = fs::rename(&backup, path); }
        return Err(error.to_string());
    }
    if backup.exists() { let _ = fs::remove_file(backup); }
    Ok(())
}

pub fn load(path: &Path) -> Result<Session, String> {
    let decode = |candidate: &Path| -> Result<Session, String> {
        let data = fs::read(candidate).map_err(|e| e.to_string())?;
        if data.len() > MAX_BYTES { return Err("Premiere review session file is too large.".into()); }
        serde_json::from_slice(&data).map_err(|e| format!("Corrupt Premiere review session: {e}"))
    };
    let session = decode(path).or_else(|error| {
        let backup = path.with_extension("json.bak");
        if backup.exists() { decode(&backup) } else { Err(error) }
    })?;
    if session.schema_version != 2 || session.created_at_ms == 0 || session.reviews.len() > 8 || session.attempted_fixes.len() > 8
        || session.model_calls > 32
        || !samples_ok(&session.sample_times) || !(1..=8).contains(&session.max_iterations)
        || session.iteration == 0 || session.iteration > session.max_iterations
        || !matches!(session.status.as_str(), "reviewing" | "awaiting_approval" | "completed" | "cancelled" | "stagnated" | "failed") {
        return Err("Invalid persisted Premiere review session.".into());
    }
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> Session { Session::new("id".into(), "p".into(), "s".into(), "clean edit".into(), "".into(), vec![1.0], 4, 1).unwrap() }
    fn issue() -> Issue { Issue { id:"i".into(), category:"color".into(), severity:"medium".into(), confidence:.9, frame_seconds:vec![1.0], observation:"too warm".into(), suggested_action_type:"color_recipe".into() } }
    fn review(iteration:u8, issues:Vec<Issue>) -> Review { Review { iteration, issues, overall_confidence:.9, stop_recommended:false } }
    #[test] fn limits_and_identity() {
        assert!(Session::new("id".into(),"p".into(),"s".into(),"x".into(),"".into(),vec![1.0],9,1).is_err());
        assert!(Session::new("id".into(),"p".into(),"s".into(),"x".into(),"".into(),vec![1.0;5],4,1).is_err());
        let mut s=session(); assert!(s.check_identity("p","other").is_err()); assert_eq!(s.status,"stagnated");
    }
    #[test] fn review_bounds_and_stops() {
        let mut s=session();
        assert!(review(1,vec![issue();17]).validate(&[1.0]).is_err());
        assert!(normalize_vision("{}",1,&[1.0]).is_err());
        s.add_review(review(1,vec![issue()])).unwrap();
        assert_eq!(s.status,"awaiting_approval");
        let fp=fingerprint("color","video/0/0","premiere_plan_video_recipe",&json!({"value":3})).unwrap();
        s.record_fix("i",&fp,"too warm").unwrap();
        assert_eq!(s.add_review(review(2,vec![])).unwrap()["comparison"],"improved");
        assert_eq!(s.status,"completed");
    }
    #[test] fn cancellation_duplicate_and_persistence() {
        let mut s=session(); s.add_review(review(1,vec![issue()])).unwrap();
        s.record_fix("i","same","before").unwrap();
        s.add_review(review(2,vec![issue()])).unwrap();
        assert!(s.record_fix("i","same","before").is_err());
        assert_eq!(s.status,"stagnated");
        s.cancel(); assert_eq!(s.status,"cancelled");
        let path=std::env::temp_dir().join(format!("shuvi-review-{}.json",std::process::id()));
        save(&path,&s).unwrap(); assert_eq!(load(&path).unwrap().status,"cancelled");
        fs::remove_file(&path).unwrap();
        fs::write(&path,"{broken").unwrap(); assert!(load(&path).is_err()); fs::remove_file(path).unwrap();
    }
}
