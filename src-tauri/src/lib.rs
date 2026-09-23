use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

mod premiere_bridge;
use premiere_bridge::{PremiereBridgeShared, PremiereBridgeStatus};

const KEYRING_SERVICE: &str = "Shuvi";
const SOFT_LIMIT_MB: f64 = 3584.0;
const HARD_LIMIT_MB: f64 = 4096.0;
const MAX_READ_BYTES: u64 = 1_048_576;
const MAX_WRITE_BYTES: usize = 2_097_152;
const MAX_TOOL_OUTPUT_CHARS: usize = 120_000;

const TOOL_PROTOCOL: &str = r#"You are Shuvi, a permission-first Windows desktop AI agent.
If the user's request requires a computer action, choose ONE tool and respond ONLY with a JSON object:
{"tool":"tool_name","arguments":{...},"reason":"short explanation"}

Available tools:
- list_directory: {"path":"absolute path"}
- read_file: {"path":"absolute path"}
- write_file: {"path":"absolute path","content":"complete file content"}
- create_directory: {"path":"absolute path"}
- launch_app: {"program":"executable or absolute path","args":["optional","arguments"]}
- open_url: {"url":"https://example.com"}
- browser_start: {"browser":"edge|chrome","url":"optional https:// page"}
- browser_navigate: {"pid":1234,"url":"https://example.com"}
- browser_dom_read: {"pid":1234,"selector":"CSS selector"}
- browser_dom_click: {"pid":1234,"selector":"CSS selector"}
- browser_dom_set_value: {"pid":1234,"selector":"CSS selector","value":"text"}
- stop_managed_process: {"pid":1234}
- capture_screen: {}
- inspect_screen: {"prompt":"what should be understood from the current screen"}
- list_processes: {}
- ui_find: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_click: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_set_value: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","value":"text to enter"}
- ui_focus: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_scroll: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","vertical":"small_increment|small_decrement|large_increment|large_decrement"}
- ui_toggle: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_expand_collapse: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","action":"expand|collapse"}
- ui_send_keys: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","keys":"SendKeys sequence"}
- pointer_click: {"x":123,"y":456,"button":"left|right|middle","clicks":1}
- premiere_detect: {}
- premiere_launch: {"project":"optional absolute .prproj path"}
- premiere_bridge_start: {}
- premiere_bridge_status: {}
- premiere_context: {}
- premiere_timeline: {}
- premiere_set_playhead: {"seconds":12.5}
- premiere_set_track_mute: {"kind":"video|audio","track":0,"muted":true}
- premiere_list_items: {}
- premiere_create_bin: {"name":"bin name"}
- premiere_import_media: {"paths":["absolute media path 1","absolute media path 2"]}
- premiere_create_sequence_from_media: {"name":"sequence name","paths":["absolute media path 1","absolute media path 2"]}
- premiere_insert_media: {"path":"absolute media path","seconds":0,"video_track":0,"audio_track":0,"mode":"insert|overwrite"}
- premiere_trim_clip: {"kind":"video|audio","track":0,"clip_index":0,"start_seconds":0.0,"end_seconds":5.0}
- premiere_move_clip: {"kind":"video|audio","track":0,"clip_index":0,"delta_seconds":1.5}
- premiere_delete_clip: {"kind":"video|audio","track":0,"clip_index":0,"ripple":true}
- premiere_set_track_mute: {"kind":"video|audio","track":0,"muted":true}
- premiere_export_sequence: {"output":"absolute output media path","preset":"optional absolute .epr preset path","queue_to_ame":false}
- premiere_save_project: {}
- workspace_scan: {"path":"absolute workspace path"}
- search_text: {"path":"absolute workspace path","query":"text to find"}
- replace_text: {"path":"absolute file path","old":"exact old text","new":"replacement text"}
- apply_patch: {"path":"absolute Git repository path","patch":"unified diff patch"}
- run_project_task: {"path":"absolute project path","task":"test|build|lint|typecheck"}
- git_status: {"path":"absolute repository path"}
- git_diff: {"path":"absolute repository path"}
- git_commit: {"path":"absolute repository path","message":"commit message"}
- git_push: {"path":"absolute repository path"}
- powershell: {"command":"PowerShell command"}

Rules:
- Use tools only when a computer action is required.
- Never claim an action succeeded before Shuvi returns a tool result.
- Prefer typed file/app/browser/screen tools over PowerShell.
- capture_screen only captures an image and returns its local path; do not infer visual contents from that path.
- inspect_screen captures the screen and sends it to the currently selected vision-capable provider after user approval.
- Do not put tool JSON inside markdown fences.
- For destructive/system/security-sensitive work, explain the intent in reason.
- Before git_commit, inspect git_status and git_diff so the user can review what will be committed.
- Treat git_push as a remote write and request it only after a successful commit when the user asked for a push.
- Use run_project_task instead of raw shell commands when test/build/lint/typecheck is enough.
- For browser/app UI work, prefer a Shuvi-managed browser when isolation matters, then use window-scoped semantic UI tools first. Use ui_toggle and ui_expand_collapse for supported controls. ui_send_keys is a high-risk fallback only after an exact element is focused and semantic patterns are unavailable. pointer_click is a final high-risk coordinate fallback: inspect_screen first, use coordinates only when semantic UI/DOM control cannot target the control, and never repeat a failed coordinate click blindly.
- For Adobe Premiere Pro, use premiere_detect/premiere_launch for discovery and startup. Start/pair premiere_bridge_start before native project operations. Prefer premiere_context/premiere_timeline/premiere_list_items for inspection, premiere_set_playhead for non-destructive navigation and premiere_create_bin/premiere_import_media/premiere_create_sequence_from_media/premiere_insert_media/premiere_save_project for native editing. premiere_insert_media, premiere_trim_clip, premiere_move_clip and premiere_delete_clip are high risk because they change the timeline; premiere_export_sequence is high risk because it writes media and may start encoding; inspect the timeline first when practical. Use UI/vision fallbacks only for features not exposed through the bridge. Major sequence creation and timeline insert/overwrite actions automatically save and copy the current .prproj into a sibling 'Shuvi Backups' folder before editing when a normal project path is available.
- For managed Edge/Chrome sessions, prefer browser_dom_read/browser_dom_click/browser_dom_set_value/browser_navigate over visual coordinate actions because DOM selectors are more reliable.
- browser_dom_click and browser_dom_set_value require selectors that match exactly one element; refine with browser_dom_read when ambiguous.
- stop_managed_process may only target process roots that Shuvi launched itself.
- When a tool fails, do not repeat the exact same failing action blindly. Use the observation to refine the selector, inspect the screen, or choose a different typed tool.
- If no computer action is needed, answer normally."#;

