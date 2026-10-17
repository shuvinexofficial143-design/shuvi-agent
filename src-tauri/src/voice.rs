//! Voice companion native commands.
//!
//! This module provides three narrow Tauri commands for local voice processing:
//! - `voice_engine_status`: Validate whisper executable/model paths
//! - `voice_transcribe`: Transcribe bounded WAV audio using whisper.cpp
//! - `voice_speak`: Text-to-speech using Windows System.Speech
//!
//! All commands enforce bounded inputs, bounded subprocess execution,
//! and explicit failure outcomes without fabricated success.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use crate::bounded_child::collect_with_deadline;

// ============================================================================
// Constants
// ============================================================================

/// Maximum WAV file size we accept (8 MB)
const MAX_WAV_BYTES: usize = 8 * 1024 * 1024;

/// Maximum size written by one native voice operation.
const MAX_WRITE_BYTES: usize = MAX_WAV_BYTES;

/// Maximum transcription output size (1 MB)
const MAX_TRANSCRIPT_BYTES: usize = 1 * 1024 * 1024;

/// Maximum transcription deadline (30 seconds)
const TRANSCRIBE_DEADLINE: Duration = Duration::from_secs(30);

/// Maximum TTS deadline (10 seconds)
const TTS_DEADLINE: Duration = Duration::from_secs(10);

/// WAV header size (44 bytes for standard PCM WAV)
const WAV_HEADER_SIZE: usize = 44;

/// Minimum valid WAV file size
const MIN_WAV_SIZE: usize = WAV_HEADER_SIZE + 1; // Header + at least 1 byte of data

/// Temporary file prefix for voice operations
const TEMP_FILE_PREFIX: &str = "shuvi-voice-";

/// Whisper.cpp expected output file extension
const WHISPER_OUTPUT_EXT: &str = ".txt";

// ============================================================================
// Types
// ============================================================================

/// Request for engine status check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEngineStatusRequest {
    /// Absolute path to whisper.cpp executable
    pub whisper_exe_path: String,
    /// Absolute path to whisper model file
    pub whisper_model_path: String,
}

/// Response for engine status check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEngineStatusResponse {
    /// Whether the voice engine is available
    pub available: bool,
    /// Optional reason if not available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Request for transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceTranscribeRequest {
    /// Base64-encoded WAV audio data
    pub wav_data: String,
    /// Optional explicitly configured whisper executable path.
    #[serde(default)]
    pub whisper_exe_path: Option<String>,
    /// Optional explicitly configured whisper model path.
    #[serde(default)]
    pub whisper_model_path: Option<String>,
}

/// Response for transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceTranscribeResponse {
    /// Transcribed text (empty if no transcription produced)
    pub text: String,
}

/// Request for speech
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSpeakRequest {
    /// Text to speak
    pub text: String,
}

/// Maximum text length for TTS (4096 characters)
const MAX_TTS_TEXT_BYTES: usize = 4096;

// ============================================================================
// Temporary File Management
// ============================================================================

/// Generate a unique temporary file path
fn generate_temp_path(extension: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    let uuid = uuid::Uuid::new_v4();
    let filename = format!("{}{}{}", TEMP_FILE_PREFIX, uuid, extension);
    Ok(temp_dir.join(filename))
}

/// Clean up temporary file if it exists
fn cleanup_temp_file(path: &Path) {
    let _ = fs::remove_file(path);
}

// ============================================================================
// WAV Validation
// ============================================================================

