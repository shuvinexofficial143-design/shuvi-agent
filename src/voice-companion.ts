/**
 * Shuvi Voice Companion - Local voice assistant interface
 *
 * Push-to-talk only: microphone starts on user press, stops on release.
 * No background activation, no startup microphone access.
 * All audio capture is bounded in duration and payload size.
 */

import { parseCommand, type ParseResult } from './voice-command.mjs';

// ============================================================================
// Types and Constants
// ============================================================================

type VoiceState = 'idle' | 'recording' | 'processing' | 'muted' | 'error';

interface VoiceConfig {
  whisperExePath: string;
  whisperModelPath: string;
}

interface CaptureBounds {
  maxDurationMs: number;
  maxBytes: number;
}

const CAPTURE_BOUNDS: CaptureBounds = {
  maxDurationMs: 30000,
  maxBytes: 8 * 1024 * 1024,
};

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const PROCESSOR_BUFFER_SIZE = 4096;

// ============================================================================
// DOM Elements
// ============================================================================

let stateElement: HTMLElement | null = null;
let statusElement: HTMLElement | null = null;
let recordButton: HTMLElement | null = null;
let muteButton: HTMLElement | null = null;
let cancelButton: HTMLElement | null = null;
let speakButton: HTMLElement | null = null;
let transcriptElement: HTMLElement | null = null;
let intentElement: HTMLElement | null = null;

// ============================================================================
// State
// ============================================================================

let currentState: VoiceState = 'idle';
let isMuted = false;
let audioChunks: Float32Array[] = [];
let startTime: number | null = null;
let audioStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let audioProcessor: ScriptProcessorNode | null = null;
let inputSampleRate = SAMPLE_RATE;
let voiceConfig: VoiceConfig = { whisperExePath: '', whisperModelPath: '' };
let operationId = 0;
let lastTranscript = '';

// ============================================================================
// Initialization
// ============================================================================

function renderVoiceCompanionUi(): void {
  const app = document.getElementById('voice-app');
  if (!app || app.childElementCount > 0) return;

  app.innerHTML = `
    <header class="voice-header">
      <h1>Shuvi Voice Companion</h1>
      <p>Local, push-to-talk voice controls</p>
    </header>
    <section class="voice-state-container" aria-live="polite">
      <span class="state-label">State</span>
      <span id="voice-state" class="state idle">IDLE</span>
    </section>
    <p id="voice-status" class="voice-status" role="status">Checking local capabilities...</p>
    <div class="record-button-container">
      <button id="record-button" type="button" aria-label="Press and hold to record">
        <span class="record-button-icon" aria-hidden="true">●</span>
        <span class="record-button-label">Hold to talk</span>
      </button>
    </div>
    <div class="voice-actions">
      <button id="mute-button" type="button">Mute</button>
      <button id="cancel-button" type="button">Cancel</button>
      <button id="speak-button" type="button" disabled>Speak transcript</button>
    </div>
    <section class="voice-output">
      <div class="output-section"><h3>Transcript</h3><p id="transcript"></p></div>
      <div class="output-section"><h3>Intent</h3><p id="intent"></p></div>
    </section>
    <p class="voice-instructions">The microphone is requested only while you hold the record button. Nothing is uploaded by this window.</p>
  `;
}

async function initializeVoiceCompanion(): Promise<void> {
  renderVoiceCompanionUi();

  stateElement = document.getElementById('voice-state');
  statusElement = document.getElementById('voice-status');
  recordButton = document.getElementById('record-button');
  muteButton = document.getElementById('mute-button');
  cancelButton = document.getElementById('cancel-button');
  speakButton = document.getElementById('speak-button');
  transcriptElement = document.getElementById('transcript');
  intentElement = document.getElementById('intent');

  if (!stateElement || !statusElement || !recordButton || !muteButton || !cancelButton) {
    setState('error');
    updateStatus('Failed to initialize UI elements');
    return;
  }

  voiceConfig = await loadConfig();
  setupEventListeners();
  setState('idle');

  if (!navigator.mediaDevices?.getUserMedia) {
    updateStatus('Microphone capture is unavailable in this browser');
    recordButton.setAttribute('aria-disabled', 'true');
  } else {
    updateStatus('Ready - Press and hold to record');
  }

  await checkEngineStatus(voiceConfig);
}