#[derive(Debug, Clone, Serialize)]
struct ProviderDescriptor {
    id: &'static str,
    name: &'static str,
    default_model: &'static str,
    api_key_required: bool,
    custom_base_url: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionCheckpoint {
    version: u32,
    updated_at_ms: u64,
    provider: String,
    model: String,
    base_url: Option<String>,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChatInput {
    provider: String,
    model: String,
    base_url: Option<String>,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolProposal {
    tool: String,
    arguments: Value,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct UsageStats {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
struct ChatResponse {
    content: String,
    provider: String,
    model: String,
    tool_proposal: Option<ToolProposal>,
    usage: Option<UsageStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
struct PendingActionView {
    id: String,
    kind: String,
    summary: String,
    detail: String,
    risk: RiskLevel,
}

#[derive(Debug, Clone)]
struct ProviderContext {
    provider: String,
    model: String,
    base_url: Option<String>,
}

#[derive(Debug, Clone)]
enum ToolAction {
    ListDirectory { path: String },
    ReadFile { path: String },
    WriteFile { path: String, content: String },
    CreateDirectory { path: String },
    LaunchApp { program: String, args: Vec<String> },
    OpenUrl { url: String },
    BrowserStart { browser: String, url: Option<String> },
    BrowserNavigate { pid: u32, url: String },
    BrowserDomRead { pid: u32, selector: String },
    BrowserDomClick { pid: u32, selector: String },
    BrowserDomSetValue { pid: u32, selector: String, value: String },
    StopManagedProcess { pid: u32 },
    CaptureScreen,
    InspectScreen { prompt: String, provider: ProviderContext },
    ListProcesses,
    UiFind { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiClick { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiSetValue { name: Option<String>, automation_id: Option<String>, window: Option<String>, value: String },
    UiFocus { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiScroll { name: Option<String>, automation_id: Option<String>, window: Option<String>, vertical: String },
    UiToggle { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiExpandCollapse { name: Option<String>, automation_id: Option<String>, window: Option<String>, action: String },
    UiSendKeys { name: Option<String>, automation_id: Option<String>, window: Option<String>, keys: String },
    PointerClick { x: i32, y: i32, button: String, clicks: u32 },
    PremiereDetect,
    PremiereLaunch { project: Option<String> },
    PremiereBridgeStart,
    PremiereBridgeStatus,
    PremiereContext,
    PremiereTimeline,
    PremiereSetPlayhead { seconds: f64 },
    PremiereSetTrackMute { kind: String, track: u32, muted: bool },
    PremiereListItems,
    PremiereCreateBin { name: String },
    PremiereImportMedia { paths: Vec<String> },
    PremiereCreateSequenceFromMedia { name: String, paths: Vec<String> },
    PremiereInsertMedia { path: String, seconds: f64, video_track: u32, audio_track: u32, mode: String },
    PremiereTrimClip { kind: String, track: u32, clip_index: u32, start_seconds: Option<f64>, end_seconds: Option<f64> },
    PremiereMoveClip { kind: String, track: u32, clip_index: u32, delta_seconds: f64 },
    PremiereDeleteClip { kind: String, track: u32, clip_index: u32, ripple: bool },
    PremiereSetTrackMute { kind: String, track: u32, muted: bool },
    PremiereExportSequence { output: String, preset: Option<String>, queue_to_ame: bool },
    PremiereSaveProject,
    WorkspaceScan { path: String },
    SearchText { path: String, query: String },
    ReplaceText { path: String, old: String, new_value: String },
    ApplyPatch { path: String, patch: String },
    RunProjectTask { path: String, task: String },
    GitStatus { path: String },
    GitDiff { path: String },
    GitCommit { path: String, message: String },
    GitPush { path: String },
    PowerShell { command: String },
}

#[derive(Debug, Clone)]
struct PendingAction {
    tool: String,
    detail: String,
    action: ToolAction,
}

#[derive(Debug, Clone, Serialize)]
struct ActionResult {
    success: bool,
    tool: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuditEntry {
    timestamp_ms: u64,
    event: String,
    tool: String,
    detail: String,
    success: bool,
}

#[derive(Debug, Clone, Serialize)]
struct RuntimeStatus {
    shuvi_memory_bytes: u64,
    shuvi_memory_mb: f64,
    native_memory_mb: f64,
    managed_children_memory_mb: f64,
    managed_children_count: usize,
    soft_limit_mb: f64,
    hard_limit_mb: f64,
    over_soft_limit: bool,
    over_hard_limit: bool,
}

#[derive(Debug, Clone)]
struct BrowserSession {
    port: u16,
    profile_dir: std::path::PathBuf,
}

#[derive(Default)]
struct ActionState {
    pending: Mutex<HashMap<String, PendingAction>>,
    managed_children: Mutex<HashSet<u32>>,
    browser_sessions: Mutex<HashMap<u32, BrowserSession>>,
    premiere_bridge: Arc<PremiereBridgeShared>,
}

fn providers() -> Vec<ProviderDescriptor> {
    vec![
        ProviderDescriptor {
            id: "deepseek",
            name: "DeepSeek",
            default_model: "deepseek-chat",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "openai",
            name: "OpenAI",
            default_model: "gpt-5.6",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "gemini",
            name: "Google Gemini",
            default_model: "gemini-2.5-flash",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "anthropic",
            name: "Anthropic Claude",
            default_model: "claude-sonnet-4-5",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "openrouter",
            name: "OpenRouter",
            default_model: "openai/gpt-4.1-mini",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "ollama",
            name: "Ollama (local)",
            default_model: "qwen3:4b",
            api_key_required: false,
            custom_base_url: true,
        },
        ProviderDescriptor {
            id: "custom",
            name: "Custom OpenAI-compatible",
            default_model: "model-name",
            api_key_required: true,
            custom_base_url: true,
        },
    ]
}

fn provider_ids() -> HashSet<&'static str> {
    providers().into_iter().map(|provider| provider.id).collect()
}

fn key_entry(provider_id: &str) -> Result<Entry, String> {
    if !provider_ids().contains(provider_id) {
        return Err("Unknown provider.".into());
    }

    Entry::new(KEYRING_SERVICE, &format!("provider:{provider_id}"))
        .map_err(|error| format!("Credential store unavailable: {error}"))
}

fn load_api_key(provider_id: &str) -> Result<Option<String>, String> {
    if provider_id == "ollama" {
        return Ok(None);
    }

    let entry = key_entry(provider_id)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read credential: {error}")),
    }
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))
}

async fn send_with_retry(
    request: reqwest::RequestBuilder,
    label: &str,
) -> Result<reqwest::Response, String> {
    let mut last_error: Option<String> = None;

    for attempt in 0..3_u32 {
        let attempt_request = request
            .try_clone()
            .ok_or_else(|| format!("{label} request could not be cloned for retry."))?;

        match attempt_request.send().await {
            Ok(response) => {
                let status = response.status();
                let retryable = status.as_u16() == 429
                    || matches!(status.as_u16(), 500 | 502 | 503 | 504);

                if retryable && attempt < 2 {
                    last_error = Some(format!("HTTP {status}"));
                    let delay_ms = 350_u64.saturating_mul(1_u64 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }

                return Ok(response);
            }
            Err(error) => {
                let retryable = error.is_connect() || error.is_timeout() || error.is_request();

                if retryable && attempt < 2 {
                    last_error = Some(error.to_string());
                    let delay_ms = 350_u64.saturating_mul(1_u64 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }

                return Err(format!("{label} failed: {error}"));
            }
        }
    }

    Err(format!(
        "{label} failed after retries: {}",
        last_error.unwrap_or_else(|| "unknown network error".into())
    ))
}

fn compact_error(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| body.to_string().chars().take(400).collect())
}

fn parse_tool_proposal(text: &str) -> Option<ToolProposal> {
    let mut candidate = text.trim();

    if let Some(stripped) = candidate.strip_prefix("```json") {
        candidate = stripped.strip_suffix("```").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("```") {
        candidate = stripped.strip_suffix("```").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("~~~json") {
        candidate = stripped.strip_suffix("~~~").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("~~~") {
        candidate = stripped.strip_suffix("~~~").unwrap_or(stripped).trim();
    }

    let proposal: ToolProposal = serde_json::from_str(candidate).ok()?;

    match proposal.tool.as_str() {
        "list_directory"
        | "read_file"
        | "write_file"
        | "create_directory"
        | "launch_app"
        | "open_url"
        | "browser_start"
        | "browser_navigate"
        | "browser_dom_read"
        | "browser_dom_click"
        | "browser_dom_set_value"
        | "stop_managed_process"
        | "capture_screen"
        | "inspect_screen"
        | "list_processes"
        | "ui_find"
        | "ui_click"
        | "ui_set_value"
        | "ui_focus"
        | "ui_scroll"
        | "ui_toggle"
        | "ui_expand_collapse"
        | "ui_send_keys"
        | "pointer_click"
        | "premiere_detect"
        | "premiere_launch"
        | "premiere_bridge_start"
        | "premiere_bridge_status"
        | "premiere_context"
        | "premiere_timeline"
        | "premiere_set_playhead"
        | "premiere_set_track_mute"
        | "premiere_list_items"
        | "premiere_create_bin"
        | "premiere_import_media"
        | "premiere_create_sequence_from_media"
        | "premiere_insert_media"
        | "premiere_trim_clip"
        | "premiere_move_clip"
        | "premiere_delete_clip"
        | "premiere_set_track_mute"
        | "premiere_export_sequence"
        | "premiere_save_project"
        | "workspace_scan"
        | "search_text"
        | "replace_text"
        | "apply_patch"
        | "run_project_task"
        | "git_status"
        | "git_diff"
        | "git_commit"
        | "git_push"
        | "powershell" => Some(proposal),
        _ => None,
    }
}

fn chat_response(
    content: String,
    provider: String,
    model: String,
    usage: Option<UsageStats>,
) -> ChatResponse {
    let tool_proposal = parse_tool_proposal(&content);
    ChatResponse {
        content,
        provider,
        model,
        tool_proposal,
        usage,
    }
}

fn usage_from_openai(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usage")?;
    let input = usage
        .get("prompt_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("input_tokens").and_then(Value::as_u64))
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("output_tokens").and_then(Value::as_u64))
        .unwrap_or(0);
    let total = usage
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input.saturating_add(output));

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
    })
}

fn usage_from_gemini(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usageMetadata")?;
    let input = usage
        .get("promptTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("candidatesTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total = usage
        .get("totalTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(input.saturating_add(output));

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
    })
}

fn usage_from_anthropic(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usage")?;
    let input = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input.saturating_add(output),
    })
}

async fn openai_compatible_chat(
    input: ChatInput,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let url = match input.provider.as_str() {
        "deepseek" => "https://api.deepseek.com/chat/completions".to_string(),
        "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
        "ollama" => input
            .base_url
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".into()),
        "custom" => input
            .base_url
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Custom provider requires a base URL.".to_string())?,
        _ => return Err("Invalid OpenAI-compatible provider.".into()),
    };

    if matches!(input.provider.as_str(), "deepseek" | "openai" | "openrouter")
        && api_key.as_deref().unwrap_or("").is_empty()
    {
        return Err("No API key saved for this provider.".into());
    }

    let mut request = http_client()?.post(&url).json(&json!({
        "model": input.model,
        "messages": input.messages
    }));

    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        request = request.bearer_auth(key);
    }

    let response = send_with_retry(request, "Provider request").await?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid provider response: {error}"))?;

    if !status.is_success() {
        return Err(format!("Provider returned {status}: {}", compact_error(&body)));
    }

    let content = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "Provider response had no assistant text.".to_string())?
        .to_string();

    let usage = usage_from_openai(&body);
    Ok(chat_response(content, input.provider, input.model, usage))
}

async fn gemini_chat(input: ChatInput, api_key: Option<String>) -> Result<ChatResponse, String> {
    let key = api_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "No Gemini API key saved.".to_string())?;

    let model = input.model.clone();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, key
    );

    let mut system_parts = Vec::new();
    let mut contents = Vec::new();

    for message in &input.messages {
        if message.role == "system" {
            system_parts.push(json!({ "text": message.content }));
        } else {
            let role = if message.role == "assistant" { "model" } else { "user" };
            contents.push(json!({
                "role": role,
                "parts": [{ "text": message.content }]
            }));
        }
    }

    let mut payload = json!({ "contents": contents });
    if !system_parts.is_empty() {
        payload["systemInstruction"] = json!({ "parts": system_parts });
    }

    let request = http_client()?
        .post(url)
        .json(&payload);

    let response = send_with_retry(request, "Gemini request").await?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid Gemini response: {error}"))?;

    if !status.is_success() {
        return Err(format!("Gemini returned {status}: {}", compact_error(&body)));
    }

    let parts = body
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .ok_or_else(|| "Gemini returned no candidate text.".to_string())?;

    let content = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");

    if content.is_empty() {
        return Err("Gemini returned an empty response.".into());
    }

    let usage = usage_from_gemini(&body);
    Ok(chat_response(content, input.provider, model, usage))
}

async fn anthropic_chat(
    input: ChatInput,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let key = api_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "No Anthropic API key saved.".to_string())?;

    let model = input.model.clone();

    let system = input
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let messages = input
        .messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": message.content
            })
        })
        .collect::<Vec<_>>();

    let request = http_client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "messages": messages
        }));

    let response = send_with_retry(request, "Anthropic request").await?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid Anthropic response: {error}"))?;

    if !status.is_success() {
        return Err(format!("Anthropic returned {status}: {}", compact_error(&body)));
    }

    let content = body
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                part.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("");

    if content.is_empty() {
        return Err("Anthropic returned an empty response.".into());
    }

    let usage = usage_from_anthropic(&body);
    Ok(chat_response(content, input.provider, model, usage))
}

async fn send_chat(input: ChatInput, api_key: Option<String>) -> Result<ChatResponse, String> {
    match input.provider.as_str() {
        "gemini" => gemini_chat(input, api_key).await,
        "anthropic" => anthropic_chat(input, api_key).await,
        "deepseek" | "openai" | "openrouter" | "ollama" | "custom" => {
            openai_compatible_chat(input, api_key).await
        }
        other => Err(format!("Unsupported provider: {other}")),
    }
}

fn current_runtime_status(state: &ActionState) -> Result<RuntimeStatus, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let pid = sysinfo::get_current_pid().map_err(|error| format!("PID error: {error}"))?;
    let process = system
        .process(pid)
        .ok_or_else(|| "Could not read Shuvi process memory.".to_string())?;

    let native_bytes = process.memory();

    let mut managed = state
        .managed_children
        .lock()
        .map_err(|_| "Managed-process state is unavailable.".to_string())?;

    managed.retain(|child_pid| system.process(Pid::from_u32(*child_pid)).is_some());

    let managed_tree = managed_tree_pids(&system, &managed);
    let managed_children_bytes = managed_tree
        .iter()
        .filter_map(|pid| system.process(*pid))
        .map(|process| process.memory())
        .fold(0_u64, u64::saturating_add);

    let managed_children_count = managed_tree.len();
    drop(managed);

    let bytes = native_bytes.saturating_add(managed_children_bytes);
    let mb = bytes as f64 / 1024.0 / 1024.0;
    let native_mb = native_bytes as f64 / 1024.0 / 1024.0;
    let managed_children_mb = managed_children_bytes as f64 / 1024.0 / 1024.0;

    Ok(RuntimeStatus {
        shuvi_memory_bytes: bytes,
        shuvi_memory_mb: mb,
        native_memory_mb: native_mb,
        managed_children_memory_mb: managed_children_mb,
        managed_children_count,
        soft_limit_mb: SOFT_LIMIT_MB,
        hard_limit_mb: HARD_LIMIT_MB,
        over_soft_limit: mb >= SOFT_LIMIT_MB,
        over_hard_limit: mb >= HARD_LIMIT_MB,
    })
}

fn ensure_memory_budget(state: &ActionState) -> Result<(), String> {
    let status = current_runtime_status(state)?;
    if status.over_hard_limit {
        Err("Shuvi and its managed child processes are above the 4 GB hard RAM ceiling. Close heavy work before starting another action.".into())
    } else {
        Ok(())
    }
}

fn classify_powershell(command: &str) -> RiskLevel {
    let lower = command.to_ascii_lowercase();

    let high = [
        "remove-item", "del ", "erase ", "format-", "clear-disk",
        "remove-partition", "stop-computer", "restart-computer", "shutdown",
        "reg delete", "invoke-expression", "iex ", "remove-localuser", "net user"
    ];

    if high.iter().any(|needle| lower.contains(needle)) {
        return RiskLevel::High;
    }

    let medium = [
        "set-content", "add-content", "new-item", "move-item", "copy-item",
        "rename-item", "start-process", "invoke-webrequest", "curl ",
        "git push", "git commit", "npm install", "winget ", "choco "
    ];

    if medium.iter().any(|needle| lower.contains(needle)) {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    }
}

fn arg_string(arguments: &Value, name: &str) -> Result<String, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Tool argument '{name}' must be a non-empty string."))
}

fn arg_i32(arguments: &Value, name: &str) -> Result<i32, String> {
    arguments
        .get(name)
        .and_then(Value::as_i64)
        .filter(|value| *value >= i32::MIN as i64 && *value <= i32::MAX as i64)
        .map(|value| value as i32)
        .ok_or_else(|| format!("Tool argument '{name}' must be a valid 32-bit integer."))
}

