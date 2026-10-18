//! System tray and global push-to-talk integration for the local voice companion.
//!
//! Microphone capture is never started by this module. The tray and shortcut only
//! send explicit press/release or mute events to the voice companion webview.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const TRAY_ID: &str = "voice-tray";
const MENU_OPEN_VOICE: &str = "open_voice";
const MENU_TOGGLE_MUTE: &str = "toggle_mute";
const MENU_START_RECORDING: &str = "start_recording";
const MENU_STOP_RECORDING: &str = "stop_recording";
const MENU_CHECK_ENGINE: &str = "check_engine";
const MENU_QUIT: &str = "quit";

/// Default global shortcut for push-to-talk (Ctrl+Shift+Space).
pub const DEFAULT_PUSH_TO_TALK: &str = "CommandOrControl+Shift+Space";

/// State mirrored by the voice companion so the tray can expose a safe status.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VoiceTrayState {
    pub is_recording: bool,
    pub engine_available: bool,
    pub is_muted: bool,
}

fn emit_voice_event<R: Runtime>(app: &AppHandle<R>, event: &str) -> Result<(), String> {
    app.emit(event, ())
        .map_err(|error| format!("failed to emit {event}: {error}"))
}

fn emit_push_to_talk<R: Runtime>(app: &AppHandle<R>, state: ShortcutState) {
    let event = match state {
        ShortcutState::Pressed => "voice:start_recording",
        ShortcutState::Released => "voice:stop_recording",
        _ => return,
    };
    let _ = emit_voice_event(app, event);
}

/// Add the voice tray icon and its explicit controls to the application.
pub fn build_voice_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(
        app,
        MENU_OPEN_VOICE,
        "Open Voice Companion",
        true,
        None::<&str>,
    )?;
    let mute = MenuItem::with_id(app, MENU_TOGGLE_MUTE, "Mute Microphone", true, None::<&str>)?;
    let start = MenuItem::with_id(
        app,
        MENU_START_RECORDING,
        "Start Recording (Push-to-Talk)",
        true,
        None::<&str>,
    )?;
    let stop = MenuItem::with_id(
        app,
        MENU_STOP_RECORDING,
        "Stop Recording",
        true,
        None::<&str>,
    )?;
    let check = MenuItem::with_id(
        app,
        MENU_CHECK_ENGINE,
        "Check STT Engine",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &separator, &mute, &start, &stop, &separator, &check, &separator, &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("../icons/icon.png"))
        .menu(&menu)
        .tooltip("Shuvi Voice Companion - Push-to-Talk (Ctrl+Shift+Space)")
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_VOICE => {
                let _ = voice_tray_open_voice_companion(app.clone());
            }
            MENU_TOGGLE_MUTE => {
                if let Some(state) = app.try_state::<Arc<Mutex<VoiceTrayState>>>() {
                    let _ = voice_tray_toggle_mute(app.clone(), state);
                }
            }
            MENU_START_RECORDING => {
                let _ = emit_voice_event(app, "voice:start_recording");
            }
            MENU_STOP_RECORDING => {
                let _ = emit_voice_event(app, "voice:stop_recording");
            }
            MENU_CHECK_ENGINE => {
                let _ = emit_voice_event(app, "voice:check_engine");
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                let _ = voice_tray_open_voice_companion(tray.app_handle().clone());
            }
        })
        .build(app)?;

    Ok(())
}

/// Register the global shortcut and preserve both press and release events.
pub fn register_push_to_talk_shortcut<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(DEFAULT_PUSH_TO_TALK, |app, _shortcut, event| {
            emit_push_to_talk(app, event.state);
        })
        .map_err(|error| format!("failed to register global shortcut: {error}"))
}

#[tauri::command]
pub fn voice_tray_state(state: State<'_, Arc<Mutex<VoiceTrayState>>>) -> VoiceTrayState {
    state.lock().map(|value| value.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn voice_tray_update_state(
    state: State<'_, Arc<Mutex<VoiceTrayState>>>,
    is_recording: bool,
    engine_available: bool,
    is_muted: bool,
) -> Result<(), String> {
    let mut tray_state = state
        .lock()
        .map_err(|_| "tray state lock poisoned".to_string())?;
    tray_state.is_recording = is_recording;
    tray_state.engine_available = engine_available;
    tray_state.is_muted = is_muted;
    Ok(())
}

#[tauri::command]
pub fn voice_tray_simulate_push_to_talk<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    emit_voice_event(&app, "voice:start_recording")?;
    Ok(true)
}

#[tauri::command]
pub fn voice_tray_simulate_push_to_talk_release<R: Runtime>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    emit_voice_event(&app, "voice:stop_recording")?;
    Ok(true)
}

#[tauri::command]
pub fn voice_tray_toggle_mute<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Arc<Mutex<VoiceTrayState>>>,
) -> Result<bool, String> {
    let mut tray_state = state
        .lock()
        .map_err(|_| "tray state lock poisoned".to_string())?;
    tray_state.is_muted = !tray_state.is_muted;
    let muted = tray_state.is_muted;
    drop(tray_state);
    emit_voice_event(&app, "voice:toggle_mute")?;
    Ok(muted)
}

#[tauri::command]
pub fn voice_tray_open_voice_companion<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let window = app
        .get_webview_window("voice-companion")
        .ok_or_else(|| "voice companion window is unavailable".to_string())?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("failed to focus voice companion: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn voice_tray_check_engine<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    emit_voice_event(&app, "voice:check_engine")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_safe() {
        let state = VoiceTrayState::default();
        assert!(!state.is_recording);
        assert!(!state.engine_available);
        assert!(!state.is_muted);
    }

    #[test]
    fn shortcut_is_explicit_push_to_talk() {
        assert_eq!(DEFAULT_PUSH_TO_TALK, "CommandOrControl+Shift+Space");
    }
}
