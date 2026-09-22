use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    process::Command,
    sync::Mutex,
    time::Duration,
};

use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sysinfo::System;
use tauri::State;
use uuid::Uuid;

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
- powershell: {"command":"PowerShell command"}

Rules:
- Use tools only when a computer action is required.
- Never claim an action succeeded before Shuvi returns a tool result.
- Prefer typed file/app tools over PowerShell.
- Do not put tool JSON inside markdown fences.
- For destructive/system/security-sensitive work, explain the intent in reason.
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
struct ChatResponse {
    content: String,
    provider: String,
    model: String,
    tool_proposal: Option<ToolProposal>,
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
enum ToolAction {
    ListDirectory { path: String },
    ReadFile { path: String },
    WriteFile { path: String, content: String },
    CreateDirectory { path: String },
    LaunchApp { program: String, args: Vec<String> },
    PowerShell { command: String },
}

#[derive(Debug, Clone)]
struct PendingAction {
    tool: String,
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

#[derive(Debug, Clone, Serialize)]
struct RuntimeStatus {
    shuvi_memory_bytes: u64,
    shuvi_memory_mb: f64,
    soft_limit_mb: f64,
    hard_limit_mb: f64,
    over_soft_limit: bool,
    over_hard_limit: bool,
}

#[derive(Default)]
struct ActionState {
    pending: Mutex<HashMap<String, PendingAction>>,
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

fn compact_error(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| body.to_string().chars().take(400).collect())
}

fn parse_tool_proposal(text: &str) -> Option<ToolProposal> {
    let mut candidate = text.trim();

    if let Some(stripped) = candidate.strip_prefix("~~~json") {
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
        | "powershell" => Some(proposal),
        _ => None,
    }
}

fn chat_response(content: String, provider: String, model: String) -> ChatResponse {
    let tool_proposal = parse_tool_proposal(&content);
    ChatResponse {
        content,
        provider,
        model,
        tool_proposal,
    }
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

    let response = request
        .send()
        .await
        .map_err(|error| format!("Provider request failed: {error}"))?;

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

    Ok(chat_response(content, input.provider, input.model))
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

    let response = http_client()?
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Gemini request failed: {error}"))?;

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

    Ok(chat_response(content, input.provider, model))
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

    let response = http_client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "messages": messages
        }))
        .send()
        .await
        .map_err(|error| format!("Anthropic request failed: {error}"))?;

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

    Ok(chat_response(content, input.provider, model))
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

fn current_runtime_status() -> Result<RuntimeStatus, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let pid = sysinfo::get_current_pid().map_err(|error| format!("PID error: {error}"))?;
    let process = system
        .process(pid)
        .ok_or_else(|| "Could not read Shuvi process memory.".to_string())?;

    let bytes = process.memory();
    let mb = bytes as f64 / 1024.0 / 1024.0;

    Ok(RuntimeStatus {
        shuvi_memory_bytes: bytes,
        shuvi_memory_mb: mb,
        soft_limit_mb: SOFT_LIMIT_MB,
        hard_limit_mb: HARD_LIMIT_MB,
        over_soft_limit: mb >= SOFT_LIMIT_MB,
        over_hard_limit: mb >= HARD_LIMIT_MB,
    })
}

fn ensure_memory_budget() -> Result<(), String> {
    let status = current_runtime_status()?;
    if status.over_hard_limit {
        Err("Shuvi is above the 4 GB hard RAM ceiling. Close heavy work before starting another action.".into())
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

fn stage_tool(proposal: ToolProposal, state: &ActionState) -> Result<PendingActionView, String> {
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

fn truncate_output(value: String) -> String {
    if value.chars().count() <= MAX_TOOL_OUTPUT_CHARS {
        return value;
    }

    let shortened = value.chars().take(MAX_TOOL_OUTPUT_CHARS).collect::<String>();
    format!("{shortened}\n[output truncated by Shuvi]")
}

fn execute_tool(action: PendingAction) -> Result<ActionResult, String> {
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

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Launched {program} with PID {}.", child.id()),
                stderr: String::new(),
                exit_code: Some(0),
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
async fn chat(mut input: ChatInput) -> Result<ChatResponse, String> {
    ensure_memory_budget()?;

    input.messages.insert(
        0,
        ChatMessage {
            role: "system".into(),
            content: TOOL_PROTOCOL.into(),
        },
    );

    let key = load_api_key(&input.provider)?;
    send_chat(input, key).await
}

#[tauri::command]
fn runtime_status() -> Result<RuntimeStatus, String> {
    current_runtime_status()
}

#[tauri::command]
fn prepare_tool(
    proposal: ToolProposal,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    ensure_memory_budget()?;
    stage_tool(proposal, &state)
}

#[tauri::command]
fn prepare_powershell(
    command: String,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    let proposal = ToolProposal {
        tool: "powershell".into(),
        arguments: json!({ "command": command }),
        reason: Some("Manual PowerShell action".into()),
    };

    stage_tool(proposal, &state)
}

#[tauri::command]
fn deny_action(action_id: String, state: State<'_, ActionState>) -> Result<(), String> {
    state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .remove(&action_id);

    Ok(())
}

#[tauri::command]
fn execute_action(
    action_id: String,
    state: State<'_, ActionState>,
) -> Result<ActionResult, String> {
    ensure_memory_budget()?;

    let action = state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .remove(&action_id)
        .ok_or_else(|| "Action expired, was denied, or does not exist.".to_string())?;

    execute_tool(action)
}

#[tauri::command]
fn execute_powershell(
    action_id: String,
    state: State<'_, ActionState>,
) -> Result<ActionResult, String> {
    execute_action(action_id, state)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shuvi");
}