fn arg_u32(arguments: &Value, name: &str) -> Result<u32, String> {
    arguments
        .get(name)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= u32::MAX as u64)
        .map(|value| value as u32)
        .ok_or_else(|| format!("Tool argument '{name}' must be a valid positive integer."))
}

fn arg_raw_string(arguments: &Value, name: &str) -> Result<String, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Tool argument '{name}' must be a string."))
}

fn arg_optional_string(arguments: &Value, name: &str) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn ui_selector(
    arguments: &Value,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let name = arg_optional_string(arguments, "name");
    let automation_id = arg_optional_string(arguments, "automation_id");
    let window = arg_optional_string(arguments, "window");

    if name.is_none() && automation_id.is_none() {
        return Err("UI tools require at least 'name' or 'automation_id'.".into());
    }

    Ok((name, automation_id, window))
}

fn ps_single_quote(value: &str) -> String {
    value.replace("'", "''")
}

fn ui_condition_script(
    name: Option<&str>,
    automation_id: Option<&str>,
) -> Result<String, String> {
    match (name, automation_id) {
        (Some(name), Some(id)) => Ok(format!(
            "$c1 = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{}')\n$c2 = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '{}')\n$condition = [System.Windows.Automation.AndCondition]::new($c1, $c2)",
            ps_single_quote(name),
            ps_single_quote(id)
        )),
        (Some(name), None) => Ok(format!(
            "$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{}')",
            ps_single_quote(name)
        )),
        (None, Some(id)) => Ok(format!(
            "$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '{}')",
            ps_single_quote(id)
        )),
        (None, None) => Err("Missing UI selector.".into()),
    }
}

fn ui_root_script(window: Option<&str>) -> String {
    if let Some(window_name) = window {
        let escaped = ps_single_quote(window_name);
        format!(
            "$desktop = [System.Windows.Automation.AutomationElement]::RootElement\n$windowCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{escaped}')\n$windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)\nif ($windows.Count -eq 0) {{ throw 'Requested top-level window was not found.' }}\nif ($windows.Count -gt 1) {{ throw ('Window selector matched ' + $windows.Count + ' windows. Use a more specific exact window name.') }}\n$root = $windows.Item(0)"
        )
    } else {
        "$root = [System.Windows.Automation.AutomationElement]::RootElement".to_string()
    }
}

fn run_hidden_powershell(script: &str) -> Result<std::process::Output, String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
            .output()
            .map_err(|error| format!("Failed to start PowerShell: {error}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = script;
        Err("Windows UI Automation is currently available on Windows only.".into())
    }
}

fn arg_string_array(arguments: &Value, name: &str) -> Result<Vec<String>, String> {
    let Some(value) = arguments.get(name) else {
        return Ok(Vec::new());
    };

    let items = value
        .as_array()
        .ok_or_else(|| format!("Tool argument '{name}' must be an array of strings."))?;

    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("Tool argument '{name}' must contain only strings."))
        })
        .collect()
}

fn absolute_path(value: String) -> Result<String, String> {
    if !Path::new(&value).is_absolute() {
        return Err("File tools require an absolute path.".into());
    }
    Ok(value)
}

fn safe_web_url(value: String) -> Result<String, String> {
    let lower = value.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Browser tool only accepts http:// or https:// URLs.".into());
    }

    if value.chars().any(|ch| matches!(ch, '\r' | '\n' | '\0')) {
        return Err("URL contains invalid control characters.".into());
    }

    if value.len() > 4096 {
        return Err("URL is too long.".into());
    }

    Ok(value)
}

fn find_premiere_installations() -> Result<Vec<std::path::PathBuf>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(root) = std::env::var_os("ProgramFiles").map(std::path::PathBuf::from) {
            roots.push(root.join("Adobe"));
        }
        if let Some(root) = std::env::var_os("ProgramFiles(x86)").map(std::path::PathBuf::from) {
            roots.push(root.join("Adobe"));
        }

        let mut matches = Vec::new();

        for root in roots {
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };

            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let name = entry.file_name().to_string_lossy().to_string();
                if !name.to_ascii_lowercase().starts_with("adobe premiere pro") {
                    continue;
                }

                let executable = path.join("Adobe Premiere Pro.exe");
                if executable.is_file() {
                    matches.push(executable);
                }
            }
        }

        matches.sort();
        matches.dedup();
        return Ok(matches);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Premiere detection is currently implemented for Windows only.".into())
    }
}

