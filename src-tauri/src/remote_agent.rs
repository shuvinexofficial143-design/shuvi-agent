//! Authenticated outbound-only Shuvi Windows transport.
//! No inbound port and no ability for a cloud response to invoke OS tools.
//! Mobile approval NEVER bypasses native staged-action policy.
use keyring::Entry;
use reqwest::{redirect::Policy, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const REMOTE_URL: &str = "https://shuvi-control-center.vercel.app/api/remote-agent";
const REMOTE_PROTOCOL: &str = "shuvi.remote.v1";
const MAX_RESPONSE: usize = 96 * 1024;

fn credential() -> Result<Entry, String> {
    Entry::new("Shuvi", "integration:remote_agent:access")
        .map_err(|_| "Windows credential store unavailable.".to_string())
}
fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn device_token() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(s) if valid_token(&s) => Ok(Some(s)),
        Ok(_) => Err("Saved remote credential format is invalid.".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Unable to read remote credential.".into())
    }
}
fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(7))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "Remote HTTP client unavailable.".to_string())
}
async fn request_with_key(key: &str, method: Method, body: Option<Value>) -> Result<Value, String> {
    let client = client()?;
    let mut request = client.request(method, REMOTE_URL).bearer_auth(key)
        .header("Accept", "application/json")
        .header("Cache-Control", "no-store");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request.send().await
        .map_err(|_| "Secure remote relay connection unavailable.".to_string())?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 401 {
            "Remote device credential rejected.".to_string()
        } else {
            "Remote relay rejected the request or is not configured.".to_string()
        });
    }
    if response.content_length().unwrap_or(0) > MAX_RESPONSE as u64 {
        return Err("Remote reply too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Remote reply interrupted.")? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err("Remote reply too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid remote reply JSON.")?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("Remote relay returned a rejected operation.".into());
    }
    value.get("value").cloned().ok_or_else(|| "Remote relay omitted operation result.".into())
}
async fn request(method: Method, body: Option<Value>) -> Result<Value, String> {
    let secret = device_token()?.ok_or("Remote agent has not been paired on this Windows PC.")?;
    request_with_key(&secret, method, body).await
}
fn current_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
fn id(s: &str) -> bool {
    (16..=96).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMessage {
    protocol: String,
    #[serde(rename = "type")]
    kind: String,
    pub owner_id: String,
    pub device_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub task_id: String,
    pub sequence: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub mode: String,
    pub text: String,
}
impl RemoteMessage {
    fn valid(&self, now: u64) -> bool {
        self.protocol == REMOTE_PROTOCOL && self.kind == "user_message"
          && ["task", "chat"].contains(&self.mode.as_str())
          && id(&self.owner_id) && id(&self.device_id) && id(&self.thread_id)
          && id(&self.message_id) && id(&self.task_id)
          && self.sequence > 0 && !self.text.trim().is_empty()
          && self.text.chars().count() <= 2500
          && !self.text.chars().any(char::is_control)
          && self.issued_at <= now.saturating_add(30_000)
          && self.expires_at > now && self.expires_at > self.issued_at
          && self.expires_at - self.issued_at <= 300_000
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    enabled: bool,
    endpoint: &'static str
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInbox {
    messages: Vec<RemoteMessage>,
    pending: Vec<Value>,
    decisions: Vec<Value>
}
#[tauri::command]
pub fn remote_agent_status() -> Result<RemoteStatus, String> {
    Ok(RemoteStatus {enabled:device_token()?.is_some(),endpoint:REMOTE_URL})
}
#[tauri::command]
pub async fn remote_agent_pair(access_code: String) -> Result<RemoteStatus, String> {
    if !valid_token(&access_code) {
        return Err("Agent pairing code must be 64 hexadecimal characters.".into());
    }
    // Only persist after the cloud server proves that this exact token
    // authenticates an AGENT role (not an owner role).
    let value = request_with_key(&access_code, Method::GET, None).await?;
    if !value.get("messages").is_some_and(Value::is_array) {
        return Err("Remote endpoint is not an agent inbox.".into());
    }
    credential()?.set_password(&access_code)
        .map_err(|_| "Could not securely save device credential.".to_string())?;
    remote_agent_status()
}
#[tauri::command]
pub fn remote_agent_disconnect() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not revoke locally stored remote credential.".into())
    }
}
#[tauri::command]
pub async fn remote_agent_poll() -> Result<RemoteInbox, String> {
    let body = request(Method::GET,None).await?;
    let received: Vec<RemoteMessage> = serde_json::from_value(
        body.get("messages").cloned().ok_or("No remote messages field.")?
    ).map_err(|_| "Malformed remote messages.")?;
    if received.len() > 20 || received.iter().any(|m| !m.valid(current_ms())) {
        return Err("Rejected invalid, expired or excessive remote commands.".into());
    }
    let pending = body.get("pending").and_then(Value::as_array).ok_or("Invalid remote cancellation list.")?;
    let decisions = body.get("decisions").and_then(Value::as_array).ok_or("Invalid remote approvals list.")?;
    if pending.len() > 20 || decisions.len() > 20 {
        return Err("Remote event list exceeds bounds.".into());
    }
    Ok(RemoteInbox {messages:received,pending:pending.clone(),decisions:decisions.clone()})
}
#[tauri::command]
pub async fn remote_agent_receipt(receipt: Value) -> Result<Value, String> {
    // Cloud validates transition + owner/device and journal atomicity. Caller
    // must first correlate receipts with native tool action audit identities.
    if !receipt.is_object() || receipt.to_string().len() > 4096
        || receipt.get("protocol").and_then(Value::as_str) != Some(REMOTE_PROTOCOL)
        || receipt.get("type").and_then(Value::as_str) != Some("task_receipt") {
        return Err("Malformed remote task receipt.".into());
    }
    request(Method::POST,Some(json!({"operation":"receipt","receipt":receipt}))).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secrets_require_full_entropy_token_format() {
        assert!(!valid_token("devtoken"));
        assert!(!valid_token(&"g".repeat(64)));
        assert!(valid_token(&"a".repeat(64)));
    }
    #[test]
    fn stale_message_does_not_pass_native_intake() {
        let mut m = RemoteMessage {
            protocol:REMOTE_PROTOCOL.into(),kind:"user_message".into(),
            owner_id:"a".repeat(32),device_id:"b".repeat(32),
            thread_id:"c".repeat(32),message_id:"d".repeat(32),
            task_id:"e".repeat(32),sequence:1,
            issued_at:100_000,expires_at:200_000,mode:"task".into(),text:"Launch Notepad".into()
        };
        assert!(!m.valid(300_000));
        assert!(m.valid(150_000));
        m.text="\0danger".into();
        assert!(!m.valid(150_000));
    }
}
