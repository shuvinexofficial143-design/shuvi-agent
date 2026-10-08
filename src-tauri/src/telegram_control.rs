use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const TELEGRAM_API_ORIGIN: &str = "https://api.telegram.org";
const TELEGRAM_TOKEN_USER: &str = "integration:telegram:bot_token";
const TELEGRAM_CHAT_USER: &str = "integration:telegram:chat_id";
const MAX_TELEGRAM_TEXT_CHARS: usize = 12_000;
const TELEGRAM_SEND_CHUNK_CHARS: usize = 3_800;

#[derive(Default)]
struct TelegramInner {
    running: AtomicBool,
    generation: AtomicU64,
    paired_chat_id: Mutex<Option<i64>>,
    pair_code: Mutex<Option<String>>,
}

#[derive(Clone, Default)]
pub struct TelegramControlState {
    inner: Arc<TelegramInner>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TelegramControlStatus {
    configured: bool,
    running: bool,
    paired: bool,
    paired_chat_suffix: Option<String>,
    pair_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TelegramControlEvent {
    pub kind: String,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramEnvelope<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    text: Option<String>,
    chat: TelegramChat,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
}

fn credential_entry(user: &str) -> Result<Entry, String> {
    Entry::new(super::KEYRING_SERVICE, user)
        .map_err(|error| format!("Telegram credential store unavailable: {error}"))
}

fn load_bot_token() -> Result<Option<String>, String> {
    match credential_entry(TELEGRAM_TOKEN_USER)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Telegram bot token: {error}")),
    }
}

fn load_paired_chat_id() -> Result<Option<i64>, String> {
    match credential_entry(TELEGRAM_CHAT_USER)?.get_password() {
        Ok(value) => value
            .parse::<i64>()
            .map(Some)
            .map_err(|_| "Stored Telegram chat ID is invalid.".to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Telegram paired chat: {error}")),
    }
}

fn save_paired_chat_id(chat_id: i64) -> Result<(), String> {
    credential_entry(TELEGRAM_CHAT_USER)?
        .set_password(&chat_id.to_string())
        .map_err(|error| format!("Could not save Telegram paired chat: {error}"))
}

fn clear_paired_chat_id() -> Result<(), String> {
    match credential_entry(TELEGRAM_CHAT_USER)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not clear Telegram paired chat: {error}")),
    }
}

fn new_pair_code() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>()
        .to_ascii_uppercase()
}

fn safe_pair_code(state: &TelegramControlState) -> Result<Option<String>, String> {
    if state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())?
        .is_some()
    {
        return Ok(None);
    }

    let mut code = state
        .inner
        .pair_code
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())?;
    if code.is_none() {
        *code = Some(new_pair_code());
    }
    Ok(code.clone())
}

fn chat_suffix(chat_id: i64) -> String {
    let raw = chat_id.unsigned_abs().to_string();
    let keep = raw.chars().rev().take(4).collect::<String>();
    keep.chars().rev().collect()
}

pub fn initialize(state: &TelegramControlState) -> Result<(), String> {
    let paired = load_paired_chat_id()?;
    *state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())? = paired;
    Ok(())
}

fn status_for(state: &TelegramControlState) -> Result<TelegramControlStatus, String> {
    let configured = load_bot_token()?.is_some();
    let paired_chat_id = *state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())?;
    let pair_code = if configured && paired_chat_id.is_none() {
        safe_pair_code(state)?
    } else {
        None
    };

    Ok(TelegramControlStatus {
        configured,
        running: state.inner.running.load(Ordering::Acquire),
        paired: paired_chat_id.is_some(),
        paired_chat_suffix: paired_chat_id.map(chat_suffix),
        pair_code,
    })
}

fn telegram_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(35))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not create Telegram client: {error}"))
}

fn telegram_url(token: &str, method: &str) -> String {
    format!("{TELEGRAM_API_ORIGIN}/bot{token}/{method}")
}

