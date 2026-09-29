use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use super::premiere_bridge_queue::CommandQueue;

pub const ALLOWED_ACTIONS: &[&str] = &[
    "remove_keyframe_range",
    "remove_video_transition",
    "inspect_keyframes", "inspect_effect_lifecycle", "remove_effect",
    "edit_keyframe",
    "inspect_clip_speed",
    "plan_clip_speed",
    "inspect_context",
    "inspect_media_interpretation",
    "prepare_media_item",
    "create_sequence_from_preset",
    "get_work_area",
    "set_work_area",
    "scene_detection_capabilities",
    "scene_edit_detection",
    "clone_clip_to_track",
    "rename_track",
    "organize_tracks",
    "export_interchange",
    "export_sequence_frame",
    "list_root_items",
    "project_tree",
    "create_bin",
    "rename_project_item",
    "move_project_item",
    "relink_media",
    "set_source_inout",
    "clear_source_inout",
    "create_subclip",
    "plan_transcript_rebuild", "begin_transcript_rebuild", "step_transcript_rebuild", "release_transcript_rebuild",
    "list_transcription_languages",
    "transcribe_item",
    "export_transcript",
    "import_transcript",
    "attach_proxy",
    "insert_mogrt_path",
    "insert_mogrt_library",
    "insert_mapped_graphic",
    "import_media",
    "create_sequence_from_media",
    "create_subsequence",
    "insert_project_item",
    "save_project",
    "inspect_timeline", "inspect_assembly_items", "timeline_capabilities", "plan_video_recipe", "plan_audio_automation", "inspect_mogrt_properties", "plan_mogrt_recipe", "project_diagnostics",
    "caption_tracks",
    "set_caption_track_name",
    "set_caption_track_mute",
    "set_playhead",
    "set_track_mute",
    "set_clip_enabled",
    "list_video_transitions",
    "add_video_transition",
    "list_video_effects",
    "inspect_clip_effects",
    "add_video_effect",
    "set_effect_param",
    "set_video_param_named",
    "add_effect_keyframe",
    "add_video_keyframe_named",
    "apply_video_recipe",
    "list_audio_effects",
    "inspect_audio_clip_effects",
    "add_audio_effect",
    "set_audio_effect_param",
    "set_audio_param_named",
    "add_audio_effect_keyframe",
    "add_audio_keyframe_named",
    "apply_audio_recipe",
    "list_markers",
    "add_marker",
    "remove_marker",
    "insert_media",
    "trim_clip",
    "roll_edit",
    "move_clip",
    "clone_clip",
    "delete_clip",
    "export_sequence",
    "inspect_export",
];