// ============================================================================
// Configuration and capability status
// ============================================================================

async function loadConfig(): Promise<VoiceConfig> {
  try {
    const saved = localStorage.getItem('voice-config');
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isVoiceConfig(parsed)) return parsed;
    }
  } catch {
    // A missing or malformed optional local setting must not block the UI.
  }
  return { whisperExePath: '', whisperModelPath: '' };
}

function isVoiceConfig(value: unknown): value is VoiceConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.whisperExePath === 'string' && typeof candidate.whisperModelPath === 'string';
}

async function checkEngineStatus(config: VoiceConfig): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ available: boolean; reason?: string }>('voice_engine_status', {
      request: {
        whisper_exe_path: config.whisperExePath,
        whisper_model_path: config.whisperModelPath,
      },
    });

    if (result.available) {
      updateStatus('Local STT engine ready');
    } else {
      updateStatus(`Local STT unavailable: ${result.reason || 'paths not configured'}`);
    }
  } catch {
    updateStatus('Local STT unavailable in browser preview; configure whisper.cpp on Windows');
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners(): void {
  if (!recordButton || !muteButton || !cancelButton) return;

  recordButton.addEventListener('mousedown', () => { void startRecording(); });
  recordButton.addEventListener('mouseup', () => { void stopRecording(); });
  recordButton.addEventListener('mouseleave', () => { void stopRecording(); });
  recordButton.addEventListener('touchstart', () => { void startRecording(); }, { passive: true });
  recordButton.addEventListener('touchend', () => { void stopRecording(); });
  recordButton.addEventListener('touchcancel', () => { void cancelRecording(); });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target === document.body && !event.repeat) {
      event.preventDefault();
      void startRecording();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && event.target === document.body) {
      event.preventDefault();
      void stopRecording();
    }
  });

  muteButton.addEventListener('click', toggleMute);
  cancelButton.addEventListener('click', cancelRecording);
  speakButton?.addEventListener('click', () => {
    if (lastTranscript) void speakText(lastTranscript);
  });
}

// ============================================================================
// Recording Control
// ============================================================================

async function startRecording(): Promise<void> {
  if (currentState !== 'idle' || isMuted || !navigator.mediaDevices?.getUserMedia) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: CHANNELS, echoCancellation: true, noiseSuppression: true },
      video: false,
    });

    if (isMuted || currentState !== 'idle') {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    audioStream = stream;
    audioChunks = [];
    startTime = Date.now();
    audioContext = new AudioContext();
    inputSampleRate = audioContext.sampleRate;
    audioSource = audioContext.createMediaStreamSource(stream);
    audioProcessor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, CHANNELS, CHANNELS);
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;

    audioProcessor.onaudioprocess = (event) => {
      if (currentState !== 'recording') return;
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      const currentBytes = audioChunks.reduce((total, chunk) => total + chunk.length * 2, 0);
      if (currentBytes + samples.length * 2 > CAPTURE_BOUNDS.maxBytes) {
        void stopRecordingWithError('Recording exceeded size limit');
        return;
      }
      audioChunks.push(samples);
    };

    audioSource.connect(audioProcessor);
    audioProcessor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    await audioContext.resume();

    setState('recording');
    updateStatus('Recording... Release to stop');
    startRecordingTimeout();
  } catch (error) {
    cleanupCapture();
    setState('error');
    updateStatus(`Microphone access denied or unavailable: ${formatError(error)}`);
  }
}

function startRecordingTimeout(): void {
  const checkTimeout = (): void => {
    if (startTime && Date.now() - startTime >= CAPTURE_BOUNDS.maxDurationMs) {
      void stopRecordingWithError('Recording exceeded time limit');
    } else if (currentState === 'recording') {
      window.setTimeout(checkTimeout, 250);
    }
  };
  checkTimeout();
}

