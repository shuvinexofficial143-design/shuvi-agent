//! Level 13 read-only, explicit opt-in local Shuvi Web pairing.
//! No provider keys, OS tools, filesystem operations, actions, approvals or
//! internal ActionState are exposed over this HTTP listener.
use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const BIND: &str = "127.0.0.1:47771";
const ORIGIN: &str = "http://127.0.0.1:1423";
const MAX_HEADERS: usize = 8192;
const ROUTE: &str = "/v1/status";

struct BridgeServer {
    stop: Arc<AtomicBool>,
    worker: JoinHandle<()>,
    token: String,
}

static BRIDGE: OnceLock<Mutex<Option<BridgeServer>>> = OnceLock::new();

fn bridge_lock() -> &'static Mutex<Option<BridgeServer>> {
    BRIDGE.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize)]
pub(crate) struct WebBridgePairing {
    endpoint: &'static str,
    token: String,
    access: &'static str,
}

#[derive(Serialize)]
pub(crate) struct WebBridgeState {
    active: bool,
    endpoint: &'static str,
    access: &'static str,
}

fn same_secret(actual: &str, expected: &str) -> bool {
    let a = actual.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b) { diff |= x ^ y; }
    diff == 0
}

const TOTAL_HEADER_DEADLINE: Duration = Duration::from_secs(3);

fn read_headers(stream: &mut TcpStream) -> Result<String, ()> {
    // A per-read timeout is insufficient: an attacker can trickle one byte
    // every two seconds and indefinitely block the single bridge worker.
    let deadline = Instant::now() + TOTAL_HEADER_DEADLINE;
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|_| ())?;
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    while bytes.len() < MAX_HEADERS {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Err(()); }
        stream.set_read_timeout(Some(remaining)).map_err(|_| ())?;
        let count = stream.read(&mut buffer).map_err(|_| ())?;
        if count == 0 { return Err(()); }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
            return String::from_utf8(bytes).map_err(|_| ());
        }
    }
    Err(())
}