fn find_browser_executable(browser: &str) -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var_os("ProgramFiles").map(std::path::PathBuf::from);
        let program_files_x86 = std::env::var_os("ProgramFiles(x86)").map(std::path::PathBuf::from);
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);

        let mut candidates = Vec::new();

        match browser {
            "edge" => {
                if let Some(root) = &program_files {
                    candidates.push(root.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
                }
                if let Some(root) = &program_files_x86 {
                    candidates.push(root.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
                }
            }
            "chrome" => {
                if let Some(root) = &program_files {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
                if let Some(root) = &program_files_x86 {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
                if let Some(root) = &local_app_data {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
            }
            _ => return Err("browser_start browser must be 'edge' or 'chrome'.".into()),
        }

        return candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| format!("Could not find the {browser} executable on this Windows PC."));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = browser;
        Err("Controlled browser sessions are currently implemented for Windows only.".into())
    }
}

fn browser_session(state: &ActionState, pid: u32) -> Result<BrowserSession, String> {
    state
        .browser_sessions
        .lock()
        .map_err(|_| "Browser-session state is unavailable.".to_string())?
        .get(&pid)
        .cloned()
        .ok_or_else(|| "No Shuvi-managed DevTools browser session exists for that PID.".to_string())
}

fn cdp_command(port: u16, method: &str, params: Value) -> Result<Value, String> {
    let payload = json!({
        "id": 1,
        "method": method,
        "params": params
    })
    .to_string();

    let encoded = BASE64.encode(payload.as_bytes());

    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:{port}/json/list' -TimeoutSec 4
$target = $targets | Where-Object {{ $_.type -eq 'page' -and $_.webSocketDebuggerUrl }} | Select-Object -First 1
if (-not $target) {{ throw 'No debuggable browser page is available.' }}
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}'))
$bytes = [Text.Encoding]::UTF8.GetBytes($message)
$sendSegment = [ArraySegment[byte]]::new($bytes)
$ws.SendAsync($sendSegment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
while ($true) {{
    $buffer = New-Object byte[] 65536
    $builder = New-Object Text.StringBuilder
    do {{
        $recvSegment = [ArraySegment[byte]]::new($buffer)
        $recv = $ws.ReceiveAsync($recvSegment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        if ($recv.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {{
            throw 'DevTools WebSocket closed before a response arrived.'
        }}
        [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $recv.Count))
    }} while (-not $recv.EndOfMessage)
    $text = $builder.ToString()
    $obj = $text | ConvertFrom-Json
    if ($obj.id -eq 1) {{
        $ws.Dispose()
        $text
        break
    }}
}"#
    );

    let output = run_hidden_powershell(&script)?;
    if !output.status.success() {
        return Err(format!(
            "DevTools command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let response: Value = serde_json::from_str(&stdout)
        .map_err(|error| format!("Invalid DevTools response: {error}; response={}", stdout.chars().take(500).collect::<String>()))?;

    if let Some(error) = response.get("error") {
        return Err(format!("DevTools returned an error: {}", error));
    }

    Ok(response)
}

fn cdp_eval(port: u16, expression: String) -> Result<Value, String> {
    let response = cdp_command(
        port,
        "Runtime.evaluate",
        json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
            "userGesture": true
        }),
    )?;

    if let Some(exception) = response.pointer("/result/exceptionDetails") {
        return Err(format!("Browser JavaScript failed: {}", exception));
    }

    Ok(response
        .pointer("/result/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

fn managed_tree_pids(system: &System, roots: &HashSet<u32>) -> HashSet<Pid> {
    let mut included = roots
        .iter()
        .map(|pid| Pid::from_u32(*pid))
        .filter(|pid| system.process(*pid).is_some())
        .collect::<HashSet<_>>();

    loop {
        let before = included.len();

        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                if included.contains(&parent) {
                    included.insert(*pid);
                }
            }
        }

        if included.len() == before {
            break;
        }
    }

    included
}

fn stage_tool(
    proposal: ToolProposal,
    provider_context: Option<ProviderContext>,
    state: &ActionState,
) -> Result<PendingActionView, String> {
    let tool = proposal.tool.clone();

    let (action, summary, detail, risk) = match proposal.tool.as_str() {
        "list_directory" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::ListDirectory { path: path.clone() },
                "List directory".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "read_file" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::ReadFile { path: path.clone() },
                "Read file".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "write_file" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let content = arg_string(&proposal.arguments, "content")?;
            if content.len() > MAX_WRITE_BYTES {
                return Err("File content is larger than Shuvi's 2 MB write limit.".into());
            }
            (
                ToolAction::WriteFile {
                    path: path.clone(),
                    content,
                },
                "Write file".to_string(),
                path,
                RiskLevel::Medium,
            )
        }
        "create_directory" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::CreateDirectory { path: path.clone() },
                "Create directory".to_string(),
                path,
                RiskLevel::Medium,
            )
        }
        "launch_app" => {
            let program = arg_string(&proposal.arguments, "program")?;
            let args = arg_string_array(&proposal.arguments, "args")?;
            (
                ToolAction::LaunchApp {
                    program: program.clone(),
                    args: args.clone(),
                },
                "Launch application".to_string(),
                format!("{program} {}", args.join(" ")).trim().to_string(),
                RiskLevel::Medium,
            )
        }
        "open_url" => {
            let url = safe_web_url(arg_string(&proposal.arguments, "url")?)?;
            (
                ToolAction::OpenUrl { url: url.clone() },
                "Open web page".to_string(),
                url,
                RiskLevel::Medium,
            )
        }
        "browser_start" => {
            let browser = arg_string(&proposal.arguments, "browser")?.to_ascii_lowercase();
            if !matches!(browser.as_str(), "edge" | "chrome") {
                return Err("browser_start browser must be edge or chrome.".into());
            }

            let url = arg_optional_string(&proposal.arguments, "url")
                .map(safe_web_url)
                .transpose()?;

            let detail = format!(
                "Start a Shuvi-managed {} browser session{}",
                browser,
                url.as_deref()
                    .map(|value| format!(" at {value}"))
                    .unwrap_or_default()
            );

            (
                ToolAction::BrowserStart { browser, url },
                "Start managed browser".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "browser_navigate" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let url = safe_web_url(arg_string(&proposal.arguments, "url")?)?;

            (
                ToolAction::BrowserNavigate { pid, url: url.clone() },
                "Navigate managed browser".to_string(),
                format!("Browser PID {pid} -> {url}"),
                RiskLevel::Medium,
            )
        }
        "browser_dom_read" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }

            (
                ToolAction::BrowserDomRead { pid, selector: selector.clone() },
                "Read browser DOM".to_string(),
                format!("Browser PID {pid} | selector={selector}"),
                RiskLevel::Low,
            )
        }
        "browser_dom_click" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }

            (
                ToolAction::BrowserDomClick { pid, selector: selector.clone() },
                "Click browser DOM element".to_string(),
                format!("Browser PID {pid} | selector={selector}"),
                RiskLevel::Medium,
            )
        }
        "browser_dom_set_value" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            let value = arg_raw_string(&proposal.arguments, "value")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }
            if value.len() > 8_000 {
                return Err("Browser value is larger than Shuvi's 8 KB DOM input limit.".into());
            }

            (
                ToolAction::BrowserDomSetValue { pid, selector: selector.clone(), value: value.clone() },
                "Set browser DOM value".to_string(),
                format!("Browser PID {pid} | selector={selector} | value_length={}", value.chars().count()),
                RiskLevel::Medium,
            )
        }
        "stop_managed_process" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;

            (
                ToolAction::StopManagedProcess { pid },
                "Stop Shuvi-managed process".to_string(),
                format!("Stop managed process tree rooted at PID {pid}"),
                RiskLevel::Medium,
            )
        }
        "capture_screen" => (
            ToolAction::CaptureScreen,
            "Capture screen".to_string(),
            "Capture the current virtual desktop to a temporary PNG file.".to_string(),
            RiskLevel::Low,
        ),
        "inspect_screen" => {
            let prompt = arg_string(&proposal.arguments, "prompt")?;
            let provider = provider_context
                .ok_or_else(|| "Screen inspection requires the active provider context.".to_string())?;
            let detail = format!(
                "Capture the current screen and send it to {}/{} for visual analysis: {}",
                provider.provider, provider.model, prompt
            );

            (
                ToolAction::InspectScreen { prompt, provider },
                "Inspect current screen with AI vision".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "list_processes" => (
            ToolAction::ListProcesses,
            "List running processes".to_string(),
            "Read process names, PIDs and memory usage.".to_string(),
            RiskLevel::Low,
        ),
        "ui_find" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Find Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiFind { name, automation_id, window },
                "Find Windows UI element".to_string(),
                detail,
                RiskLevel::Low,
            )
        }
        "ui_click" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Invoke Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiClick { name, automation_id, window },
                "Click Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_set_value" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let value = arg_string(&proposal.arguments, "value")?;
            if value.len() > 20_000 {
                return Err("UI value is too large.".into());
            }
            let detail = format!(
                "Set Windows UI value: window={:?}, name={:?}, automation_id={:?}, value_length={}",
                window,
                name,
                automation_id,
                value.chars().count()
            );
            (
                ToolAction::UiSetValue { name, automation_id, window, value },
                "Set Windows UI text/value".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_focus" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Focus Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiFocus { name, automation_id, window },
                "Focus Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_scroll" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let vertical = arg_string(&proposal.arguments, "vertical")?.to_ascii_lowercase();
            if !matches!(
                vertical.as_str(),
                "small_increment" | "small_decrement" | "large_increment" | "large_decrement"
            ) {
                return Err("ui_scroll vertical must be small_increment, small_decrement, large_increment, or large_decrement.".into());
            }

            let detail = format!(
                "Scroll Windows UI element: window={:?}, name={:?}, automation_id={:?}, vertical={}",
                window, name, automation_id, vertical
            );
            (
                ToolAction::UiScroll { name, automation_id, window, vertical },
                "Scroll Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_toggle" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Toggle Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );

            (
                ToolAction::UiToggle { name, automation_id, window },
                "Toggle Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_expand_collapse" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let action = arg_string(&proposal.arguments, "action")?.to_ascii_lowercase();

            if !matches!(action.as_str(), "expand" | "collapse") {
                return Err("ui_expand_collapse action must be expand or collapse.".into());
            }

            let detail = format!(
                "{} Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                action, window, name, automation_id
            );

            (
                ToolAction::UiExpandCollapse { name, automation_id, window, action },
                "Expand/collapse Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_send_keys" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let keys = arg_raw_string(&proposal.arguments, "keys")?;

            if keys.is_empty() || keys.len() > 2_000 {
                return Err("ui_send_keys requires between 1 and 2000 characters.".into());
            }

            let detail = format!(
                "Send keyboard fallback to Windows UI element: window={:?}, name={:?}, automation_id={:?}, keys_length={}",
                window, name, automation_id, keys.chars().count()
            );

            (
                ToolAction::UiSendKeys { name, automation_id, window, keys },
                "Send keyboard fallback".to_string(),
                detail,
                RiskLevel::High,
            )
        }
        "pointer_click" => {
            let x = arg_i32(&proposal.arguments, "x")?;
            let y = arg_i32(&proposal.arguments, "y")?;
            let button = arg_string(&proposal.arguments, "button")?.to_ascii_lowercase();
            let clicks = proposal
                .arguments
                .get("clicks")
                .and_then(Value::as_u64)
                .unwrap_or(1);

            if !matches!(button.as_str(), "left" | "right" | "middle") {
                return Err("pointer_click button must be left, right, or middle.".into());
            }
            if !(1..=2).contains(&clicks) {
                return Err("pointer_click clicks must be 1 or 2.".into());
            }

            (
                ToolAction::PointerClick {
                    x,
                    y,
                    button: button.clone(),
                    clicks: clicks as u32,
                },
                "Coordinate pointer click".to_string(),
                format!("{button} click x={x}, y={y}, clicks={clicks}"),
                RiskLevel::High,
            )
        }
        "premiere_detect" => (
            ToolAction::PremiereDetect,
            "Detect Adobe Premiere Pro".to_string(),
            "Inspect installed Adobe Premiere Pro versions and executable paths.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_launch" => {
            let project = arg_optional_string(&proposal.arguments, "project")
                .map(absolute_path)
                .transpose()?;

            if let Some(path) = &project {
                let extension = Path::new(path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();

                if extension != "prproj" {
                    return Err("premiere_launch project must be an absolute .prproj file path.".into());
                }
                if !Path::new(path).is_file() {
                    return Err("Premiere project file does not exist.".into());
                }
            }

            (
                ToolAction::PremiereLaunch { project: project.clone() },
                "Launch Adobe Premiere Pro".to_string(),
                project
                    .as_deref()
                    .map(|path| format!("Launch Premiere with project {path}"))
                    .unwrap_or_else(|| "Launch the newest detected Premiere installation.".to_string()),
                RiskLevel::Medium,
            )
        }
        "premiere_bridge_start" => (
            ToolAction::PremiereBridgeStart,
            "Start Premiere bridge".to_string(),
            "Start Shuvi's authenticated localhost bridge for the Premiere UXP panel.".to_string(),
            RiskLevel::Medium,
        ),
        "premiere_bridge_status" => (
            ToolAction::PremiereBridgeStatus,
            "Read Premiere bridge status".to_string(),
            "Check whether the Premiere UXP bridge is enabled and paired.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_context" => (
            ToolAction::PremiereContext,
            "Inspect Premiere project context".to_string(),
            "Read the active Premiere project, active sequence and basic timeline metadata through the paired UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_timeline" => (
            ToolAction::PremiereTimeline,
            "Inspect Premiere timeline".to_string(),
            "Read active sequence tracks and clip metadata through the paired Premiere UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_set_playhead" => {
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_set_playhead requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere playhead seconds must be finite and between 0 and 86400.".into());
            }

            (
                ToolAction::PremiereSetPlayhead { seconds },
                "Move Premiere playhead".to_string(),
                format!("Move active sequence playhead to {seconds:.3}s."),
                RiskLevel::Low,
            )
        }
        "premiere_set_track_mute" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_set_track_mute kind must be video or audio.".into());
            }
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 {
                return Err("Premiere track index is outside Shuvi's safety limit.".into());
            }
            let muted = proposal.arguments
                .get("muted")
                .and_then(Value::as_bool)
                .ok_or_else(|| "premiere_set_track_mute requires muted=true|false.".to_string())?;

            (
                ToolAction::PremiereSetTrackMute { kind: kind.clone(), track: track as u32, muted },
                if muted { "Mute Premiere track".to_string() } else { "Unmute Premiere track".to_string() },
                format!("Set {kind} track {track} muted={muted}."),
                RiskLevel::Medium,
            )
        }
        "premiere_list_items" => (
            ToolAction::PremiereListItems,
            "List Premiere root project items".to_string(),
            "Read top-level project items from the active Premiere project through the paired UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_create_bin" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere bin name is too long.".into());
            }

            (
                ToolAction::PremiereCreateBin { name: name.clone() },
                "Create Premiere bin".to_string(),
                format!("Create project bin '{name}' in the active Premiere project root."),
                RiskLevel::Medium,
            )
        }
        "premiere_import_media" => {
            let paths = arg_string_array(&proposal.arguments, "paths")?;
            if paths.is_empty() {
                return Err("premiere_import_media requires at least one media path.".into());
            }
            if paths.len() > 100 {
                return Err("Premiere import is limited to 100 files per action.".into());
            }

            let mut validated = Vec::with_capacity(paths.len());
            for path in paths {
                let absolute = absolute_path(path)?;
                if !Path::new(&absolute).is_file() {
                    return Err(format!("Premiere media file does not exist: {absolute}"));
                }
                validated.push(absolute);
            }

            (
                ToolAction::PremiereImportMedia { paths: validated.clone() },
                "Import media into Premiere".to_string(),
                format!("Import {} media file(s) into the active Premiere project root.", validated.len()),
                RiskLevel::Medium,
            )
        }
        "premiere_create_sequence_from_media" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere sequence name is too long.".into());
            }

            let paths = arg_string_array(&proposal.arguments, "paths")?;
            if paths.is_empty() {
                return Err("premiere_create_sequence_from_media requires at least one media path.".into());
            }
            if paths.len() > 50 {
                return Err("Sequence creation is limited to 50 media files per action.".into());
            }

            let mut validated = Vec::with_capacity(paths.len());
            for path in paths {
                let absolute = absolute_path(path)?;
                if !Path::new(&absolute).is_file() {
                    return Err(format!("Premiere media file does not exist: {absolute}"));
                }
                validated.push(absolute);
            }

            (
                ToolAction::PremiereCreateSequenceFromMedia {
                    name: name.clone(),
                    paths: validated.clone(),
                },
                "Create Premiere sequence from media".to_string(),
                format!(
                    "Create sequence '{}' from {} media file(s) in the active Premiere project.",
                    name,
                    validated.len()
                ),
                RiskLevel::Medium,
            )
        }
        "premiere_insert_media" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            if !Path::new(&path).is_file() {
                return Err("Premiere media file does not exist.".into());
            }
            let seconds = proposal.arguments.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            if !seconds.is_finite() || seconds < 0.0 {
                return Err("premiere_insert_media seconds must be zero or greater.".into());
            }
            let video_track = proposal.arguments.get("video_track").and_then(Value::as_u64).unwrap_or(0);
            let audio_track = proposal.arguments.get("audio_track").and_then(Value::as_u64).unwrap_or(0);
            if video_track > 128 || audio_track > 128 {
                return Err("Premiere track index is outside Shuvi's safety limit.".into());
            }
            let mode = arg_string(&proposal.arguments, "mode")?.to_ascii_lowercase();
            if !matches!(mode.as_str(), "insert" | "overwrite") {
                return Err("premiere_insert_media mode must be insert or overwrite.".into());
            }
            (
                ToolAction::PremiereInsertMedia {
                    path: path.clone(),
                    seconds,
                    video_track: video_track as u32,
                    audio_track: audio_track as u32,
                    mode: mode.clone(),
                },
                "Edit Premiere timeline".to_string(),
                format!("{mode} media at {seconds:.3}s on V{video_track}/A{audio_track}: {path}"),
                RiskLevel::High,
            )
        }
        "premiere_trim_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_trim_clip kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere trim target is outside Shuvi's safety limits.".into());
            }

            let start_seconds = proposal.arguments.get("start_seconds").and_then(Value::as_f64);
            let end_seconds = proposal.arguments.get("end_seconds").and_then(Value::as_f64);

            if start_seconds.is_none() && end_seconds.is_none() {
                return Err("premiere_trim_clip requires start_seconds and/or end_seconds.".into());
            }
            for value in [start_seconds, end_seconds].into_iter().flatten() {
                if !value.is_finite() || value < 0.0 {
                    return Err("Premiere trim times must be finite and zero or greater.".into());
                }
            }
            if let (Some(start), Some(end)) = (start_seconds, end_seconds) {
                if start >= end {
                    return Err("Premiere trim start_seconds must be earlier than end_seconds.".into());
                }
            }

            (
                ToolAction::PremiereTrimClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    start_seconds,
                    end_seconds,
                },
                "Trim Premiere clip".to_string(),
                format!(
                    "Trim {kind} track {track}, clip #{clip_index}, start={start_seconds:?}, end={end_seconds:?}"
                ),
                RiskLevel::High,
            )
        }
        "premiere_move_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_move_clip kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere move target is outside Shuvi's safety limits.".into());
            }

            let delta_seconds = proposal.arguments
                .get("delta_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_move_clip requires delta_seconds.".to_string())?;

            if !delta_seconds.is_finite() || delta_seconds.abs() > 36_000.0 || delta_seconds == 0.0 {
                return Err("premiere_move_clip delta_seconds must be finite, non-zero and within ±10 hours.".into());
            }

            (
                ToolAction::PremiereMoveClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    delta_seconds,
                },
                "Move Premiere clip".to_string(),
                format!("Move {kind} track {track}, clip #{clip_index} by {delta_seconds:.3}s"),
                RiskLevel::High,
            )
        }
        "premiere_delete_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_delete_clip kind must be video or audio.".into());
            }
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere delete target is outside Shuvi's safety limits.".into());
            }
            let ripple = proposal.arguments.get("ripple").and_then(Value::as_bool).unwrap_or(false);

            (
                ToolAction::PremiereDeleteClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    ripple,
                },
                if ripple { "Ripple-delete Premiere clip".to_string() } else { "Delete Premiere clip".to_string() },
                format!("Delete {kind} track {track}, clip #{clip_index}, ripple={ripple}"),
                RiskLevel::High,
            )
        }
        "premiere_set_track_mute" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_set_track_mute kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 {
                return Err("Premiere track index is outside Shuvi's safety limit.".into());
            }

            let muted = proposal.arguments
                .get("muted")
                .and_then(Value::as_bool)
                .ok_or_else(|| "premiere_set_track_mute requires a boolean muted value.".to_string())?;

            (
                ToolAction::PremiereSetTrackMute {
                    kind: kind.clone(),
                    track: track as u32,
                    muted,
                },
                if muted { "Mute Premiere track".to_string() } else { "Unmute Premiere track".to_string() },
                format!("Set {kind} track {track} muted={muted}"),
                RiskLevel::Medium,
            )
        }
        "premiere_export_sequence" => {
            let output = absolute_path(arg_string(&proposal.arguments, "output")?)?;
            let output_parent = Path::new(&output)
                .parent()
                .ok_or_else(|| "Premiere export output path has no parent directory.".to_string())?;
            if !output_parent.is_dir() {
                return Err("Premiere export output parent directory does not exist.".into());
            }

            let preset = arg_optional_string(&proposal.arguments, "preset")
                .map(absolute_path)
                .transpose()?;

            if let Some(path) = &preset {
                if !Path::new(path).is_file() {
                    return Err("Premiere export preset file does not exist.".into());
                }
            }

            let queue_to_ame = proposal.arguments
                .get("queue_to_ame")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            (
                ToolAction::PremiereExportSequence {
                    output: output.clone(),
                    preset: preset.clone(),
                    queue_to_ame,
                },
                if queue_to_ame {
                    "Queue Premiere export to Media Encoder".to_string()
                } else {
                    "Export active Premiere sequence".to_string()
                },
                format!(
                    "Export active sequence to {output}; preset={preset:?}; queue_to_ame={queue_to_ame}"
                ),
                RiskLevel::High,
            )
        }
        "premiere_save_project" => (
            ToolAction::PremiereSaveProject,
            "Save active Premiere project".to_string(),
            "Save the currently active Premiere project through the paired UXP bridge.".to_string(),
            RiskLevel::Medium,
        ),
        "workspace_scan" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::WorkspaceScan { path: path.clone() },
                "Scan coding workspace".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "search_text" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let query = arg_string(&proposal.arguments, "query")?;
            if query.len() > 2_000 {
                return Err("Search query is too long.".into());
            }
            (
                ToolAction::SearchText { path: path.clone(), query: query.clone() },
                "Search workspace text".to_string(),
                format!("{} | query={}", path, query),
                RiskLevel::Low,
            )
        }
        "replace_text" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let old = arg_raw_string(&proposal.arguments, "old")?;
            let new_value = arg_raw_string(&proposal.arguments, "new")?;

            if old.is_empty() {
                return Err("replace_text requires non-empty old text.".into());
            }
            if old.len() > MAX_WRITE_BYTES || new_value.len() > MAX_WRITE_BYTES {
                return Err("Replacement payload is too large.".into());
            }

            (
                ToolAction::ReplaceText {
                    path: path.clone(),
                    old: old.clone(),
                    new_value: new_value.clone(),
                },
                "Replace exact text in file".to_string(),
                format!(
                    "{} | old_chars={} | new_chars={}",
                    path,
                    old.chars().count(),
                    new_value.chars().count()
                ),
                RiskLevel::Medium,
            )
        }
        "apply_patch" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let patch = arg_raw_string(&proposal.arguments, "patch")?;
            if patch.trim().is_empty() {
                return Err("apply_patch requires a non-empty unified diff.".into());
            }
            if patch.len() > 512_000 {
                return Err("Patch is larger than Shuvi's 512 KB patch limit.".into());
            }

            (
                ToolAction::ApplyPatch {
                    path: path.clone(),
                    patch: patch.clone(),
                },
                "Apply structured Git patch".to_string(),
                format!("{} | patch_chars={}", path, patch.chars().count()),
                RiskLevel::Medium,
            )
        }
        "run_project_task" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let task = arg_string(&proposal.arguments, "task")?.to_ascii_lowercase();

            if !matches!(task.as_str(), "test" | "build" | "lint" | "typecheck") {
                return Err("Project task must be test, build, lint, or typecheck.".into());
            }

            (
                ToolAction::RunProjectTask {
                    path: path.clone(),
                    task: task.clone(),
                },
                "Run project task".to_string(),
                format!("{path} | task={task}"),
                RiskLevel::Medium,
            )
        }
        "git_status" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::GitStatus { path: path.clone() },
                "Read Git status".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "git_diff" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::GitDiff { path: path.clone() },
                "Read Git diff".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "git_commit" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let message = arg_string(&proposal.arguments, "message")?;
            if message.len() > 500 {
                return Err("Git commit message is too long.".into());
            }

            (
                ToolAction::GitCommit {
                    path: path.clone(),
                    message: message.clone(),
                },
                "Stage and commit Git changes".to_string(),
                format!("{path} | message={message}"),
                RiskLevel::Medium,
            )
        }
        "git_push" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::GitPush { path: path.clone() },
                "Push Git commits to remote".to_string(),
                path,
                RiskLevel::High,
            )
        }
        "powershell" => {
            let command = arg_string(&proposal.arguments, "command")?;
            if command.len() > 8_000 {
                return Err("PowerShell command is too long.".into());
            }
            let risk = classify_powershell(&command);
            (
                ToolAction::PowerShell {
                    command: command.clone(),
                },
                "Run PowerShell".to_string(),
                command,
                risk,
            )
        }
        _ => return Err("Unsupported tool.".into()),
    };

    let id = Uuid::new_v4().to_string();

    state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .insert(
            id.clone(),
            PendingAction {
                tool: tool.clone(),
                detail: detail.clone(),
                action,
            },
        );

    Ok(PendingActionView {
        id,
        kind: tool,
        summary,
        detail,
        risk,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn audit_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("audit.jsonl"))
}