async function stopRecording(): Promise<void> {
  if (currentState !== 'recording') return;
  const capturedOperation = operationId;
  cleanupCapture();

  if (audioChunks.length === 0) {
    setState('idle');
    updateStatus('No audio captured');
    return;
  }

  const samples = audioChunks;
  audioChunks = [];
  setState('processing');
  updateStatus('Processing locally...');

  try {
    const wavData = encodePcmWav(samples, inputSampleRate);
    if (wavData.byteLength > CAPTURE_BOUNDS.maxBytes) throw new Error('Audio exceeds maximum size');

    const transcript = await transcribeAudio(new Uint8Array(wavData), voiceConfig);
    if (capturedOperation !== operationId) return;
    if (!transcript?.text) {
      setState('idle');
      updateStatus('Local transcription returned no text');
      return;
    }

    lastTranscript = transcript.text;
    if (transcriptElement) transcriptElement.textContent = transcript.text;
    if (speakButton) speakButton.removeAttribute('disabled');

    const intentResult = parseVoiceCommand(transcript.text);
    if (intentElement) intentElement.textContent = JSON.stringify(intentResult, null, 2);
    updateStatus(intentResult.requiresApproval
      ? `Intent requires approval: ${intentResult.intent}`
      : `Transcribed locally: ${intentResult.intent}`);
    setState('idle');
  } catch (error) {
    if (capturedOperation === operationId) {
      setState('error');
      updateStatus(`Local processing unavailable: ${formatError(error)}`);
    }
  } finally {
    startTime = null;
  }
}

async function stopRecordingWithError(message: string): Promise<void> {
  if (currentState !== 'recording') return;
  cleanupCapture();
  audioChunks = [];
  setState('error');
  updateStatus(message);
}

function cancelRecording(): void {
  operationId += 1;
  cleanupCapture();
  audioChunks = [];
  startTime = null;
  setState(isMuted ? 'muted' : 'idle');
  updateStatus('Recording cancelled; no audio was sent');
}

function cleanupCapture(): void {
  audioProcessor?.disconnect();
  audioSource?.disconnect();
  audioProcessor = null;
  audioSource = null;
  if (audioContext) void audioContext.close();
  audioContext = null;
  audioStream?.getTracks().forEach((track) => track.stop());
  audioStream = null;
}

function toggleMute(): void {
  isMuted = !isMuted;
  if (isMuted) {
    operationId += 1;
    cleanupCapture();
    audioChunks = [];
    startTime = null;
    setState('muted');
    updateStatus('Microphone muted; recording is disabled');
  } else {
    setState('idle');
    updateStatus('Microphone unmuted - ready to record');
  }
  updateMuteButton();
}

function updateMuteButton(): void {
  if (!muteButton) return;
  muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
  muteButton.classList.toggle('active', isMuted);
  muteButton.setAttribute('aria-pressed', String(isMuted));
}

// ============================================================================
// Native Integration
// ============================================================================

async function transcribeAudio(audioData: Uint8Array, config: VoiceConfig): Promise<{ text?: string } | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const base64Data = arrayBufferToBase64(audioData.buffer);
    return await invoke<{ text: string }>('voice_transcribe', {
      request: {
        wav_data: base64Data,
        whisper_exe_path: config.whisperExePath,
        whisper_model_path: config.whisperModelPath,
      },
    });
  } catch (error) {
    console.error('Transcription error:', error);
    throw error;
  }
}

async function speakText(text: string): Promise<boolean> {
  if (!text.trim() || text.length > 4096) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('voice_speak', { request: { text } });
  } catch (error) {
    updateStatus(`Local TTS unavailable: ${formatError(error)}`);
    return false;
  }
}

// ============================================================================
// Command Parsing and UI State
// ============================================================================

function parseVoiceCommand(text: string): ParseResult {
  return parseCommand(text);
}

function setState(state: VoiceState): void {
  currentState = state;
  if (stateElement) {
    stateElement.textContent = state.toUpperCase();
    stateElement.className = `state ${state}`;
  }
  recordButton?.classList.toggle('recording', state === 'recording');
  recordButton?.classList.toggle('disabled', state === 'processing' || state === 'error' || isMuted);
}

function updateStatus(message: string): void {
  if (statusElement) statusElement.textContent = message;
}

// ============================================================================
// Utilities
// ============================================================================

function encodePcmWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * 2, true);
  view.setUint16(32, CHANNELS * 2, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// Initialize on DOM load
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void initializeVoiceCompanion(); });
} else {
  void initializeVoiceCompanion();
}

export type { VoiceState, VoiceConfig, ParseResult };
export {
  CAPTURE_BOUNDS,
  initializeVoiceCompanion,
  startRecording,
  stopRecording,
  cancelRecording,
  toggleMute,
  parseVoiceCommand,
  setState,
  updateStatus,
  encodePcmWav,
  speakText,
};