async fn verify_bot(client: &Client, token: &str) -> Result<(), String> {
    let response = client
        .get(telegram_url(token, "getMe"))
        .send()
        .await
        .map_err(|error| format!("Telegram getMe failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Telegram rejected the bot token with HTTP {}.", response.status()));
    }
    let body: TelegramEnvelope<serde_json::Value> = response
        .json()
        .await
        .map_err(|error| format!("Telegram getMe response was invalid: {error}"))?;
    if body.ok {
        Ok(())
    } else {
        Err(body
            .description
            .unwrap_or_else(|| "Telegram rejected the bot token.".into()))
    }
}

async fn send_one(client: &Client, token: &str, chat_id: i64, text: &str) -> Result<(), String> {
    let response = client
        .post(telegram_url(token, "sendMessage"))
        .json(&json!({
            "chat_id": chat_id,
            "text": text
        }))
        .send()
        .await
        .map_err(|error| format!("Telegram sendMessage failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Telegram sendMessage returned HTTP {}.", response.status()));
    }
    let body: TelegramEnvelope<serde_json::Value> = response
        .json()
        .await
        .map_err(|error| format!("Telegram sendMessage response was invalid: {error}"))?;
    if body.ok {
        Ok(())
    } else {
        Err(body
            .description
            .unwrap_or_else(|| "Telegram sendMessage failed.".into()))
    }
}