pub const PREMIERE_BRIDGE_PORT: u16 = 17_361;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PremiereBridgeCommand {
    pub id: String,
    pub action: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PremiereBridgeResult {
    pub id: String,
    pub action: String,
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PremiereBridgeStatus {
    pub enabled: bool,
    pub server_started: bool,
    pub paired: bool,
    pub port: u16,
    pub token: Option<String>,
    pub last_seen_ms: Option<u64>,
    pub queued_commands: usize,
}

#[derive(Default)]
pub struct PremiereBridgeShared {
    server_started: Mutex<bool>,
    enabled: Mutex<bool>,
    token: Mutex<Option<String>>,
    token_created: Mutex<Option<std::time::Instant>>,
    active_clients: AtomicUsize,
    work: Mutex<CommandQueue>,
    last_seen_ms: Mutex<Option<u64>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

impl PremiereBridgeShared {
    pub fn start(self: &Arc<Self>) -> Result<PremiereBridgeStatus, String> {
        let mut started = self
            .server_started
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())?;

        if !*started {
            let listener = TcpListener::bind(("127.0.0.1", PREMIERE_BRIDGE_PORT))
                .map_err(|error| {
                    format!(
                        "Could not bind Premiere bridge to 127.0.0.1:{PREMIERE_BRIDGE_PORT}: {error}"
                    )
                })?;

            let shared = Arc::clone(self);
            thread::Builder::new()
                .name("shuvi-premiere-bridge".into())
                .spawn(move || {
                    for stream in listener.incoming() {
                        let Ok(stream) = stream else {
                            continue;
                        };
                        let shared = Arc::clone(&shared);
                        if shared.active_clients.fetch_update(Ordering::AcqRel, Ordering::Relaxed,
                            |count| (count < 16).then_some(count + 1)).is_err() { continue; }
                        let guard = ClientGuard(Arc::clone(&shared));
                        let _ = thread::Builder::new()
                            .name("shuvi-premiere-client".into())
                            .spawn(move || { let _guard = guard; handle_client(stream, shared); });
                    }
                })
                .map_err(|error| format!("Could not start Premiere bridge thread: {error}"))?;

            *started = true;
        }

        let token = Uuid::new_v4().simple().to_string();
        *self.token_created.lock().map_err(|_| "Premiere token clock is unavailable.".to_string())? = Some(std::time::Instant::now());

        *self
            .token
            .lock()
            .map_err(|_| "Premiere bridge token state is unavailable.".to_string())? =
            Some(token);

        *self
            .enabled
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())? = true;

        *self
            .last_seen_ms
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())? = None;

        self.work.lock()
            .map_err(|_| "Premiere bridge work queue is unavailable.".to_string())?.clear();

        drop(started);
        self.status()
    }

    pub fn stop(&self) -> Result<PremiereBridgeStatus, String> {
        *self
            .enabled
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())? = false;

        *self
            .token
            .lock()
            .map_err(|_| "Premiere bridge token state is unavailable.".to_string())? = None;

        *self
            .last_seen_ms
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())? = None;

        self.work.lock()
            .map_err(|_| "Premiere bridge work queue is unavailable.".to_string())?.clear();

        self.status()
    }

    pub fn status(&self) -> Result<PremiereBridgeStatus, String> {
        let enabled = *self
            .enabled
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())?;

        let enabled = enabled && self.token_is_current();

        let server_started = *self
            .server_started
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())?;

        let token = self
            .token
            .lock()
            .map_err(|_| "Premiere bridge token state is unavailable.".to_string())?
            .clone();

        let last_seen_ms = *self
            .last_seen_ms
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())?;

        let queued_commands = {
            let mut work = self.work.lock().map_err(|_| "Premiere bridge work queue is unavailable.".to_string())?;
            work.cleanup(std::time::Instant::now());
            work.queued_len()
        };

        let paired = enabled
            && last_seen_ms
                .map(|seen| now_ms().saturating_sub(seen) <= 4_000)
                .unwrap_or(false);

        Ok(PremiereBridgeStatus {
            enabled,
            server_started,
            paired,
            port: PREMIERE_BRIDGE_PORT,
            token: if enabled { token } else { None },
            last_seen_ms,
            queued_commands,
        })
    }

    pub async fn request(
        &self,
        action: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if !ALLOWED_ACTIONS.contains(&action) {
            return Err("Premiere action is not in the native command allowlist.".into());
        }
        let status = self.status()?;

        if !status.enabled {
            return Err("Premiere bridge is not enabled. Start and pair the UXP bridge first.".into());
        }

        if !status.paired {
            return Err(
                "Premiere UXP panel is not currently paired with Shuvi. Open the Shuvi Premiere Bridge panel and connect it."
                    .into(),
            );
        }

        let id = Uuid::new_v4().to_string();
        let command = PremiereBridgeCommand {
            id: id.clone(),
            action: action.to_string(),
            arguments,
        };

        if timeout.is_zero() || timeout > Duration::from_secs(300) {
            return Err("Premiere command timeout must be between 1 ms and 300 seconds.".into());
        }
        let encoded = serde_json::to_vec(&command).map_err(|e| format!("Invalid Premiere command: {e}"))?;
        if encoded.len() > 240 * 1024 {
            return Err("Premiere command exceeds the 240 KiB payload limit.".into());
        }
        {
            let mut work = self.work.lock().map_err(|_| "Premiere work queue is unavailable.".to_string())?;
            if !self.authenticate(status.token.as_deref()) {
                return Err("Premiere bridge session changed before enqueueing.".into());
            }
            work.enqueue(command, timeout)?;
        }
        // Dropping/cancelling this future removes both queued work and results.
        let _guard = PendingGuard { shared: self, id: id.clone() };
        loop {
            if !self.authenticate(status.token.as_deref()) {
                return Err("execution_status_unknown: Premiere pairing ended or expired. Inspect before retrying any dispatched edit.".into());
            }
            let result = {
                let mut work = self.work.lock().map_err(|_| "Premiere work queue is unavailable.".to_string())?;
                work.take_result(&id)?
            };
            if let Some(result) = result {
                if result.success { return Ok(result.data.unwrap_or(Value::Null)); }
                return Err(format!("execution_status_unknown: Native action {action} returned an error; inspect before retrying. {}", result.error.filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Premiere command failed without an error message.".into())));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn authenticate(&self, supplied: Option<&str>) -> bool {
        if !self.enabled.lock().map(|value| *value).unwrap_or(false) || !self.token_is_current() {
            return false;
        }

        let expected = self.token.lock().ok().and_then(|value| value.clone());
        expected.as_deref().is_some_and(|value| Some(value) == supplied)
    }

    fn token_is_current(&self) -> bool {
        self.token_created.lock().ok().and_then(|value| *value)
            .is_some_and(|created| created.elapsed() < Duration::from_secs(8 * 60 * 60))
    }

    fn mark_seen(&self) {
        if let Ok(mut seen) = self.last_seen_ms.lock() {
            *seen = Some(now_ms());
        }
    }
}

struct PendingGuard<'a> {
    shared: &'a PremiereBridgeShared,
    id: String,
}
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut work) = self.shared.work.lock() { work.remove(&self.id); }
    }
}

