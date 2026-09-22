use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub const PREMIERE_BRIDGE_PORT: u16 = 17_361;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PremiereBridgeCommand {
    pub id: String,
    pub action: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PremiereBridgeResult {
    pub id: String,
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
    commands: Mutex<VecDeque<PremiereBridgeCommand>>,
    results: Mutex<HashMap<String, PremiereBridgeResult>>,
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
                        let _ = thread::Builder::new()
                            .name("shuvi-premiere-client".into())
                            .spawn(move || handle_client(stream, shared));
                    }
                })
                .map_err(|error| format!("Could not start Premiere bridge thread: {error}"))?;

            *started = true;
        }

        let token = Uuid::new_v4().simple().to_string();

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

        self.commands
            .lock()
            .map_err(|_| "Premiere bridge command queue is unavailable.".to_string())?
            .clear();

        self.results
            .lock()
            .map_err(|_| "Premiere bridge result queue is unavailable.".to_string())?
            .clear();

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

        self.commands
            .lock()
            .map_err(|_| "Premiere bridge command queue is unavailable.".to_string())?
            .clear();

        self.results
            .lock()
            .map_err(|_| "Premiere bridge result queue is unavailable.".to_string())?
            .clear();

        self.status()
    }

    pub fn status(&self) -> Result<PremiereBridgeStatus, String> {
        let enabled = *self
            .enabled
            .lock()
            .map_err(|_| "Premiere bridge state is unavailable.".to_string())?;

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

        let queued_commands = self
            .commands
            .lock()
            .map_err(|_| "Premiere bridge command queue is unavailable.".to_string())?
            .len();

        let paired = enabled
            && last_seen_ms
                .map(|seen| now_ms().saturating_sub(seen) <= 4_000)
                .unwrap_or(false);

        Ok(PremiereBridgeStatus {
            enabled,
            server_started,
            paired,
            port: PREMIERE_BRIDGE_PORT,
            token,
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

        {
            let mut queue = self
                .commands
                .lock()
                .map_err(|_| "Premiere bridge command queue is unavailable.".to_string())?;

            if queue.len() >= 32 {
                return Err("Premiere bridge command queue is full.".into());
            }

            queue.push_back(command);
        }

        let started = std::time::Instant::now();

        loop {
            if let Some(result) = self
                .results
                .lock()
                .map_err(|_| "Premiere bridge result queue is unavailable.".to_string())?
                .remove(&id)
            {
                if result.success {
                    return Ok(result.data.unwrap_or(Value::Null));
                }

                return Err(result
                    .error
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Premiere bridge command failed without an error message.".into()));
            }

            if started.elapsed() >= timeout {
                if let Ok(mut queue) = self.commands.lock() {
                    queue.retain(|command| command.id != id);
                }
                return Err(format!(
                    "Premiere bridge timed out waiting for '{action}' after {} seconds.",
                    timeout.as_secs()
                ));
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn authenticate(&self, supplied: Option<&str>) -> bool {
        if !self.enabled.lock().map(|value| *value).unwrap_or(false) {
            return false;
        }

        let expected = self.token.lock().ok().and_then(|value| value.clone());
        expected.as_deref().is_some_and(|value| Some(value) == supplied)
    }

    fn mark_seen(&self) {
        if let Ok(mut seen) = self.last_seen_ms.lock() {
            *seen = Some(now_ms());
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    token: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("Could not configure Premiere bridge socket: {error}"))?;

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Could not read Premiere bridge request: {error}"))?;

        if read == 0 {
            break;
        }

        buffer.extend_from_slice(&chunk[..read]);

        if buffer.len() > 256 * 1024 {
            return Err("Premiere bridge request exceeded 256 KB.".into());
        }

        if header_end.is_none() {
            header_end = buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| index + 4);

            if let Some(end) = header_end {
                let headers = String::from_utf8_lossy(&buffer[..end]);
                content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.trim().eq_ignore_ascii_case("content-length") {
                            value.trim().parse::<usize>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
            }
        }

        if let Some(end) = header_end {
            if buffer.len() >= end.saturating_add(content_length) {
                break;
            }
        }
    }

    let end = header_end.ok_or_else(|| "Malformed Premiere bridge HTTP request.".to_string())?;
    let headers = String::from_utf8_lossy(&buffer[..end]);
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing Premiere bridge request line.".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let token = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("x-shuvi-token") {
            Some(value.trim().to_string())
        } else {
            None
        }
    });

    let body_end = end.saturating_add(content_length).min(buffer.len());

    Ok(HttpRequest {
        method,
        path,
        token,
        body: buffer[end..body_end].to_vec(),
    })
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &str,
) -> Result<(), String> {
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
            let command = shared
                .commands
                .lock()
                .ok()
                .and_then(|mut queue| queue.pop_front());

            let body = serde_json::to_string(&command).unwrap_or_else(|_| "null".into());
            let _ = write_response(&mut stream, "200 OK", &body);
        }
        ("POST", "/result") => {
            let parsed = serde_json::from_slice::<PremiereBridgeResult>(&request.body);

            match parsed {
                Ok(result) if !result.id.trim().is_empty() => {
                    if let Ok(mut results) = shared.results.lock() {
                        if results.len() > 100 {
                            results.clear();
                        }
                        results.insert(result.id.clone(), result);
                    }
                    let _ = write_response(&mut stream, "200 OK", r#"{"ok":true}"#);
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