/// Validate WAV file structure from raw bytes
///
/// Checks:
/// - Minimum size
/// - RIFF header
/// - WAVE format
/// - fmt chunk presence
/// - data chunk presence
/// - PCM format (1 for uncompressed)
fn validate_wav_bytes(data: &[u8]) -> Result<(), String> {
    if data.len() < MIN_WAV_SIZE {
        return Err(format!("WAV file too small: {} bytes", data.len()));
    }

    // Check RIFF header (bytes 0-3)
    let riff_header = &data[0..4];
    if riff_header != b"RIFF" {
        return Err("Invalid RIFF header".into());
    }

    // Check WAVE format (bytes 8-11)
    let wave_format = &data[8..12];
    if wave_format != b"WAVE" {
        return Err("Invalid WAVE format".into());
    }

    // Check fmt chunk (bytes 12-15)
    let fmt_chunk = &data[12..16];
    if fmt_chunk != b"fmt " {
        return Err("Missing fmt chunk".into());
    }

    // Get fmt chunk size (bytes 16-19, little-endian)
    let fmt_size = u32::from_le_bytes([data[16], data[17], data[18], data[19]]) as usize;

    // Check audio format (bytes 20-21) - should be 1 for PCM
    let audio_format = u16::from_le_bytes([data[20], data[21]]);
    if audio_format != 1 {
        return Err(format!("Unsupported audio format: {}", audio_format));
    }

    // Get number of channels (bytes 22-23)
    let num_channels = u16::from_le_bytes([data[22], data[23]]);
    if num_channels == 0 {
        return Err("Invalid number of channels".into());
    }

    // Get sample rate (bytes 24-27)
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    if sample_rate == 0 {
        return Err("Invalid sample rate".into());
    }

    // Find data chunk
    let mut pos = 12 + 8 + fmt_size; // After fmt chunk header + size + fmt data
    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;

        if chunk_id == b"data" {
            if chunk_size == 0 {
                return Err("Empty data chunk".into());
            }
            return Ok(());
        }

        pos += 8 + chunk_size;
    }

    Err("No data chunk found".into())
}

// ============================================================================
// Voice Engine Status Command
// ============================================================================

/// Check if whisper executable and model are available
///
/// Validates:
/// - Both paths exist as files
/// - Executable has proper extension (.exe on Windows)
/// - Performs a bounded read-only probe of the executable
#[tauri::command]
pub fn voice_engine_status(
    request: VoiceEngineStatusRequest,
) -> Result<VoiceEngineStatusResponse, String> {
    let whisper_exe_path = Path::new(&request.whisper_exe_path);
    let whisper_model_path = Path::new(&request.whisper_model_path);

    // Check if executable exists
    if !whisper_exe_path.exists() {
        return Ok(VoiceEngineStatusResponse {
            available: false,
            reason: Some(format!(
                "Whisper executable not found: {}",
                request.whisper_exe_path
            )),
        });
    }

    // Check if executable is a file (not a directory)
    if !whisper_exe_path.is_file() {
        return Ok(VoiceEngineStatusResponse {
            available: false,
            reason: Some(format!(
                "Whisper executable path is not a file: {}",
                request.whisper_exe_path
            )),
        });
    }

    // On Windows, check for .exe extension
    #[cfg(windows)]
    {
        if whisper_exe_path.extension().and_then(|s| s.to_str()) != Some("exe") {
            return Ok(VoiceEngineStatusResponse {
                available: false,
                reason: Some(format!(
                    "Whisper executable must have .exe extension: {}",
                    request.whisper_exe_path
                )),
            });
        }
    }

    // Check if model exists
    if !whisper_model_path.exists() {
        return Ok(VoiceEngineStatusResponse {
            available: false,
            reason: Some(format!(
                "Whisper model not found: {}",
                request.whisper_model_path
            )),
        });
    }

    // Check if model is a file
    if !whisper_model_path.is_file() {
        return Ok(VoiceEngineStatusResponse {
            available: false,
            reason: Some(format!(
                "Whisper model path is not a file: {}",
                request.whisper_model_path
            )),
        });
    }

    // Try to read first few bytes of executable to verify it's readable
    // This is a bounded read-only probe
    const PROBE_BYTES: usize = 16;
    let mut probe_buffer = vec![0u8; PROBE_BYTES];

    match File::open(whisper_exe_path) {
        Ok(mut file) => {
            use std::io::Read;
            let bytes_read = file
                .read(&mut probe_buffer)
                .map_err(|e| format!("Could not read whisper executable for probe: {}", e))?;

            if bytes_read < 2 {
                return Ok(VoiceEngineStatusResponse {
                    available: false,
                    reason: Some("Whisper executable appears to be empty or invalid".into()),
                });
            }

            // Check for common executable magic numbers
            // MZ header for Windows EXE
            if probe_buffer[0..2] != [0x4D, 0x5A] {
                return Ok(VoiceEngineStatusResponse {
                    available: false,
                    reason: Some("Whisper executable has invalid header (not a valid EXE)".into()),
                });
            }
        }
        Err(e) => {
            return Ok(VoiceEngineStatusResponse {
                available: false,
                reason: Some(format!("Could not open whisper executable: {}", e)),
            });
        }
    }

    // All checks passed
    Ok(VoiceEngineStatusResponse {
        available: true,
        reason: None,
    })
}

