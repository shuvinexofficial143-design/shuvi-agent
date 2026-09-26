use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{future::Future, sync::atomic::{AtomicBool, Ordering}};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source { pub track: u32, pub clip_index: u32 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Destination { pub mode: String, pub sequence_guid: String, pub video_track: u32, pub audio_track: u32 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Removal {
    #[serde(default, skip_serializing_if="Option::is_none")] pub segment_id: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub start: Option<f64>,
    #[serde(default, skip_serializing_if="Option::is_none")] pub end: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32, pub item_id: String, pub source: Source,
    pub transcript_source_offset: f64, pub removals: Vec<Removal>, pub destination: Destination,
    pub take_video: bool, pub take_audio: bool, #[serde(default)] pub gap_seconds: f64,
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.item_id.trim().is_empty() || self.item_id.len() > 240 ||
            self.source.track >= 64 || self.source.clip_index > 10000 || !self.take_video ||
            self.destination.mode != "explicit_empty_target_sequence" || self.destination.sequence_guid.trim().is_empty() ||
            self.destination.sequence_guid.len() > 240 || self.destination.video_track >= 64 || self.destination.audio_track >= 64 ||
            !self.transcript_source_offset.is_finite() || self.transcript_source_offset.abs() > 86400.0 ||
            !self.gap_seconds.is_finite() || !(0.0..=60.0).contains(&self.gap_seconds) || self.removals.is_empty() || self.removals.len() > 128 {
            return Err("Invalid bounded transcript rebuild request.".into());
        }
        for r in &self.removals {
            match (&r.segment_id, r.start, r.end) {
                (Some(id), None, None) if id.len() == 8 && id.starts_with("seg-") && id[4..].bytes().all(|b| b.is_ascii_digit()) => {},
                (None, Some(a), Some(b)) if a.is_finite() && b.is_finite() && a >= 0.0 && b > a && b <= 86400.0 => {},
                _ => return Err("Removal requires a segment ID OR a complete explicit transcript range.".into()),
            }
        }
        Ok(())
    }
}

// Cancellation is checked between subclip creation and insertion as well as between pieces.
// A native step has a one-shot cursor; errors and lost replies are never retried.
pub async fn run<F, Fut>(id: &str, count: usize, cancelled: &AtomicBool, mut step: F) -> Value
where F: FnMut(usize) -> Fut, Fut: Future<Output=Result<Value, String>> {
    let mut results = Vec::new();
    let mut uncertain = false;
    let mut all_applied = true;
    if count > 256 { return json!({"complete":false,"error":"Rebuild operation bound exceeded","uncertain":false}); }
    for index in 0..count {
        if cancelled.load(Ordering::Acquire) { break; }
        match step(index).await {
            Ok(value) => {
                let applied = value.get("status").and_then(Value::as_str) == Some("applied") &&
                    value.get("index").and_then(Value::as_u64) == Some(index as u64) && value.get("uncertain").and_then(Value::as_bool) == Some(false);
                uncertain = value.get("uncertain").and_then(Value::as_bool).unwrap_or(true);
                results.push(value);
                if !applied { all_applied = false; break; }
            },
            Err(error) => { uncertain = true; results.push(json!({"index":index,"status":"uncertain","error":error,"uncertain":true})); break; }
        }
    }
    let complete = all_applied && results.len() == count && !uncertain;
    json!({"id":id,"complete":complete,"operations":results,"cancelled":cancelled.load(Ordering::Acquire),"uncertain":uncertain,
        "automatic_rollback":false,"blind_retry":false,"linked_media_inferred":false})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, task::{Context, Poll, Wake, Waker}, pin::pin};
    struct Ready;
    impl Wake for Ready { fn wake(self: Arc<Self>) {} }
    fn ready<F: Future>(f: F) -> F::Output { let w = Waker::from(Arc::new(Ready)); let mut cx = Context::from_waker(&w); match pin!(f).poll(&mut cx) { Poll::Ready(v) => v, _ => panic!("unexpected pending") } }
    fn request() -> Value { json!({"schema_version":1,"item_id":"media","source":{"track":0,"clip_index":0},"transcript_source_offset":0,"removals":[{"start":2,"end":3}],"destination":{"mode":"explicit_empty_target_sequence","sequence_guid":"dest","video_track":0,"audio_track":0},"take_video":true,"take_audio":false}) }
    #[test] fn strict_input_and_explicit_audio() {
        let mut value = request(); serde_json::from_value::<Request>(value.clone()).unwrap().validate().unwrap();
        value["script"] = json!("x"); assert!(serde_json::from_value::<Request>(value).is_err());
        let mut value = request(); value.as_object_mut().unwrap().remove("take_audio"); assert!(serde_json::from_value::<Request>(value).is_err());
    }
    #[test] fn ranges_are_bounded() {
        let mut r: Request = serde_json::from_value(request()).unwrap();
        r.removals[0].segment_id = Some("seg-0001".into()); assert!(r.validate().is_err());
        r.removals[0].segment_id = None; r.removals = vec![r.removals[0].clone();129]; assert!(r.validate().is_err());
    }
    #[test] fn cancellation_between_subclip_and_insert() {
        let cancel = AtomicBool::new(false); let mut calls = 0;
        let out = ready(run("id",4,&cancel,|index| { calls += 1; cancel.store(true,Ordering::Release); async move {Ok(json!({"index":index,"status":"applied","uncertain":false}))} }));
        assert_eq!(calls,1); assert_eq!(out["complete"],false); assert_eq!(out["cancelled"],true);
    }
    #[test] fn delivery_uncertainty_stops_without_retry() {
        let cancel = AtomicBool::new(false); let mut calls = 0;
        let out = ready(run("id",4,&cancel,|_| { calls += 1; async {Err("lost reply".into())} }));
        assert_eq!(calls,1); assert_eq!(out["uncertain"],true);
    }
    #[test] fn rejected_second_step_preserves_partial_result() {
        let cancel = AtomicBool::new(false);
        let out = ready(run("id",4,&cancel,|index| async move {Ok(json!({"index":index,"status":if index==0 {"applied"} else {"failed"},"uncertain":false}))}));
        assert_eq!(out["operations"].as_array().unwrap().len(),2); assert_eq!(out["complete"],false);
    }
    #[test] fn already_cancelled_dispatches_nothing() {
        let cancel = AtomicBool::new(true);
        let out = ready(run("id",2,&cancel,|_| async {panic!("must not dispatch"); #[allow(unreachable_code)] Ok(Value::Null)}));
        assert_eq!(out["operations"],json!([]));
    }
}