fn append_audit(app: &AppHandle, entry: &AuditEntry) -> Result<(), String> {
    let path = audit_path(app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open audit log: {error}"))?;

    let line = serde_json::to_string(entry)
        .map_err(|error| format!("Could not encode audit entry: {error}"))?;

    writeln!(file, "{line}")
        .map_err(|error| format!("Could not write audit log: {error}"))
}

fn read_audit(app: &AppHandle, limit: usize) -> Result<Vec<AuditEntry>, String> {
    let path = audit_path(app)?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|error| format!("Could not open audit log: {error}"))?;

    let mut entries = BufReader::new(file)
        .lines()
        .filter_map(Result::ok)
        .filter_map(|line| serde_json::from_str::<AuditEntry>(&line).ok())
        .collect::<Vec<_>>();

    entries.reverse();
    entries.truncate(limit.clamp(1, 200));
    Ok(entries)
}

fn capture_screen_png() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let dir = std::env::temp_dir().join("Shuvi").join("screenshots");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Could not create screenshot folder: {error}"))?;

        let path = dir.join(format!("screen-{}.png", now_ms()));
        let ps_path = path.to_string_lossy().replace("'", "''");

        let script = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
$bitmap.Save('{ps_path}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()"#
        );

        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .output()
            .map_err(|error| format!("Could not capture screen: {error}"))?;

        if !output.status.success() || !path.exists() {
            return Err(format!(
                "Screen capture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        return Ok(path);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Screen capture is currently implemented for Windows only.".into())
    }
}

async fn analyze_png_with_provider(
    context: &ProviderContext,
    prompt: &str,
    path: &Path,
) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read captured screenshot: {error}"))?;

    if bytes.len() > 12 * 1024 * 1024 {
        return Err("Screenshot is larger than Shuvi's 12 MB vision limit.".into());
    }

    let encoded = BASE64.encode(bytes);
    let key = load_api_key(&context.provider)?;

    match context.provider.as_str() {
        "gemini" => {
            let api_key = key
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "No Gemini API key saved.".to_string())?;

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                context.model, api_key
            );

            let response = http_client()?
                .post(url)
                .json(&json!({
                    "contents": [{
                        "role": "user",
                        "parts": [
                            { "text": prompt },
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": encoded
                                }
                            }
                        ]
                    }]
                }))
                .send()
                .await
                .map_err(|error| format!("Gemini vision request failed: {error}"))?;

            let status = response.status();
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Invalid Gemini vision response: {error}"))?;

            if !status.is_success() {
                return Err(format!("Gemini vision returned {status}: {}", compact_error(&body)));
            }

            let parts = body
                .pointer("/candidates/0/content/parts")
                .and_then(Value::as_array)
                .ok_or_else(|| "Gemini vision returned no candidate text.".to_string())?;

            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() {
                return Err("Gemini vision returned an empty response.".into());
            }

            Ok(text)
        }
        "anthropic" => {
            let api_key = key
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "No Anthropic API key saved.".to_string())?;

            let response = http_client()?
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": context.model,
                    "max_tokens": 1600,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": encoded
                                }
                            },
                            { "type": "text", "text": prompt }
                        ]
                    }]
                }))
                .send()
                .await
                .map_err(|error| format!("Anthropic vision request failed: {error}"))?;

            let status = response.status();
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Invalid Anthropic vision response: {error}"))?;

            if !status.is_success() {
                return Err(format!("Anthropic vision returned {status}: {}", compact_error(&body)));
            }

            let text = body
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|part| {
                    if part.get("type").and_then(Value::as_str) == Some("text") {
                        part.get("text").and_then(Value::as_str)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() {
                return Err("Anthropic vision returned an empty response.".into());
            }

            Ok(text)
        }
        "deepseek" => Err(
            "The selected DeepSeek text endpoint is not configured for screen vision. Choose Gemini, OpenAI, Claude, OpenRouter, Ollama vision, or a compatible vision endpoint.".into()
        ),
        "openai" | "openrouter" | "ollama" | "custom" => {
            let url = match context.provider.as_str() {
                "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
                "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
                "ollama" => context
                    .base_url
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".into()),
                "custom" => context
                    .base_url
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Custom vision provider requires a base URL.".to_string())?,
                _ => unreachable!(),
            };

            let mut request = http_client()?.post(url).json(&json!({
                "model": context.model,
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": prompt },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:image/png;base64,{encoded}")
                            }
                        }
                    ]
                }]
            }));

            if let Some(api_key) = key.filter(|value| !value.is_empty()) {
                request = request.bearer_auth(api_key);
            } else if context.provider != "ollama" {
                return Err("No API key saved for the selected vision provider.".into());
            }

            let response = request
                .send()
                .await
                .map_err(|error| format!("Vision request failed: {error}"))?;

            let status = response.status();
            let body: Value = response
                .json()
                .await
                .map_err(|error| format!("Invalid vision response: {error}"))?;

            if !status.is_success() {
                return Err(format!("Vision provider returned {status}: {}", compact_error(&body)));
            }

            let text = body
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .ok_or_else(|| "Vision provider returned no assistant text.".to_string())?;

            Ok(text.to_string())
        }
        other => Err(format!("Provider '{other}' is not supported for screen vision.")),
    }
}

