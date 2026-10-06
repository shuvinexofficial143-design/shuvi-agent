use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cmp::Ordering, collections::HashSet, fs, path::Path};

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
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub before_severity: String,
    #[serde(default)]
    pub before_confidence: f64,
    #[serde(default)]
    pub frame_seconds: Vec<f64>,
    #[serde(default)]
    pub after_issue_id: Option<String>,
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
    #[serde(default)]
    pub stop_reason: Option<String>,
    pub reviews: Vec<Review>,
    pub attempted_fixes: Vec<Attempt>,
}

fn short(s: &str, max: usize) -> bool { !s.trim().is_empty() && s.chars().count() <= max }
fn samples_ok(times: &[f64]) -> bool {
    !times.is_empty() && times.len() <= 4 && times.iter().all(|t| t.is_finite() && (0.0..=86_400.0).contains(t))
}

fn shared_sample(a:&[f64],b:&[f64])->bool{
    a.iter().any(|left|b.iter().any(|right|left==right))
}

fn evaluate_attempt(attempt:&Attempt,review:&Review)->(String,String,Option<String>){
    if review.overall_confidence<0.65 || attempt.category.is_empty() || attempt.frame_seconds.is_empty()
        || !matches!(attempt.before_severity.as_str(),"low"|"medium"|"high")
        || !attempt.before_confidence.is_finite() || !(0.0..=1.0).contains(&attempt.before_confidence) {
        let after=review.issues.iter().map(|i|i.observation.as_str()).take(4)
            .collect::<Vec<_>>().join("; ").chars().take(800).collect();
        return ("uncertain".into(),after,None);
    }
    let mut candidates=review.issues.iter().filter(|issue|
        issue.category==attempt.category && shared_sample(&issue.frame_seconds,&attempt.frame_seconds)
    ).collect::<Vec<_>>();
    if candidates.is_empty(){
        return ("resolved".into(),"No matching issue remained at the grounded review sample.".into(),None);
    }
    candidates.sort_by(|a,b|{
        severity_rank(&b.severity).cmp(&severity_rank(&a.severity))
            .then_with(||b.confidence.partial_cmp(&a.confidence).unwrap_or(Ordering::Equal))
            .then_with(||a.id.cmp(&b.id))
    });
    let after=candidates[0];
    let before_rank=severity_rank(&attempt.before_severity);
    let after_rank=severity_rank(&after.severity);
    let outcome=if after_rank<before_rank || (after_rank==before_rank && after.confidence<=attempt.before_confidence-0.15){
        "improved"
    }else if after_rank>before_rank || (after_rank==before_rank && after.confidence>=attempt.before_confidence+0.15){
        "regressed"
    }else{
        "unchanged"
    };
    (outcome.into(),after.observation.chars().take(800).collect(),Some(after.id.clone()))
}