fn split_message(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in trimmed.chars() {
        current.push(ch);
        if current.chars().count() >= TELEGRAM_SEND_CHUNK_CHARS {
            chunks.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

async fn send_text_to_chat(token: &str, chat_id: i64, text: &str) -> Result<(), String> {
    let client = telegram_client()?;
    for chunk in split_message(text) {
        send_one(&client, token, chat_id, &chunk).await?;
    }
    Ok(())
}

async fn emit_control(app: &AppHandle, kind: &str, text: Option<String>) -> Result<(), String> {
    app.emit(
        "shuvi://telegram-control",
        TelegramControlEvent {
            kind: kind.to_string(),
            text,
        },
    )
    .map_err(|error| format!("Could not deliver Telegram command to Shuvi UI: {error}"))
}

async fn handle_message(
    app: &AppHandle,
    state: &TelegramControlState,
    token: &str,
    message: TelegramMessage,
) -> Result<(), String> {
    if message.chat.kind != "private" {
        return Ok(());
    }

    let Some(text) = message.text.map(|value| value.trim().to_string()) else {
        return Ok(());
    };
    if text.is_empty() || text.chars().count() > MAX_TELEGRAM_TEXT_CHARS {
        return Ok(());
    }

    let paired = *state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())?;

    if paired.is_none() {
        let expected = safe_pair_code(state)?.unwrap_or_default();
        let supplied = text
            .strip_prefix("/pair ")
            .or_else(|| text.strip_prefix("/PAIR "))
            .map(str::trim)
            .unwrap_or_default();

        if !supplied.is_empty() && supplied.eq_ignore_ascii_case(&expected) {
            save_paired_chat_id(message.chat.id)?;
            *state
                .inner
                .paired_chat_id
                .lock()
                .map_err(|_| "Telegram pairing state is unavailable.".to_string())? =
                Some(message.chat.id);
            *state
                .inner
                .pair_code
                .lock()
                .map_err(|_| "Telegram pairing state is unavailable.".to_string())? = None;
            send_text_to_chat(
                token,
                message.chat.id,
                "Shuvi paired. Send any prompt here. Reply 'approve' when Shuvi asks for permission. Commands: status, deny, cancel.",
            )
            .await?;
        } else {
            send_text_to_chat(
                token,
                message.chat.id,
                "This Telegram chat is not paired with Shuvi. Open Shuvi Desktop > Telegram and send /pair followed by the one-time code shown there.",
            )
            .await?;
        }
        return Ok(());
    }

    if paired != Some(message.chat.id) {
        return Ok(());
    }

    let normalized = text.to_ascii_lowercase();
    match normalized.as_str() {
        "approve" | "/approve" | "allow" => emit_control(app, "approve", None).await?,
        "deny" | "/deny" | "reject" => emit_control(app, "deny", None).await?,
        "cancel" | "/cancel" | "stop" | "/stop" => emit_control(app, "cancel", None).await?,
        "status" | "/status" => emit_control(app, "status", None).await?,
        "help" | "/help" => {
            send_text_to_chat(
                token,
                message.chat.id,
                "Send a normal message to prompt Shuvi. Use: approve, deny, status, cancel.",
            )
            .await?;
        }
        _ => emit_control(app, "prompt", Some(text)).await?,
    }

    Ok(())
}

async fn poll_loop(
    app: AppHandle,
    state: TelegramControlState,
    token: String,
    generation: u64,
) {
    let Ok(client) = telegram_client() else {
        state.inner.running.store(false, Ordering::Release);
        return;
    };
    let mut offset: i64 = 0;

    while state.inner.running.load(Ordering::Acquire)
        && state.inner.generation.load(Ordering::Acquire) == generation
    {
        let response = client
            .get(telegram_url(&token, "getUpdates"))
            .query(&[
                ("timeout", "25".to_string()),
                ("offset", offset.to_string()),
                ("allowed_updates", "["message"]".to_string()),
            ])
            .send()
            .await;

        let Ok(response) = response else {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        if !response.status().is_success() {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        let Ok(body) = response.json::<TelegramEnvelope<Vec<TelegramUpdate>>>().await else {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        if !body.ok {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        for update in body.result.unwrap_or_default() {
            offset = offset.max(update.update_id.saturating_add(1));
            if let Some(message) = update.message {
                if let Err(error) = handle_message(&app, &state, &token, message).await {
                    eprintln!("Telegram control message failed: {error}");
                }
            }
        }
    }
}

#[tauri::command]
pub fn telegram_control_status(
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    status_for(state.inner())
}

#[tauri::command]
pub fn telegram_save_bot_token(
    token: String,
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    let token = token.trim();
    if token.is_empty()
        || token.len() > 256
        || token.chars().any(char::is_control)
        || !token.contains(':')
    {
        return Err("Telegram bot token is invalid.".into());
    }
    credential_entry(TELEGRAM_TOKEN_USER)?
        .set_password(token)
        .map_err(|error| format!("Could not save Telegram bot token: {error}"))?;
    status_for(state.inner())
}

#[tauri::command]
pub fn telegram_delete_bot_token(
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    state.inner.running.store(false, Ordering::Release);
    state.inner.generation.fetch_add(1, Ordering::AcqRel);
    match credential_entry(TELEGRAM_TOKEN_USER)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(format!("Could not delete Telegram bot token: {error}")),
    }
    clear_paired_chat_id()?;
    *state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())? = None;
    *state
        .inner
        .pair_code
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())? = None;
    status_for(state.inner())
}

#[tauri::command]
pub async fn telegram_control_start(
    app: AppHandle,
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    let token = load_bot_token()?.ok_or_else(|| "Save a Telegram bot token first.".to_string())?;
    let client = telegram_client()?;
    verify_bot(&client, &token).await?;

    if state.inner.running.swap(true, Ordering::AcqRel) {
        return status_for(state.inner());
    }

    let generation = state.inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let cloned = state.inner().clone();
    tauri::async_runtime::spawn(poll_loop(app, cloned, token, generation));
    status_for(state.inner())
}

#[tauri::command]
pub fn telegram_control_stop(
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    state.inner.running.store(false, Ordering::Release);
    state.inner.generation.fetch_add(1, Ordering::AcqRel);
    status_for(state.inner())
}

#[tauri::command]
pub fn telegram_unpair(
    state: State<'_, TelegramControlState>,
) -> Result<TelegramControlStatus, String> {
    clear_paired_chat_id()?;
    *state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())? = None;
    *state
        .inner
        .pair_code
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())? =
        Some(new_pair_code());
    status_for(state.inner())
}

#[tauri::command]
pub async fn telegram_send_message(
    text: String,
    state: State<'_, TelegramControlState>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }
    if text.chars().count() > MAX_TELEGRAM_TEXT_CHARS {
        return Err("Telegram reply exceeds Shuvi's 12,000-character safety limit.".into());
    }

    let token = load_bot_token()?.ok_or_else(|| "Telegram bot is not configured.".to_string())?;
    let chat_id = state
        .inner
        .paired_chat_id
        .lock()
        .map_err(|_| "Telegram pairing state is unavailable.".to_string())?
        .ok_or_else(|| "Telegram is not paired.".to_string())?;

    send_text_to_chat(&token, chat_id, &text).await
}