fn is_ignored_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache" | ".venv" | "venv"
    )
}

fn workspace_scan_recursive(
    root: &Path,
    current: &Path,
    depth: usize,
    output: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 5 || output.len() >= 1200 {
        return Ok(());
    }

    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Could not scan workspace: {error}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if output.len() >= 1200 {
            break;
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let relative = path.strip_prefix(root).unwrap_or(&path).display().to_string();

        if path.is_dir() {
            if is_ignored_workspace_dir(&file_name) {
                continue;
            }
            output.push(format!("[dir] {relative}"));
            workspace_scan_recursive(root, &path, depth + 1, output)?;
        } else if path.is_file() {
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or_default();
            output.push(format!("[file] {relative} | {size} bytes"));
        }
    }

    Ok(())
}

fn search_text_recursive(
    root: &Path,
    current: &Path,
    query: &str,
    depth: usize,
    matches: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 7 || matches.len() >= 150 {
        return Ok(());
    }

    for entry in fs::read_dir(current)
        .map_err(|error| format!("Could not search workspace: {error}"))?
        .filter_map(Result::ok)
    {
        if matches.len() >= 150 {
            break;
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if is_ignored_workspace_dir(&file_name) {
                continue;
            }
            search_text_recursive(root, &path, query, depth + 1, matches)?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.len() > 768 * 1024 {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };

        for (index, line) in content.lines().enumerate() {
            if line.contains(query) {
                let relative = path.strip_prefix(root).unwrap_or(&path).display();
                matches.push(format!(
                    "{}:{}: {}",
                    relative,
                    index + 1,
                    line.chars().take(300).collect::<String>()
                ));

                if matches.len() >= 150 {
                    break;
                }
            }
        }
    }

    Ok(())
}

fn run_git(path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    if !Path::new(path).join(".git").exists() {
        return Err("The selected path does not contain a .git repository.".into());
    }

    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn run_git_with_stdin(
    path: &str,
    args: &[&str],
    input: &str,
) -> Result<std::process::Output, String> {
    if !Path::new(path).join(".git").exists() {
        return Err("The selected path does not contain a .git repository.".into());
    }

    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run Git: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| format!("Could not send patch to Git: {error}"))?;
    }

    child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for Git: {error}"))
}

fn project_task_command(path: &str, task: &str) -> Result<(String, Vec<String>), String> {
    let root = Path::new(path);

    if !root.is_dir() {
        return Err("Project path is not a directory.".into());
    }

    if root.join("package.json").exists() {
        let package_json = fs::read_to_string(root.join("package.json"))
            .map_err(|error| format!("Could not read package.json: {error}"))?;
        let package: Value = serde_json::from_str(&package_json)
            .map_err(|error| format!("Invalid package.json: {error}"))?;

        let scripts = package
            .get("scripts")
            .and_then(Value::as_object)
            .ok_or_else(|| "package.json has no scripts object.".to_string())?;

        let script_name = match task {
            "test" => "test",
            "build" => "build",
            "lint" => "lint",
            "typecheck" => {
                if scripts.contains_key("typecheck") {
                    "typecheck"
                } else if scripts.contains_key("type-check") {
                    "type-check"
                } else {
                    return Err("No typecheck/type-check script is defined in package.json.".into());
                }
            }
            _ => return Err("Unsupported project task.".into()),
        };

        if !scripts.contains_key(script_name) {
            return Err(format!("package.json does not define the '{script_name}' script."));
        }

        let manager = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if root.join("yarn.lock").exists() {
            "yarn"
        } else {
            "npm"
        };

        #[cfg(target_os = "windows")]
        let program = format!("{manager}.cmd");

        #[cfg(not(target_os = "windows"))]
        let program = manager.to_string();

        let args = if manager == "yarn" {
            vec![script_name.to_string()]
        } else {
            vec!["run".into(), script_name.to_string()]
        };

        return Ok((program, args));
    }

    if root.join("Cargo.toml").exists() {
        let args = match task {
            "test" => vec!["test".into()],
            "build" => vec!["build".into()],
            "lint" => vec!["clippy".into(), "--all-targets".into()],
            "typecheck" => vec!["check".into()],
            _ => return Err("Unsupported Rust project task.".into()),
        };

        return Ok(("cargo".into(), args));
    }

    Err("Shuvi currently supports typed project tasks for Node.js and Rust projects.".into())
}

fn session_checkpoint_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("session-checkpoint.json"))
}

fn write_session_checkpoint(
    app: &AppHandle,
    mut checkpoint: SessionCheckpoint,
) -> Result<(), String> {
    if checkpoint.messages.len() > 120 {
        let keep_from = checkpoint.messages.len().saturating_sub(120);
        checkpoint.messages = checkpoint.messages.split_off(keep_from);
    }

    checkpoint.version = 1;
    checkpoint.updated_at_ms = now_ms();

    let content = serde_json::to_vec_pretty(&checkpoint)
        .map_err(|error| format!("Could not encode session checkpoint: {error}"))?;

    if content.len() > 2 * 1024 * 1024 {
        return Err("Session checkpoint is larger than Shuvi's 2 MB safety limit.".into());
    }

    let path = session_checkpoint_path(app)?;
    let temp = path.with_extension("json.tmp");

    fs::write(&temp, &content)
        .map_err(|error| format!("Could not write temporary session checkpoint: {error}"))?;

    if path.exists() {
        let _ = fs::remove_file(&path);
    }

    fs::rename(&temp, &path)
        .map_err(|error| format!("Could not finalize session checkpoint: {error}"))
}

fn read_session_checkpoint(app: &AppHandle) -> Result<Option<SessionCheckpoint>, String> {
    let path = session_checkpoint_path(app)?;

    if !path.exists() {
        return Ok(None);
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect session checkpoint: {error}"))?;

    if metadata.len() > 2 * 1024 * 1024 {
        return Err("Saved session checkpoint is unexpectedly large.".into());
    }

    let content = fs::read(&path)
        .map_err(|error| format!("Could not read session checkpoint: {error}"))?;

    let checkpoint: SessionCheckpoint = serde_json::from_slice(&content)
        .map_err(|error| format!("Saved session checkpoint is invalid: {error}"))?;

    if checkpoint.version != 1 {
        return Err("Saved session checkpoint uses an unsupported version.".into());
    }

    Ok(Some(checkpoint))
}

fn remove_session_checkpoint(app: &AppHandle) -> Result<(), String> {
    let path = session_checkpoint_path(app)?;

    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not clear session checkpoint: {error}"))?;
    }

    Ok(())
}

fn workspace_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("workspace.txt"))
}