fn grounded_non_improving_attempts(attempts: &[Attempt], baseline: &Attempt) -> usize {
    if baseline.category.is_empty() || baseline.frame_seconds.is_empty() { return 0; }
    attempts.iter().filter(|attempt| {
        attempt.category == baseline.category
            && shared_sample(&attempt.frame_seconds, &baseline.frame_seconds)
            && matches!(attempt.outcome.as_str(), "unchanged" | "regressed")
    }).count()
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
            stop_reason: None, reviews: vec![], attempted_fixes: vec![] })
    }

    pub fn check_identity(&mut self, project: &str, sequence: &str) -> Result<(), String> {
        if self.project_guid != project || self.sequence_guid != sequence {
            self.status = "stagnated".into();
            self.stop_reason = Some("project_or_sequence_changed".into());
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
        let fix_evaluation=if self.attempted_fixes.last().is_some_and(|attempt|attempt.after.is_none()){
            let baseline=self.attempted_fixes.last().cloned().expect("checked above");
            let (outcome,after,after_issue_id)=evaluate_attempt(&baseline,&review);
            if let Some(attempt)=self.attempted_fixes.last_mut(){
                attempt.after=Some(after);
                attempt.after_issue_id=after_issue_id.clone();
                attempt.outcome=outcome.clone();
            }
            Some(json!({
                "issue_id":baseline.issue_id,
                "category":baseline.category,
                "grounded_frames":baseline.frame_seconds,
                "before_severity":baseline.before_severity,
                "before_confidence":baseline.before_confidence,
                "after_issue_id":after_issue_id,
                "outcome":outcome
            }))
        }else{None};
        let low_confidence = review.overall_confidence < 0.65;
        let latest_attempt = self.attempted_fixes.last().filter(|attempt| attempt.after.is_some());
        let latest_outcome = latest_attempt.map(|attempt| attempt.outcome.as_str());
        let non_improving_count = latest_attempt
            .map(|attempt| grounded_non_improving_attempts(&self.attempted_fixes, attempt))
            .unwrap_or(0);
        let regression_stop = latest_outcome == Some("regressed");
        let repeated_no_gain = latest_outcome == Some("unchanged") && non_improving_count >= 2;
        let completed = review.stop_recommended || !actionable || low_confidence;
        let stop_recommended = review.stop_recommended;
        self.reviews.push(review);
        let (status, reason) = if regression_stop {
            ("stagnated", Some("correction_regressed"))
        } else if repeated_no_gain {
            ("stagnated", Some("repeated_grounded_no_gain"))
        } else if completed {
            ("completed", Some(if stop_recommended { "review_stop_recommended" } else if !actionable { "no_actionable_issues" } else { "review_confidence_too_low" }))
        } else if self.iteration >= self.max_iterations {
            ("stagnated", Some("max_iterations_reached"))
        } else {
            ("awaiting_approval", None)
        };
        self.status = status.into();
        self.stop_reason = reason.map(str::to_string);
        Ok(json!({
            "comparison": comparison,
            "fix_evaluation": fix_evaluation,
            "retry_policy": {
                "regression_stop": regression_stop,
                "grounded_non_improving_attempts": non_improving_count,
                "max_grounded_non_improving_attempts": 2,
                "blind_retry_allowed": false
            },
            "status": self.status,
            "stop_reason": self.stop_reason,
            "iteration": self.iteration
        }))
    }

    pub fn record_fix(&mut self, issue_id: &str, fingerprint: &str, before: &str) -> Result<(), String> {
        if self.status != "awaiting_approval" || !short(issue_id, 80) || !short(fingerprint, 300) || !short(before, 800) {
            return Err("Review session is not ready for an approved fix.".into());
        }
        let issue=self.reviews.last().and_then(|r|r.issues.iter().find(|i|i.id==issue_id)).cloned()
            .ok_or("Fix references an unknown issue.")?;
        if self.attempted_fixes.iter().any(|a| a.fingerprint == fingerprint && !matches!(a.outcome.as_str(),"improved"|"resolved")) {
            self.status = "stagnated".into();
            self.stop_reason = Some("duplicate_unsuccessful_fix".into());
            return Err("Same unsuccessful fix already attempted.".into());
        }
        self.attempted_fixes.push(Attempt { fingerprint: fingerprint.into(), issue_id: issue_id.into(),
            outcome: "uncertain".into(), before: before.into(), after: None, category:issue.category,
            before_severity:issue.severity,before_confidence:issue.confidence,frame_seconds:issue.frame_seconds,
            after_issue_id:None });
        self.iteration += 1;
        self.status = "reviewing".into();
        Ok(())
    }

    pub fn cancel(&mut self) { self.status = "cancelled".into(); self.stop_reason = Some("cancelled_by_user".into()); }
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

fn severity_rank(value: &str) -> u8 {
    match value {
        "high" => 2,
        "medium" => 1,
        _ => 0,
    }
}

pub fn next_actionable_issue(session: &Session) -> Result<Option<Issue>, String> {
    if session.status != "awaiting_approval" {
        return Err("Premiere review session is not awaiting a correction.".into());
    }
    let review = session.reviews.last().ok_or("Premiere review has no completed iteration.")?;
    let mut issues = review.issues.iter()
        .filter(|issue| {
            issue.confidence >= 0.65
                && matches!(issue.severity.as_str(), "medium" | "high")
                && matches!(
                    issue.category.as_str(),
                    "exposure" | "color" | "framing" | "motion" | "transition" | "graphics" | "audio_visual"
                )
        })
        .cloned()
        .collect::<Vec<_>>();

    issues.sort_by(|a, b| {
        severity_rank(&b.severity)
            .cmp(&severity_rank(&a.severity))
            .then_with(|| b.confidence.partial_cmp(&a.confidence).unwrap_or(Ordering::Equal))
            .then_with(|| {
                let a_time = a.frame_seconds.first().copied().unwrap_or(f64::MAX);
                let b_time = b.frame_seconds.first().copied().unwrap_or(f64::MAX);
                a_time.partial_cmp(&b_time).unwrap_or(Ordering::Equal)
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(issues.into_iter().next())
}

pub fn save(path: &Path, session: &Session) -> Result<(), String> {
    validate_session(session)?;
    let data = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    if data.len() > MAX_BYTES || session.reviews.len() > 8 || session.attempted_fixes.len() > 8 {
        return Err("Premiere review history exceeds bounded persistence.".into());
    }
    crate::premiere_store::replace(path,&data,MAX_BYTES,|bytes|{
        let session:Session=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;validate_session(&session)
    })
}

pub fn load(path: &Path) -> Result<Session, String> {
    let decode = |candidate: &Path| -> Result<Session, String> {
        let data = crate::read_file_bytes_bounded(candidate, MAX_BYTES, "Premiere review session")?;
        if data.len() > MAX_BYTES { return Err("Premiere review session file is too large.".into()); }
        let session:Session=serde_json::from_slice(&data).map_err(|e| format!("Corrupt Premiere review session: {e}"))?;
        validate_session(&session)?;Ok(session)
    };
    let session = decode(path).or_else(|error| {
        let backup = path.with_extension("json.bak");
        if backup.exists() {
            let mut recovered=decode(&backup)?;
            recovered.status="failed".into();
            Ok(recovered)
        } else { Err(error) }
    })?;
    Ok(session)
}

fn validate_session(session:&Session)->Result<(),String>{
    if session.schema_version != 2 || session.created_at_ms == 0 || session.reviews.len() > 8 || session.attempted_fixes.len() > 8
        || session.model_calls > 32
        || !samples_ok(&session.sample_times) || !(1..=8).contains(&session.max_iterations)
        || session.iteration == 0 || session.iteration > session.max_iterations
        || session.stop_reason.as_ref().is_some_and(|reason| reason.is_empty() || reason.len() > 240)
        || !matches!(session.status.as_str(), "reviewing" | "awaiting_approval" | "completed" | "cancelled" | "stagnated" | "failed") {
        return Err("Invalid persisted Premiere review session.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn backup_review_is_failed_and_cannot_claim_old_completion(){
        let path=std::env::temp_dir().join(format!("shuvi-review-recover-{}.json",uuid::Uuid::new_v4()));
        let s=session();save(&path,&s).unwrap();save(&path,&s).unwrap();
        let mut invalid=s.clone();invalid.schema_version=99;
        fs::write(&path,serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert_eq!(load(&path).unwrap().status,"failed");
        fs::remove_file(&path).unwrap();fs::remove_file(path.with_extension("json.bak")).unwrap();
    }
    fn session() -> Session { Session::new("id".into(), "p".into(), "s".into(), "clean edit".into(), "".into(), vec![1.0], 4, 1).unwrap() }
    fn issue() -> Issue { Issue { id:"i".into(), category:"color".into(), severity:"medium".into(), confidence:0.9, frame_seconds:vec![1.0], observation:"too warm".into(), suggested_action_type:"color_recipe".into() } }
    fn review(iteration:u8, issues:Vec<Issue>) -> Review { Review { iteration, issues, overall_confidence:0.9, stop_recommended:false } }
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
    #[test] fn fix_evaluation_tracks_same_issue_not_global_count() {
        let mut s=session();
        let mut fixed=issue();fixed.id="fixed".into();fixed.frame_seconds=vec![1.0];
        let mut unrelated=issue();unrelated.id="other".into();unrelated.category="graphics".into();
        s.add_review(review(1,vec![fixed.clone(),unrelated.clone()])).unwrap();
        s.record_fix("fixed","fp","too warm").unwrap();
        let mut still=fixed.clone();still.id="fixed-after".into();still.confidence=0.88;
        let result=s.add_review(review(2,vec![still,unrelated])).unwrap();
        assert_eq!(result["fix_evaluation"]["outcome"],"unchanged");
        assert_eq!(s.attempted_fixes[0].after_issue_id.as_deref(),Some("fixed-after"));
    }
    #[test] fn fix_evaluation_detects_resolved_improved_and_regressed() {
        let mut resolved=session();resolved.add_review(review(1,vec![issue()])).unwrap();
        resolved.record_fix("i","a","too warm").unwrap();
        let r=resolved.add_review(review(2,vec![])).unwrap();
        assert_eq!(r["fix_evaluation"]["outcome"],"resolved");

        let mut improved=session();improved.add_review(review(1,vec![issue()])).unwrap();
        improved.record_fix("i","b","too warm").unwrap();
        let mut lower=issue();lower.id="i2".into();lower.severity="low".into();
        let r=improved.add_review(review(2,vec![lower])).unwrap();
        assert_eq!(r["fix_evaluation"]["outcome"],"improved");

        let mut regressed=session();regressed.add_review(review(1,vec![issue()])).unwrap();
        regressed.record_fix("i","c","too warm").unwrap();
        let mut worse=issue();worse.id="i3".into();worse.severity="high".into();
        let r=regressed.add_review(review(2,vec![worse])).unwrap();
        assert_eq!(r["fix_evaluation"]["outcome"],"regressed");
    }
    #[test] fn regression_immediately_stagnates_loop() {
        let mut s = session();
        s.add_review(review(1, vec![issue()])).unwrap();
        s.record_fix("i", "regress-a", "too warm").unwrap();
        let mut worse = issue();
        worse.id = "worse".into();
        worse.severity = "high".into();
        let result = s.add_review(review(2, vec![worse])).unwrap();
        assert_eq!(result["retry_policy"]["regression_stop"], true);
        assert_eq!(s.status, "stagnated");
        assert_eq!(s.stop_reason.as_deref(), Some("correction_regressed"));
    }

    #[test] fn two_grounded_unchanged_attempts_stop_blind_retry() {
        let mut s = Session::new("id".into(), "p".into(), "s".into(), "clean edit".into(), "".into(), vec![1.0], 6, 1).unwrap();
        s.add_review(review(1, vec![issue()])).unwrap();
        s.record_fix("i", "try-1", "too warm").unwrap();
        let mut same1 = issue();
        same1.id = "same-1".into();
        same1.confidence = 0.88;
        let first = s.add_review(review(2, vec![same1])).unwrap();
        assert_eq!(first["retry_policy"]["grounded_non_improving_attempts"], 1);
        assert_eq!(s.status, "awaiting_approval");

        s.record_fix("same-1", "try-2", "still warm").unwrap();
        let mut same2 = issue();
        same2.id = "same-2".into();
        same2.confidence = 0.87;
        let second = s.add_review(review(3, vec![same2])).unwrap();
        assert_eq!(second["retry_policy"]["grounded_non_improving_attempts"], 2);
        assert_eq!(s.status, "stagnated");
        assert_eq!(s.stop_reason.as_deref(), Some("repeated_grounded_no_gain"));
    }

    #[test] fn prioritizes_grounded_actionable_issue() {
        let mut s = session();
        let mut medium = issue();
        medium.id = "medium".into();
        medium.severity = "medium".into();
        medium.confidence = 0.99;
        let mut high = issue();
        high.id = "high".into();
        high.severity = "high".into();
        high.confidence = 0.70;
        let mut unsupported = issue();
        unsupported.id = "caption".into();
        unsupported.category = "caption".into();
        unsupported.severity = "high".into();
        unsupported.confidence = 1.0;
        s.add_review(review(1, vec![medium, high, unsupported])).unwrap();
        let selected = next_actionable_issue(&s).unwrap().unwrap();
        assert_eq!(selected.id, "high");
        s.status = "reviewing".into();
        assert!(next_actionable_issue(&s).is_err());
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