// ============================================================================
// Voice Transcribe Command
// ============================================================================

/// Transcribe WAV audio using whisper.cpp
///
/// Steps:
/// 1. Decode base64 WAV data
/// 2. Validate WAV structure
/// 3. Write to unique temporary file
/// 4. Invoke whisper.cpp with fixed arguments
/// 5. Read transcription output
/// 6. Clean up temporary files
/// 7. Return bounded transcript
#[tauri::command]
pub fn voice_transcribe(
    _app: tauri::AppHandle,
    request: VoiceTranscribeRequest,
) -> Result<VoiceTranscribeResponse, String> {
    // Decode base64 data
    let VoiceTranscribeRequest {
        wav_data: encoded_wav,
        whisper_exe_path,
        whisper_model_path,
    } = request;
    let wav_data = BASE64
        .decode(encoded_wav)
        .map_err(|e| format!("Failed to decode base64 WAV data: {}", e))?;

    // Validate size
    if wav_data.len() > MAX_WAV_BYTES {
        return Err(format!(
            "WAV data exceeds maximum size: {} > {} bytes",
            wav_data.len(),
            MAX_WAV_BYTES
        ));
    }

    // Validate WAV structure
    validate_wav_bytes(&wav_data)?;

    // Generate temporary file paths
    let wav_temp_path = generate_temp_path(".wav")?;
    let output_temp_path = generate_temp_path(WHISPER_OUTPUT_EXT)?;

    // Write WAV data to temporary file
    // Use bounded write
    if wav_data.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "WAV data exceeds maximum write size: {} > {} bytes",
            wav_data.len(),
            MAX_WRITE_BYTES
        ));
    }

    {
        let mut file = File::create(&wav_temp_path)
            .map_err(|e| format!("Failed to create temporary WAV file: {}", e))?;

        file.write_all(&wav_data)
            .map_err(|e| format!("Failed to write WAV data: {}", e))?;
    }

    // Use paths explicitly configured by the user when provided; otherwise inspect
    // only the bounded, documented local locations. No download or installation occurs.
    let whisper_exe = match whisper_exe_path.filter(|path| !path.trim().is_empty()) {
        Some(path) => Some(path),
        None => find_whisper_executable()?,
    };
    let whisper_model = match whisper_model_path.filter(|path| !path.trim().is_empty()) {
        Some(path) => Some(path),
        None => find_whisper_model()?,
    };

    if whisper_exe.is_none() || whisper_model.is_none() {
        // Clean up temp files
        cleanup_temp_file(&wav_temp_path);
        return Err(
            "Whisper executable or model not configured. Set paths in voice-companion settings."
                .into(),
        );
    }

    let whisper_exe = whisper_exe.unwrap();
    let whisper_model = whisper_model.unwrap();

    // Verify executable exists
    if !Path::new(&whisper_exe).exists() {
        cleanup_temp_file(&wav_temp_path);
        return Err(format!("Whisper executable not found: {}", whisper_exe));
    }

    // Verify model exists
    if !Path::new(&whisper_model).exists() {
        cleanup_temp_file(&wav_temp_path);
        return Err(format!("Whisper model not found: {}", whisper_model));
    }

    // Build whisper.cpp command
    // whisper.cpp command structure:
    // whisper.exe -m model.bin -f input.wav -o output.txt [options]
    let mut command = Command::new(whisper_exe);

    command
        .arg("-m")
        .arg(&whisper_model)
        .arg("-f")
        .arg(&wav_temp_path)
        .arg("-o")
        .arg(&output_temp_path)
        .arg("--language")
        .arg("auto")
        .arg("--threads")
        .arg("4")
        .arg("--step")
        .arg("50")
        .arg("--length")
        .arg("50")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Execute with bounded deadline
    let child = command.spawn().map_err(|e| {
        cleanup_temp_file(&wav_temp_path);
        format!("Failed to start whisper process: {}", e)
    })?;

    // Collect output with deadline
    let output = collect_with_deadline(child, TRANSCRIBE_DEADLINE).map_err(|e| {
        cleanup_temp_file(&wav_temp_path);
        cleanup_temp_file(&output_temp_path);
        format!("Whisper transcription failed: {}", e)
    })?;

    // Check if whisper succeeded (exit code 0)
    if !output.status.success() {
        cleanup_temp_file(&wav_temp_path);
        cleanup_temp_file(&output_temp_path);

        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Whisper transcription failed with exit code {:?}: {}",
            output.status.code(),
            stderr.trim()
        ));
    }

    // Read transcription output
    let transcript = fs::read_to_string(&output_temp_path).map_err(|e| {
        cleanup_temp_file(&wav_temp_path);
        cleanup_temp_file(&output_temp_path);
        format!("Failed to read whisper output: {}", e)
    })?;

    // Clean up temporary files created by this command
    cleanup_temp_file(&wav_temp_path);
    cleanup_temp_file(&output_temp_path);

    // Validate transcript size
    if transcript.len() > MAX_TRANSCRIPT_BYTES {
        return Err(format!(
            "Transcript exceeds maximum size: {} > {} bytes",
            transcript.len(),
            MAX_TRANSCRIPT_BYTES
        ));
    }

    // Return the transcript
    Ok(VoiceTranscribeResponse {
        text: transcript.trim().into(),
    })
}