fn read_workspace(app: &AppHandle) -> Result<Option<String>, String> {
    let path = workspace_config_path(app)?;

    if !path.exists() {
        return Ok(None);
    }

    let value = fs::read_to_string(path)
        .map_err(|error| format!("Could not read workspace setting: {error}"))?
        .trim()
        .to_string();

    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

fn write_workspace(app: &AppHandle, path: &str) -> Result<(), String> {
    let absolute = Path::new(path);

    if !absolute.is_absolute() || !absolute.is_dir() {
        return Err("Workspace must be an existing absolute directory.".into());
    }

    fs::write(workspace_config_path(app)?, path.as_bytes())
        .map_err(|error| format!("Could not save workspace setting: {error}"))
}

async fn backup_premiere_project(state: &ActionState) -> Result<Option<String>, String> {
    state
        .premiere_bridge
        .request("save_project", json!({}), Duration::from_secs(15))
        .await?;

    let context = state
        .premiere_bridge
        .request("inspect_context", json!({}), Duration::from_secs(8))
        .await?;

    let Some(project_path) = context
        .get("projectPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let source = Path::new(project_path);
    if !source.is_file() {
        return Ok(None);
    }

    let parent = source
        .parent()
        .ok_or_else(|| "Premiere project path has no parent directory.".to_string())?;
    let backup_dir = parent.join("Shuvi Backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Could not create Premiere backup directory: {error}"))?;

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("PremiereProject");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("prproj");

    let backup_path = backup_dir.join(format!(
        "{}.shuvi-{}.{}",
        stem,
        now_ms(),
        extension
    ));

    fs::copy(source, &backup_path)
        .map_err(|error| format!("Could not back up Premiere project: {error}"))?;

    Ok(Some(backup_path.display().to_string()))
}

fn truncate_output(value: String) -> String {
    if value.chars().count() <= MAX_TOOL_OUTPUT_CHARS {
        return value;
    }

    let shortened = value.chars().take(MAX_TOOL_OUTPUT_CHARS).collect::<String>();
    format!("{shortened}\n[output truncated by Shuvi]")
}

async fn execute_tool(action: PendingAction, state: &ActionState) -> Result<ActionResult, String> {
    let tool = action.tool.clone();

    match action.action {
        ToolAction::ListDirectory { path } => {
            let mut entries = Vec::new();

            for entry in fs::read_dir(&path).map_err(|error| format!("Could not list directory: {error}"))? {
                let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
                let file_type = entry.file_type().map_err(|error| format!("Could not inspect entry: {error}"))?;
                let kind = if file_type.is_dir() {
                    "dir"
                } else if file_type.is_file() {
                    "file"
                } else {
                    "other"
                };

                entries.push(format!("[{kind}] {}", entry.file_name().to_string_lossy()));

                if entries.len() >= 500 {
                    entries.push("[truncated at 500 entries]".into());
                    break;
                }
            }

            entries.sort();

            Ok(ActionResult {
                success: true,
                tool,
                stdout: entries.join("\n"),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ReadFile { path } => {
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("Could not inspect file: {error}"))?;

            if metadata.len() > MAX_READ_BYTES {
                return Err("File is larger than Shuvi's 1 MB direct-read limit.".into());
            }

            let content = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read UTF-8 text file: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(content),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::WriteFile { path, content } => {
            fs::write(&path, content.as_bytes())
                .map_err(|error| format!("Could not write file: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Wrote {} bytes to {path}.", content.len()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::CreateDirectory { path } => {
            fs::create_dir_all(&path)
                .map_err(|error| format!("Could not create directory: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Created directory {path}."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::LaunchApp { program, args } => {
            let child = Command::new(&program)
                .args(&args)
                .spawn()
                .map_err(|error| format!("Could not launch application: {error}"))?;

            let child_pid = child.id();
            state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .insert(child_pid);

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Launched {program} with PID {child_pid}. Shuvi is now tracking its RAM usage."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::OpenUrl { url } => {
            #[cfg(target_os = "windows")]
            let child = Command::new("explorer.exe")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            #[cfg(target_os = "macos")]
            let child = Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            let child = Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Opened {url} using the system browser (launcher PID {}).", child.id()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserStart { browser, url } => {
            let executable = find_browser_executable(&browser)?;
            let profile_dir = std::env::temp_dir()
                .join("Shuvi")
                .join("browser-profiles")
                .join(format!("{}-{}", browser, now_ms()));

            fs::create_dir_all(&profile_dir)
                .map_err(|error| format!("Could not create managed browser profile: {error}"))?;

            let devtools_file = profile_dir.join("DevToolsActivePort");

            let mut command = Command::new(&executable);
            command
                .arg("--new-window")
                .arg("--no-first-run")
                .arg("--no-default-browser-check")
                .arg("--disable-background-mode")
                .arg("--remote-debugging-address=127.0.0.1")
                .arg("--remote-debugging-port=0")
                .arg(format!("--user-data-dir={}", profile_dir.display()));

            if let Some(url) = &url {
                command.arg(url);
            }

            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start managed browser: {error}"))?;

            let child_pid = child.id();
            let mut devtools_port = None;

            for _ in 0..50 {
                if let Ok(value) = fs::read_to_string(&devtools_file) {
                    if let Some(first_line) = value.lines().next() {
                        if let Ok(port) = first_line.trim().parse::<u16>() {
                            devtools_port = Some(port);
                            break;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            let Some(port) = devtools_port else {
                let _ = child.kill();
                let _ = fs::remove_dir_all(&profile_dir);
                return Err("Managed browser started, but its local DevTools endpoint did not become ready within 5 seconds.".into());
            };

            state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .insert(child_pid);

            state
                .browser_sessions
                .lock()
                .map_err(|_| "Browser-session state is unavailable.".to_string())?
                .insert(
                    child_pid,
                    BrowserSession {
                        port,
                        profile_dir: profile_dir.clone(),
                    },
                );

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Started Shuvi-managed {browser} with root PID {child_pid} and local DevTools port {port}. Use this PID for browser DOM tools. Browser subprocesses are included in Shuvi's RAM accounting."
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserNavigate { pid, url } => {
            let session = browser_session(state, pid)?;
            let response = cdp_command(
                session.port,
                "Page.navigate",
                json!({ "url": url }),
            )?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Navigated browser PID {pid}. DevTools response: {}",
                    truncate_output(response.to_string())
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomRead { pid, selector } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 25);
  return nodes.map((el, index) => ({{
    index,
    tag: el.tagName,
    id: el.id || null,
    name: el.getAttribute('name'),
    role: el.getAttribute('role'),
    type: el.getAttribute('type'),
    text: String(el.innerText || el.textContent || '').trim().slice(0, 500),
    value: ('value' in el) ? String(el.value).slice(0, 500) : null,
    href: el.href || null,
    disabled: !!el.disabled
  }}));
}})()"#
            );

            let value = cdp_eval(session.port, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomClick { pid, selector } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length === 0) throw new Error('No DOM element matched the selector.');
  if (nodes.length > 1) throw new Error('Selector matched ' + nodes.length + ' elements. Refine it before clicking.');
  const el = nodes[0];
  if (el.disabled) throw new Error('Matching DOM element is disabled.');
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  el.click();
  return {{
    clicked: true,
    tag: el.tagName,
    id: el.id || null,
    text: String(el.innerText || el.textContent || '').trim().slice(0, 300)
  }};
}})()"#
            );

            let value = cdp_eval(session.port, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomSetValue { pid, selector, value } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;
            let value_json = serde_json::to_string(&value)
                .map_err(|error| format!("Could not encode DOM value: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const newValue = {value_json};
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length === 0) throw new Error('No DOM element matched the selector.');
  if (nodes.length > 1) throw new Error('Selector matched ' + nodes.length + ' elements. Refine it before writing.');
  const el = nodes[0];
  if (el.disabled) throw new Error('Matching DOM element is disabled.');
  el.focus();

  if ('value' in el) {{
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, newValue);
    else el.value = newValue;
  }} else if (el.isContentEditable) {{
    el.textContent = newValue;
  }} else {{
    throw new Error('Matching DOM element is not value-editable.');
  }}

  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));

  return {{
    changed: true,
    tag: el.tagName,
    id: el.id || null,
    valueLength: newValue.length
  }};
}})()"#
            );

            let result = cdp_eval(session.port, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::StopManagedProcess { pid } => {
            let is_managed_root = state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .contains(&pid);

            if !is_managed_root {
                return Err("Shuvi can only stop process roots that it launched and is tracking.".into());
            }

            let pid_string = pid.to_string();

            #[cfg(target_os = "windows")]
            let output = Command::new("taskkill")
                .args(["/PID", pid_string.as_str(), "/T", "/F"])
                .output()
                .map_err(|error| format!("Could not stop managed process: {error}"))?;

            #[cfg(not(target_os = "windows"))]
            let output = Command::new("kill")
                .args(["-TERM", pid_string.as_str()])
                .output()
                .map_err(|error| format!("Could not stop managed process: {error}"))?;

            if output.status.success() {
                state
                    .managed_children
                    .lock()
                    .map_err(|_| "Managed-process state is unavailable.".to_string())?
                    .remove(&pid);

                if let Some(session) = state
                    .browser_sessions
                    .lock()
                    .map_err(|_| "Browser-session state is unavailable.".to_string())?
                    .remove(&pid)
                {
                    let _ = fs::remove_dir_all(session.profile_dir);
                }
            }

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::CaptureScreen => {
            let path = capture_screen_png()?;
            let size = fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Screenshot saved to {} ({} bytes). Use inspect_screen when visual understanding is required.",
                    path.display(),
                    size
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::InspectScreen { prompt, provider } => {
            let path = capture_screen_png()?;
            let analysis = analyze_png_with_provider(&provider, &prompt, &path).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Screen analysis from {}/{}:\n{}\nScreenshot: {}",
                    provider.provider,
                    provider.model,
                    analysis,
                    path.display()
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ListProcesses => {
            let mut system = System::new_all();
            system.refresh_all();

            let mut rows = system
                .processes()
                .iter()
                .map(|(pid, process)| {
                    format!(
                        "PID={} | {} | {:.1} MB",
                        pid.as_u32(),
                        process.name().to_string_lossy(),
                        process.memory() as f64 / 1024.0 / 1024.0
                    )
                })
                .collect::<Vec<_>>();

            rows.sort();
            rows.truncate(400);

            Ok(ActionResult {
                success: true,
                tool,
                stdout: rows.join("\n"),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::UiFind { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$items = @()
for ($i = 0; $i -lt [Math]::Min($matches.Count, 25); $i++) {{
    $e = $matches.Item($i)
    $items += [PSCustomObject]@{{
        Name = $e.Current.Name
        AutomationId = $e.Current.AutomationId
        ControlType = $e.Current.ControlType.ProgrammaticName
        ClassName = $e.Current.ClassName
        IsEnabled = $e.Current.IsEnabled
        Bounds = $e.Current.BoundingRectangle.ToString()
    }}
}}
$items | ConvertTo-Json -Compress"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI lookup failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiClick { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {{
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    'Invoked element: ' + $e.Current.Name
}} elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {{
    ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
    'Selected element: ' + $e.Current.Name
}} else {{
    throw 'Matching element does not expose InvokePattern or SelectionItemPattern.'
}}"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI click failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiSetValue { name, automation_id, window, value } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let escaped_value = ps_single_quote(&value);
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ValuePattern.'
}}
([System.Windows.Automation.ValuePattern]$pattern).SetValue('{escaped_value}')
'Value set on element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI value change failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiFocus { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id, window, or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$e.SetFocus()
'Focused element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI focus failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiScroll { name, automation_id, window, vertical } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let amount = match vertical.as_str() {
                "small_increment" => "SmallIncrement",
                "small_decrement" => "SmallDecrement",
                "large_increment" => "LargeIncrement",
                "large_decrement" => "LargeDecrement",
                _ => return Err("Invalid scroll amount.".into()),
            };

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id, window, or a more specific selector.') }}
$e = $matches.Item(0)
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ScrollPattern.'
}}
([System.Windows.Automation.ScrollPattern]$pattern).Scroll(
    [System.Windows.Automation.ScrollAmount]::NoAmount,
    [System.Windows.Automation.ScrollAmount]::{amount}
)
'Scrolled element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI scroll failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiToggle { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose TogglePattern.'
}}
([System.Windows.Automation.TogglePattern]$pattern).Toggle()
'Toggled element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI toggle failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiExpandCollapse { name, automation_id, window, action } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let method = if action == "expand" { "Expand" } else { "Collapse" };

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ExpandCollapsePattern.'
}}
$expand = [System.Windows.Automation.ExpandCollapsePattern]$pattern
$expand.{method}()
'{method} completed for element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI expand/collapse failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiSendKeys { name, automation_id, window, keys } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let escaped_keys = ps_single_quote(&keys);

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$e.SetFocus()
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait('{escaped_keys}')
'Keyboard fallback sent to element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI keyboard fallback failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::PointerClick { x, y, button, clicks } => {
            #[cfg(target_os = "windows")]
            {
                let down_flag = match button.as_str() {
                    "left" => "0x0002",
                    "right" => "0x0008",
                    "middle" => "0x0020",
                    _ => return Err("Invalid pointer button.".into()),
                };
                let up_flag = match button.as_str() {
                    "left" => "0x0004",
                    "right" => "0x0010",
                    "middle" => "0x0040",
                    _ => return Err("Invalid pointer button.".into()),
                };

                let script = format!(
                    r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShuviPointer {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}}
"@
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ({x} -lt $bounds.Left -or {x} -ge $bounds.Right -or {y} -lt $bounds.Top -or {y} -ge $bounds.Bottom) {{
  throw 'Pointer target is outside the current virtual desktop.'
}}
if (-not [ShuviPointer]::SetCursorPos({x}, {y})) {{ throw 'Could not move pointer.' }}
Start-Sleep -Milliseconds 80
for ($i = 0; $i -lt {clicks}; $i++) {{
  [ShuviPointer]::mouse_event({down_flag}, 0, 0, 0, [UIntPtr]::Zero)
  [ShuviPointer]::mouse_event({up_flag}, 0, 0, 0, [UIntPtr]::Zero)
  if ($i + 1 -lt {clicks}) {{ Start-Sleep -Milliseconds 120 }}
}}
'Pointer click completed at ({x}, {y}).'"#
                );

                let output = run_hidden_powershell(&script)?;
                if !output.status.success() {
                    return Err(format!(
                        "Coordinate pointer click failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }

                return Ok(ActionResult {
                    success: true,
                    tool,
                    stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                    stderr: String::new(),
                    exit_code: output.status.code(),
                });
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("Coordinate pointer fallback is currently available on Windows only.".into())
            }
        }
        ToolAction::PremiereDetect => {
            let installations = find_premiere_installations()?;

            let stdout = if installations.is_empty() {
                "No Adobe Premiere Pro installation was detected in the standard Adobe Program Files folders.".to_string()
            } else {
                installations
                    .iter()
                    .enumerate()
                    .map(|(index, path)| format!("{}: {}", index + 1, path.display()))
                    .collect::<Vec<_>>()
                    .join("\n")
            };

            Ok(ActionResult {
                success: true,
                tool,
                stdout,
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereLaunch { project } => {
            let installations = find_premiere_installations()?;
            let executable = installations
                .last()
                .cloned()
                .ok_or_else(|| "Adobe Premiere Pro was not found in the standard Adobe Program Files folders.".to_string())?;

            let mut command = Command::new(&executable);
            if let Some(project) = &project {
                command.arg(project);
            }

            let child = command
                .spawn()
                .map_err(|error| format!("Could not launch Adobe Premiere Pro: {error}"))?;

            let child_pid = child.id();
            state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .insert(child_pid);

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Launched Adobe Premiere Pro from {} with root PID {}. Shuvi is tracking the managed process tree.",
                    executable.display(),
                    child_pid
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereBridgeStart => {
            let status = state.premiere_bridge.start()?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Premiere bridge enabled on 127.0.0.1:{}; paired={}. Open the Shuvi Premiere Bridge panel and pair it from Shuvi's Premiere settings.",
                    status.port,
                    status.paired
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereBridgeStatus => {
            let status = state.premiere_bridge.status()?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Premiere bridge: enabled={}, server_started={}, paired={}, port={}, queued_commands={}",
                    status.enabled,
                    status.server_started,
                    status.paired,
                    status.port,
                    status.queued_commands
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereContext => {
            let value = state
                .premiere_bridge
                .request("inspect_context", json!({}), Duration::from_secs(8))
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereTimeline => {
            let value = state.premiere_bridge
                .request("inspect_timeline", json!({}), Duration::from_secs(12)).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetPlayhead { seconds } => {
            let value = state.premiere_bridge.request(
                "set_playhead",
                json!({ "seconds": seconds }),
                Duration::from_secs(8),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetTrackMute { kind, track, muted } => {
            let value = state.premiere_bridge.request(
                "set_track_mute",
                json!({ "kind": kind, "track": track, "muted": muted }),
                Duration::from_secs(10),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListItems => {
            let value = state
                .premiere_bridge
                .request("list_root_items", json!({}), Duration::from_secs(8))
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateBin { name } => {
            let value = state
                .premiere_bridge
                .request(
                    "create_bin",
                    json!({ "name": name }),
                    Duration::from_secs(8),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereImportMedia { paths } => {
            let value = state
                .premiere_bridge
                .request(
                    "import_media",
                    json!({ "paths": paths }),
                    Duration::from_secs(30),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateSequenceFromMedia { name, paths } => {
            let backup = backup_premiere_project(state).await?;
            let value = state
                .premiere_bridge
                .request(
                    "create_sequence_from_media",
                    json!({ "name": name, "paths": paths }),
                    Duration::from_secs(45),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                }))
                .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInsertMedia { path, seconds, video_track, audio_track, mode } => {
            let backup = backup_premiere_project(state).await?;
            let value = state.premiere_bridge.request(
                "insert_media",
                json!({
                    "path": path,
                    "seconds": seconds,
                    "videoTrack": video_track,
                    "audioTrack": audio_track,
                    "mode": mode
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereTrimClip { kind, track, clip_index, start_seconds, end_seconds } => {
            let backup = backup_premiere_project(state).await?;
            let value = state.premiere_bridge.request(
                "trim_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "startSeconds": start_seconds,
                    "endSeconds": end_seconds
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereMoveClip { kind, track, clip_index, delta_seconds } => {
            let backup = backup_premiere_project(state).await?;
            let value = state.premiere_bridge.request(
                "move_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "deltaSeconds": delta_seconds
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereDeleteClip { kind, track, clip_index, ripple } => {
            let backup = backup_premiere_project(state).await?;
            let value = state.premiere_bridge.request(
                "delete_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "ripple": ripple
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetTrackMute { kind, track, muted } => {
            let value = state.premiere_bridge.request(
                "set_track_mute",
                json!({
                    "kind": kind,
                    "track": track,
                    "muted": muted
                }),
                Duration::from_secs(10),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereExportSequence { output, preset, queue_to_ame } => {
            let value = state.premiere_bridge.request(
                "export_sequence",
                json!({
                    "output": output,
                    "preset": preset,
                    "queueToAme": queue_to_ame
                }),
                Duration::from_secs(45),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSaveProject => {
            let value = state.premiere_bridge
                .request("save_project", json!({}), Duration::from_secs(15)).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::WorkspaceScan { path } => {
            let root = Path::new(&path);
            if !root.is_dir() {
                return Err("Workspace path is not a directory.".into());
            }

            let mut output = Vec::new();
            workspace_scan_recursive(root, root, 0, &mut output)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(output.join("\n")),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::SearchText { path, query } => {
            let root = Path::new(&path);
            if !root.is_dir() {
                return Err("Search path is not a directory.".into());
            }

            let mut matches = Vec::new();
            search_text_recursive(root, root, &query, 0, &mut matches)?;

            let stdout = if matches.is_empty() {
                format!("No matches found for '{query}'.")
            } else {
                matches.join("\n")
            };

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(stdout),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ReplaceText { path, old, new_value } => {
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("Could not inspect file: {error}"))?;

            if metadata.len() > MAX_WRITE_BYTES as u64 {
                return Err("File is larger than Shuvi's 2 MB edit limit.".into());
            }

            let source = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read UTF-8 text file: {error}"))?;

            let count = source.matches(&old).count();
            if count == 0 {
                return Err("Exact old text was not found.".into());
            }
            if count > 1 {
                return Err(format!(
                    "Exact old text appears {count} times. Refine the old text so the edit is unambiguous."
                ));
            }

            let updated = source.replacen(&old, &new_value, 1);
            fs::write(&path, updated.as_bytes())
                .map_err(|error| format!("Could not write edited file: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Applied one exact replacement in {path}."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ApplyPatch { path, patch } => {
            let check = run_git_with_stdin(
                &path,
                &["apply", "--check", "--whitespace=nowarn", "-"],
                &patch,
            )?;

            if !check.status.success() {
                return Err(format!(
                    "Patch validation failed: {}",
                    String::from_utf8_lossy(&check.stderr)
                ));
            }

            let output = run_git_with_stdin(
                &path,
                &["apply", "--whitespace=nowarn", "-"],
                &patch,
            )?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: if output.status.success() {
                    "Structured patch applied successfully.".into()
                } else {
                    truncate_output(String::from_utf8_lossy(&output.stdout).to_string())
                },
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::RunProjectTask { path, task } => {
            let (program, args) = project_task_command(&path, &task)?;

            let output = Command::new(&program)
                .args(&args)
                .current_dir(&path)
                .env("CI", "1")
                .output()
                .map_err(|error| format!("Could not run project task: {error}"))?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitStatus { path } => {
            let output = run_git(&path, &["status", "--short", "--branch"])?;
            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitDiff { path } => {
            let output = run_git(&path, &["diff", "--no-ext-diff", "--unified=3"])?;
            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitCommit { path, message } => {
            let add = run_git(&path, &["add", "-A"])?;
            if !add.status.success() {
                return Err(format!(
                    "Git staging failed: {}",
                    String::from_utf8_lossy(&add.stderr)
                ));
            }

            let output = run_git(&path, &["commit", "-m", &message])?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitPush { path } => {
            let output = run_git(&path, &["push"])?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::PowerShell { command } => {
            #[cfg(target_os = "windows")]
            let output = Command::new("powershell.exe")
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &command])
                .output()
                .map_err(|error| format!("Failed to start PowerShell: {error}"))?;

            #[cfg(not(target_os = "windows"))]
            let output = Command::new("sh")
                .args(["-lc", &command])
                .output()
                .map_err(|error| format!("Failed to start shell: {error}"))?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
    }
}

#[tauri::command]
fn list_providers() -> Vec<ProviderDescriptor> {
    providers()
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key cannot be empty.".into());
    }

    key_entry(&provider)?
        .set_password(api_key.trim())
        .map_err(|error| format!("Could not save API key: {error}"))
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = key_entry(&provider)?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete API key: {error}")),
    }
}

#[tauri::command]
async fn chat(
    mut input: ChatInput,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ChatResponse, String> {
    ensure_memory_budget(state.inner())?;

    let workspace = read_workspace(&app)?;
    let workspace_context = workspace
        .as_deref()
        .map(|path| format!("\nCurrent Shuvi workspace: {path}\nUse this workspace when the user refers to 'the project' without giving another path."))
        .unwrap_or_default();

    input.messages.insert(
        0,
        ChatMessage {
            role: "system".into(),
            content: format!("{TOOL_PROTOCOL}{workspace_context}"),
        },
    );

    let key = load_api_key(&input.provider)?;
    send_chat(input, key).await
}

#[tauri::command]
fn runtime_status(state: State<'_, ActionState>) -> Result<RuntimeStatus, String> {
    current_runtime_status(state.inner())
}

#[tauri::command]
fn prepare_tool(
    proposal: ToolProposal,
    provider: String,
    model: String,
    base_url: Option<String>,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    ensure_memory_budget(state.inner())?;

    let provider_context = ProviderContext {
        provider,
        model,
        base_url,
    };

    stage_tool(proposal, Some(provider_context), state.inner())
}

#[tauri::command]
fn prepare_powershell(
    command: String,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    ensure_memory_budget(state.inner())?;

    let proposal = ToolProposal {
        tool: "powershell".into(),
        arguments: json!({ "command": command }),
        reason: Some("Manual PowerShell action".into()),
    };

    stage_tool(proposal, None, state.inner())
}

#[tauri::command]
fn deny_action(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<(), String> {
    let action = state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .remove(&action_id);

    if let Some(action) = action {
        append_audit(
            &app,
            &AuditEntry {
                timestamp_ms: now_ms(),
                event: "denied".into(),
                tool: action.tool,
                detail: action.detail,
                success: false,
            },
        )?;
    }

    Ok(())
}

#[tauri::command]
async fn execute_action(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ActionResult, String> {
    ensure_memory_budget(state.inner())?;

    let action = state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .remove(&action_id)
        .ok_or_else(|| "Action expired, was denied, or does not exist.".to_string())?;

    let tool = action.tool.clone();
    let detail = action.detail.clone();

    match execute_tool(action, state.inner()).await {
        Ok(result) => {
            append_audit(
                &app,
                &AuditEntry {
                    timestamp_ms: now_ms(),
                    event: "executed".into(),
                    tool,
                    detail,
                    success: result.success,
                },
            )?;
            Ok(result)
        }
        Err(error) => {
            append_audit(
                &app,
                &AuditEntry {
                    timestamp_ms: now_ms(),
                    event: "failed".into(),
                    tool,
                    detail,
                    success: false,
                },
            )?;
            Err(error)
        }
    }
}

#[tauri::command]
async fn execute_powershell(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ActionResult, String> {
    execute_action(action_id, state, app).await
}

#[tauri::command]
fn audit_log(app: AppHandle, limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    read_audit(&app, limit.unwrap_or(30))
}

#[tauri::command]
fn set_workspace(path: String, app: AppHandle) -> Result<(), String> {
    write_workspace(&app, path.trim())
}

#[tauri::command]
fn get_workspace(app: AppHandle) -> Result<Option<String>, String> {
    read_workspace(&app)
}

#[tauri::command]
fn save_session_checkpoint(
    checkpoint: SessionCheckpoint,
    app: AppHandle,
) -> Result<(), String> {
    write_session_checkpoint(&app, checkpoint)
}

#[tauri::command]
fn load_session_checkpoint(app: AppHandle) -> Result<Option<SessionCheckpoint>, String> {
    read_session_checkpoint(&app)
}

#[tauri::command]
fn clear_session_checkpoint(app: AppHandle) -> Result<(), String> {
    remove_session_checkpoint(&app)
}

#[tauri::command]
fn premiere_bridge_start(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.start()
}

#[tauri::command]
fn premiere_bridge_status(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.status()
}

#[tauri::command]
fn premiere_bridge_stop(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.stop()
}

#[tauri::command]
fn export_diagnostics(
    app: AppHandle,
    state: State<'_, ActionState>,
) -> Result<String, String> {
    let runtime = current_runtime_status(state.inner())?;
    let workspace = read_workspace(&app)?;
    let recent_audit = read_audit(&app, 50)?;

    let managed_roots = state
        .managed_children
        .lock()
        .map_err(|_| "Managed-process state is unavailable.".to_string())?
        .iter()
        .copied()
        .collect::<Vec<_>>();

    let browser_sessions = state
        .browser_sessions
        .lock()
        .map_err(|_| "Browser-session state is unavailable.".to_string())?
        .iter()
        .map(|(pid, session)| {
            json!({
                "root_pid": pid,
                "devtools_port": session.port
            })
        })
        .collect::<Vec<_>>();

    let report = json!({
        "generated_at_ms": now_ms(),
        "shuvi_version": env!("CARGO_PKG_VERSION"),
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        },
        "runtime": runtime,
        "workspace": workspace,
        "managed_process_roots": managed_roots,
        "managed_browser_sessions": browser_sessions,
        "recent_audit": recent_audit,
        "privacy_note": "API keys and credential-store secrets are intentionally excluded."
    });

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("diagnostics");

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create diagnostics directory: {error}"))?;

    let path = dir.join(format!("shuvi-diagnostics-{}.json", now_ms()));
    let content = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("Could not encode diagnostics: {error}"))?;

    fs::write(&path, content.as_bytes())
        .map_err(|error| format!("Could not write diagnostics file: {error}"))?;

    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ActionState::default())
        .invoke_handler(tauri::generate_handler![
            list_providers,
            save_api_key,
            delete_api_key,
            chat,
            runtime_status,
            prepare_tool,
            prepare_powershell,
            deny_action,
            execute_action,
            execute_powershell,
            audit_log,
            set_workspace,
            get_workspace,
            save_session_checkpoint,
            load_session_checkpoint,
            clear_session_checkpoint,
            premiere_bridge_start,
            premiere_bridge_status,
            premiere_bridge_stop,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shuvi");
}