struct ClientGuard(Arc<PremiereBridgeShared>);
impl Drop for ClientGuard {
    fn drop(&mut self) { self.0.active_clients.fetch_sub(1, Ordering::AcqRel); }
}

struct HttpRequest {
    method: String,
    path: String,
    token: Option<String>,
    body: Vec<u8>,
}

const MAX_BODY_BYTES: usize = 256 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;

fn parse_headers(headers: &str) -> Result<(String, String, Option<String>, usize), String> {
    let mut lines = headers.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or_default().split_whitespace().collect();
    if parts.len() != 3 || !matches!(parts[2], "HTTP/1.1" | "HTTP/1.0") {
        return Err("Malformed Premiere HTTP request line.".into());
    }
    let mut token = None;
    let mut length = None;
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or("Malformed HTTP header.")?;
        let value = value.trim();
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err("Chunked Premiere bridge requests are unsupported.".into());
        }
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() { return Err("Duplicate Content-Length.".into()); }
            if value.is_empty() || !value.bytes().all(|v| v.is_ascii_digit()) { return Err("Invalid Content-Length.".into()); }
            let size = value.parse::<usize>().map_err(|_| "Invalid Content-Length.".to_string())?;
            if size > MAX_BODY_BYTES { return Err("Premiere request body exceeds 256 KiB.".into()); }
            length = Some(size);
        }
        if name.eq_ignore_ascii_case("x-shuvi-token") {
            if token.is_some() { return Err("Duplicate pairing token header.".into()); }
            token = Some(value.to_string());
        }
    }
    if parts[0] == "POST" && length.is_none() { return Err("POST requires Content-Length.".into()); }
    Ok((parts[0].to_string(), parts[1].to_string(), token, length.unwrap_or(0)))
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut parsed = None;
    loop {
        let remaining = deadline.checked_duration_since(std::time::Instant::now())
            .filter(|d| !d.is_zero()).ok_or("Premiere request read deadline exceeded.")?;
        stream.set_read_timeout(Some(remaining)).map_err(|e| format!("Socket timeout: {e}"))?;
        let count = stream.read(&mut chunk).map_err(|e| format!("Could not read Premiere request: {e}"))?;
        if count == 0 { return Err("Truncated Premiere HTTP request.".into()); }
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.len() > MAX_BODY_BYTES + MAX_HEADER_BYTES { return Err("Premiere request exceeds payload limits.".into()); }
        if parsed.is_none() {
            if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n").map(|index| index + 4) {
                if end > MAX_HEADER_BYTES { return Err("Premiere headers exceed 16 KiB.".into()); }
                let headers = std::str::from_utf8(&buffer[..end]).map_err(|_| "HTTP headers must be UTF-8.".to_string())?;
                parsed = Some((end, parse_headers(headers)?));
            } else if buffer.len() > MAX_HEADER_BYTES { return Err("Premiere headers exceed 16 KiB.".into()); }
        }
        if let Some((end, (method, path, token, length))) = &parsed {
            let expected = end + length;
            if buffer.len() >= expected {
                if buffer.len() != expected { return Err("Unexpected trailing HTTP data.".into()); }
                return Ok(HttpRequest { method: method.clone(), path: path.clone(), token: token.clone(), body: buffer[*end..expected].to_vec() });
            }
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &str,
) -> Result<(), String> {
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e| format!("Socket write timeout: {e}"))?;
    if body.len() > MAX_BODY_BYTES { return Err("Premiere response exceeds 256 KiB.".into()); }
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Shuvi-Token\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );

    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("Could not write Premiere bridge response: {error}"))
}