/// Find whisper executable in standard locations
fn find_whisper_executable() -> Result<Option<String>, String> {
    // Check common locations
    let possible_locations = [
        // Current directory
        PathBuf::from("./whisper.cpp/whisper.exe"),
        PathBuf::from("./whisper.exe"),
        // App data directory
        get_app_data_dir()?.join("whisper.cpp/whisper.exe"),
        get_app_data_dir()?.join("whisper.exe"),
        // Program Files
        PathBuf::from("C:/Program Files/whisper.cpp/whisper.exe"),
        PathBuf::from("C:/Program Files (x86)/whisper.cpp/whisper.exe"),
    ];

    for path in possible_locations {
        if path.exists() && path.is_file() {
            return Ok(Some(path.display().to_string()));
        }
    }

    Ok(None)
}

/// Find whisper model in standard locations
fn find_whisper_model() -> Result<Option<String>, String> {
    let possible_locations = [
        // Common model names
        PathBuf::from("./whisper.cpp/ggml-base.en.bin"),
        PathBuf::from("./ggml-base.en.bin"),
        PathBuf::from("./ggml-small.en.bin"),
        PathBuf::from("./ggml-medium.en.bin"),
        // Hindi models
        PathBuf::from("./ggml-base.hi.bin"),
        PathBuf::from("./ggml-small.hi.bin"),
        // App data directory
        get_app_data_dir()?.join("whisper.cpp/ggml-base.en.bin"),
        get_app_data_dir()?.join("ggml-base.en.bin"),
    ];

    for path in possible_locations {
        if path.exists() && path.is_file() {
            return Ok(Some(path.display().to_string()));
        }
    }

    Ok(None)
}