fn http_response(stream: &mut TcpStream, code: &str, body: &str, cors: bool) {
    let cors_headers = if cors {
        format!("Access-Control-Allow-Origin: {ORIGIN}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization\r\n")
    } else { String::new() };
    let payload = format!(
        "HTTP/1.1 {code}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n{cors_headers}\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(payload.as_bytes());
}

fn handle(mut stream: TcpStream, token: &str) {
    let input = match read_headers(&mut stream) {
        Ok(value) => value,
        Err(_) => {
            http_response(&mut stream, "400 Bad Request", r#"{"error":"invalid_headers"}"#, false);
            return;
        }
    };
    let mut lines = input.split("\r\n");
    let line = lines.next().unwrap_or_default();
    let mut pieces = line.split_whitespace();
    let method = pieces.next().unwrap_or_default();
    let path = pieces.next().unwrap_or_default();
    let version = pieces.next().unwrap_or_default();
    if !matches!(version, "HTTP/1.1" | "HTTP/1.0") || pieces.next().is_some() || path != ROUTE {
        http_response(&mut stream, "404 Not Found", r#"{"error":"not_found"}"#, false);
        return;
    }
    let mut origin = "";
    let mut host = "";
    let mut authorization = "";
    let mut preflight = "";
    let mut requested_headers = "";
    let mut invalid = false;
    for line in lines {
        if line.is_empty() { break; }
        let Some((name, value)) = line.split_once(':') else { invalid = true; break; };
        let header_name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match header_name.as_str() {
            "host" => { if !host.is_empty() { invalid = true; } host = value; },
            "origin" => { if !origin.is_empty() { invalid = true; } origin = value; },
            "authorization" => { if !authorization.is_empty() { invalid = true; } authorization = value; },
            "access-control-request-method" => preflight = value,
            "access-control-request-headers" => requested_headers = value,
            "content-length" | "transfer-encoding" => invalid = true,
            _ => {}
        }
    }
    if invalid || host != BIND || origin != ORIGIN {
        http_response(&mut stream, "403 Forbidden", r#"{"error":"forbidden_origin"}"#, false);
        return;
    }
    if method == "OPTIONS" {
        if preflight != "GET" || requested_headers.to_ascii_lowercase() != "authorization" {
            http_response(&mut stream, "403 Forbidden", r#"{"error":"invalid_preflight"}"#, false);
            return;
        }
        http_response(&mut stream, "204 No Content", "", true);
        return;
    }
    if method != "GET" {
        http_response(&mut stream, "405 Method Not Allowed", r#"{"error":"read_only"}"#, true);
        return;
    }
    let presented = authorization.strip_prefix("Bearer ").unwrap_or_default();
    if !same_secret(presented, token) {
        http_response(&mut stream, "401 Unauthorized", r#"{"error":"pairing_required"}"#, true);
        return;
    }
    let heartbeat_ms = SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_millis();
    let body = serde_json::json!({
        "protocol": 1,
        "runtime": "shuvi-tauri",
        "state": "connected",
        "version": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
        "heartbeat_ms": heartbeat_ms,
        "scope": "status_read_only",
        "permission_mode": "native_approval_only",
        "tasks": "not_exposed",
        "approvals": "not_exposed"
    }).to_string();
    http_response(&mut stream, "200 OK", &body, true);
}

#[tauri::command]
pub(crate) fn web_bridge_start() -> Result<WebBridgePairing, String> {
    let mut lock = bridge_lock().lock()
        .map_err(|_| "Web bridge state unavailable.".to_string())?;
    if let Some(active) = lock.as_ref() {
        return Ok(WebBridgePairing {
            endpoint: "http://127.0.0.1:47771",
            token: active.token.clone(),
            access: "status_read_only"
        });
    }
    let listener = TcpListener::bind(BIND)
        .map_err(|_| "Could not bind 127.0.0.1:47771. Stop any other process on that port.".to_string())?;
    listener.set_nonblocking(true)
        .map_err(|_| "Could not configure the read-only bridge listener.".to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let thread_token = token.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = Arc::clone(&stop);
    let worker = thread::Builder::new().name("shuvi-web-readonly".into()).spawn(move || {
        while !stopping.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    if addr.ip().is_loopback() { handle(stream, &thread_token); }
                },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(60));
                },
                Err(_) => thread::sleep(Duration::from_millis(100)),
            }
        }
    }).map_err(|_| "Could not start the local read-only bridge thread.".to_string())?;
    *lock = Some(BridgeServer { stop, worker, token: token.clone() });
    Ok(WebBridgePairing {endpoint: "http://127.0.0.1:47771",token,access:"status_read_only"})
}

#[tauri::command]
pub(crate) fn web_bridge_stop() -> Result<bool, String> {
    let mut lock = bridge_lock().lock()
        .map_err(|_| "Web bridge state unavailable.".to_string())?;
    if let Some(server) = lock.take() {
        server.stop.store(true, Ordering::Release);
        server.worker.join().map_err(|_| "Web bridge thread failed to stop.".to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub(crate) fn web_bridge_state() -> Result<WebBridgeState, String> {
    let lock = bridge_lock().lock()
        .map_err(|_| "Web bridge state unavailable.".to_string())?;
    Ok(WebBridgeState {
        active: lock.is_some(), endpoint: "http://127.0.0.1:47771", access:"status_read_only"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secrets_require_the_entire_pairing_token() {
        assert!(same_secret("a1234567", "a1234567"));
        assert!(!same_secret("a1234567", "a1234568"));
        assert!(!same_secret("a123456", "a1234567"));
    }
    #[test]
    fn bridge_is_explicitly_local_and_read_only() {
        assert_eq!(BIND, "127.0.0.1:47771");
        assert_eq!(ORIGIN, "http://127.0.0.1:1423");
        assert_eq!(ROUTE, "/v1/status");
    }
}