fn handle_client(mut stream: TcpStream, shared: Arc<PremiereBridgeShared>) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_response(
                &mut stream,
                "400 Bad Request",
                &json!({ "ok": false, "error": error }).to_string(),
            );
            return;
        }
    };

    if request.method == "OPTIONS" {
        let _ = write_response(&mut stream, "204 No Content", "");
        return;
    }

    if !shared.authenticate(request.token.as_deref()) {
        let _ = write_response(
            &mut stream,
            "401 Unauthorized",
            &json!({ "ok": false, "error": "Invalid or disabled Shuvi pairing token." }).to_string(),
        );
        return;
    }

    shared.mark_seen();

    let route = request.path.split('?').next().unwrap_or_default();

    match (request.method.as_str(), route) {
        ("GET", "/health") => {
            let _ = write_response(
                &mut stream,
                "200 OK",
                &json!({
                    "ok": true,
                    "service": "shuvi-premiere-bridge",
                    "port": PREMIERE_BRIDGE_PORT
                })
                .to_string(),
            );
        }
        ("GET", "/command") => {
            let command = shared.work.lock().ok().and_then(|mut work| {
                if shared.authenticate(request.token.as_deref()) { work.dispatch() } else { None }
            });

            let body = serde_json::to_string(&command).unwrap_or_else(|_| "null".into());
            let _ = write_response(&mut stream, "200 OK", &body);
        }
        ("POST", "/result") => {
            let parsed = serde_json::from_slice::<PremiereBridgeResult>(&request.body);

            match parsed {
                Ok(result) if !result.id.trim().is_empty() => {
                    let outcome = shared.work.lock()
                        .map_err(|_| "Premiere work queue is unavailable.".to_string())
                        .and_then(|mut work| {
                            if !shared.authenticate(request.token.as_deref()) { return Err("Pairing session changed.".into()); }
                            work.complete(result)
                        });
                    match outcome {
                        Ok(()) => { let _ = write_response(&mut stream, "200 OK", r#"{"ok":true}"#); }
                        Err(error) => { let _ = write_response(&mut stream, "409 Conflict", &json!({"ok":false,"error":error}).to_string()); }
                    }
                }
                Ok(_) => {
                    let _ = write_response(
                        &mut stream,
                        "400 Bad Request",
                        r#"{"ok":false,"error":"Result id is required."}"#,
                    );
                }
                Err(error) => {
                    let _ = write_response(
                        &mut stream,
                        "400 Bad Request",
                        &json!({ "ok": false, "error": format!("Invalid result payload: {error}") })
                            .to_string(),
                    );
                }
            }
        }
        _ => {
            let _ = write_response(
                &mut stream,
                "404 Not Found",
                r#"{"ok":false,"error":"Unknown Premiere bridge route."}"#,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_reject_ambiguous_oversized_and_invalid_framing() {
        for headers in [
            "POST /result HTTP/1.1\r\n\r\n",
            "POST /result HTTP/1.1\r\nContent-Length: nope\r\n\r\n",
            "POST /result HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n",
            "POST /result HTTP/1.1\r\nContent-Length: 999999999\r\n\r\n",
            "POST /result HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",
            "GET /command HTTP/1.1\r\nX-Shuvi-Token: a\r\nX-Shuvi-Token: b\r\n\r\n",
        ] { assert!(parse_headers(headers).is_err(), "accepted {headers}"); }
        let (_, _, token, length) = parse_headers("POST /result HTTP/1.1\r\ncontent-length: 4\r\nx-shuvi-token: test\r\n\r\n").unwrap();
        assert_eq!(token.as_deref(), Some("test"));
        assert_eq!(length, 4);
    }

    #[test]
    fn pairing_expires_and_rotation_rejects_old_token() {
        let shared = PremiereBridgeShared::default();
        *shared.enabled.lock().unwrap() = true;
        *shared.token.lock().unwrap() = Some("first".into());
        *shared.token_created.lock().unwrap() = Some(std::time::Instant::now());
        assert!(shared.authenticate(Some("first")));
        *shared.token.lock().unwrap() = Some("second".into());
        assert!(!shared.authenticate(Some("first")));
        *shared.token_created.lock().unwrap() = Some(std::time::Instant::now() - Duration::from_secs(8 * 60 * 60 + 1));
        assert!(!shared.authenticate(Some("second")));
    }

    #[test]
    fn dropped_request_guard_removes_pending_command() {
        let shared = PremiereBridgeShared::default();
        shared.work.lock().unwrap().enqueue(PremiereBridgeCommand {
            id: "test".into(), action: "inspect_context".into(), arguments: json!({}),
        }, Duration::from_secs(1)).unwrap();
        drop(PendingGuard { shared: &shared, id: "test".into() });
        assert_eq!(shared.work.lock().unwrap().queued_len(), 0);
    }
}