/// Get app data directory
fn get_app_data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        std::env::var("LOCALAPPDATA")
            .map(|app_data| PathBuf::from(app_data).join("Shuvi"))
            .map_err(|e| format!("Could not get app data directory: {}", e))
    }

    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(|home| PathBuf::from(home).join(".local/share/shuvi"))
            .map_err(|e| format!("Could not get home directory: {}", e))
    }
}

// ============================================================================
// Voice Speak Command (Windows only)
// ============================================================================

/// Text-to-speech using Windows System.Speech via PowerShell
///
/// Uses PowerShell to access Windows SAPI (System.Speech)
/// Text is passed via stdin, not as command arguments
/// Bounded execution with deadline
#[tauri::command]
pub fn voice_speak(request: VoiceSpeakRequest) -> Result<bool, String> {
    // Validate text size
    if request.text.len() > MAX_TTS_TEXT_BYTES {
        return Err(format!(
            "Text exceeds maximum size: {} > {} bytes",
            request.text.len(),
            MAX_TTS_TEXT_BYTES
        ));
    }

    // Only supported on Windows
    #[cfg(not(windows))]
    {
        return Err("Text-to-speech is only supported on Windows".into());
    }

    #[cfg(windows)]
    {
        // Use PowerShell to access System.Speech
        // This avoids shell injection by using stdin for text
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-NoLogo",
                "-Command",
                r#"$speech = New-Object -TypeName System.Speech.Synthesis.SpeechSynthesizer; $speech.Speak([Console]::In.ReadToEnd())"#,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start PowerShell for TTS: {}", e))?;

        // Write text to stdin
        {
            let stdin = child.stdin.as_mut().ok_or("Failed to get stdin")?;
            use std::io::Write;
            stdin
                .write_all(request.text.as_bytes())
                .map_err(|e| format!("Failed to write text to PowerShell stdin: {}", e))?;
        }

        // Collect with deadline
        let output = collect_with_deadline(child, TTS_DEADLINE)
            .map_err(|e| format!("TTS timed out or failed: {}", e))?;

        // Check exit code
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "TTS failed with exit code {:?}: {}",
                output.status.code(),
                stderr.trim()
            ));
        }

        // Success
        Ok(true)
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_wav_bytes_too_small() {
        let data = b"RIFF";
        let result = validate_wav_bytes(data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too small"));
    }

    #[test]
    fn test_validate_wav_bytes_invalid_riff() {
        let mut data = vec![0u8; 100];
        data[0..4].copy_from_slice(b"XXXX");
        let result = validate_wav_bytes(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("RIFF"));
    }

    #[test]
    fn test_validate_wav_bytes_invalid_wave() {
        let mut data = vec![0u8; 100];
        data[0..4].copy_from_slice(b"RIFF");
        data[8..12].copy_from_slice(b"XXXX");
        let result = validate_wav_bytes(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("WAVE"));
    }

    #[test]
    fn test_validate_wav_bytes_valid_minimal() {
        // Create a minimal valid WAV header
        let mut data = vec![0u8; 100];

        // RIFF header
        data[0..4].copy_from_slice(b"RIFF");

        // File size (remaining size - 8)
        let file_size = (data.len() - 8) as u32;
        data[4..8].copy_from_slice(&file_size.to_le_bytes());

        // WAVE format
        data[8..12].copy_from_slice(b"WAVE");

        // fmt chunk
        data[12..16].copy_from_slice(b"fmt ");

        // fmt chunk size (16 bytes for PCM)
        data[16..20].copy_from_slice(&16u32.to_le_bytes());

        // Audio format (1 = PCM)
        data[20..22].copy_from_slice(&1u16.to_le_bytes());

        // Channels (1 = mono)
        data[22..24].copy_from_slice(&1u16.to_le_bytes());

        // Sample rate (44100)
        data[24..28].copy_from_slice(&44100u32.to_le_bytes());

        // Byte rate
        data[28..32].copy_from_slice(&(44100u32 * 2).to_le_bytes());

        // Block align
        data[32..34].copy_from_slice(&2u16.to_le_bytes());

        // Bits per sample
        data[34..36].copy_from_slice(&16u16.to_le_bytes());

        // data chunk
        data[36..40].copy_from_slice(b"data");

        // data chunk size
        let data_size = (data.len() - 44) as u32;
        data[40..44].copy_from_slice(&data_size.to_le_bytes());

        // Some audio data
        data[44] = 0x00;

        let result = validate_wav_bytes(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_wav_bytes_non_pcm() {
        let mut data = vec![0u8; 100];
        data[0..4].copy_from_slice(b"RIFF");
        data[8..12].copy_from_slice(b"WAVE");
        data[12..16].copy_from_slice(b"fmt ");
        data[16..20].copy_from_slice(&16u32.to_le_bytes());
        data[20..22].copy_from_slice(&3u16.to_le_bytes()); // 3 = some compressed format
        data[22..24].copy_from_slice(&1u16.to_le_bytes());
        data[24..28].copy_from_slice(&44100u32.to_le_bytes());
        data[36..40].copy_from_slice(b"data");
        data[40..44].copy_from_slice(&10u32.to_le_bytes());
        data[44] = 0x00;

        let result = validate_wav_bytes(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("audio format"));
    }

    #[test]
    fn test_engine_status_missing_executable() {
        let request = VoiceEngineStatusRequest {
            whisper_exe_path: "/nonexistent/path/whisper.exe".into(),
            whisper_model_path: "/some/model.bin".into(),
        };

        let response = voice_engine_status(request).unwrap();
        assert!(!response.available);
        assert!(response.reason.is_some());
        assert!(response.reason.unwrap().contains("not found"));
    }

    #[test]
    fn test_engine_status_missing_model() {
        let request = VoiceEngineStatusRequest {
            whisper_exe_path: "/some/whisper.exe".into(),
            whisper_model_path: "/nonexistent/model.bin".into(),
        };

        let response = voice_engine_status(request).unwrap();
        assert!(!response.available);
        assert!(response.reason.is_some());
        assert!(response.reason.unwrap().contains("not found"));
    }

    #[test]
    fn test_transcribe_empty_data() {
        let request = VoiceTranscribeRequest {
            wav_data: BASE64.encode(b""),
            whisper_exe_path: None,
            whisper_model_path: None,
        };

        // This should fail because base64 of empty is empty
        let result = voice_transcribe(tauri::AppHandle::default(), request);

        // The actual behavior depends on the base64 decode
        // but it should fail at some validation step
        assert!(result.is_err());
    }

    #[test]
    fn test_speak_empty_text() {
        let request = VoiceSpeakRequest {
            text: String::new(),
        };

        // This will pass size validation (0 <= 4096)
        // but will fail on Windows because there's nothing to speak
        // On non-Windows, it returns an error
        let result = voice_speak(request);

        #[cfg(not(windows))]
        {
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("only supported on Windows"));
        }
    }

    #[test]
    fn test_speak_oversized_text() {
        let request = VoiceSpeakRequest {
            text: "a".repeat(MAX_TTS_TEXT_BYTES + 1),
        };

        let result = voice_speak(request);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeds maximum size"));
    }

    #[test]
    fn test_transcribe_oversized_wav() {
        // Create a valid base64 string that decodes to > 8MB
        let large_data = vec![0u8; MAX_WAV_BYTES + 1];
        let request = VoiceTranscribeRequest {
            wav_data: BASE64.encode(large_data),
            whisper_exe_path: None,
            whisper_model_path: None,
        };

        let result = voice_transcribe(tauri::AppHandle::default(), request);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeds maximum size"));
    }
}
