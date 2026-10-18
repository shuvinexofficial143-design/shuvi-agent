import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function source(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('tray uses Tauri 2 tray and global shortcut APIs', async () => {
  const tray = await source('src-tauri/src/tray.rs');
  assert.match(tray, /TrayIconBuilder/);
  assert.match(tray, /global_shortcut\(\)/);
  assert.match(tray, /ShortcutState::Pressed/);
  assert.match(tray, /ShortcutState::Released/);
  assert.match(tray, /voice:start_recording/);
  assert.match(tray, /voice:stop_recording/);
  assert.match(tray, /CommandOrControl\+Shift\+Space/);
});

test('tray never starts microphone capture directly', async () => {
  const tray = await source('src-tauri/src/tray.rs');
  assert.doesNotMatch(tray, /getUserMedia|cpal|AudioContext|microphone\.start/i);
});

test('voice companion listens for native push-to-talk events', async () => {
  const voice = await source('src/voice-companion.ts');
  assert.match(voice, /listen\('voice:start_recording'/);
  assert.match(voice, /listen\('voice:stop_recording'/);
  assert.match(voice, /Ready - Press and hold to record \(or use Ctrl\+Shift\+Space\)/);
});

test('Tauri builder installs the shortcut plugin and tray during setup', async () => {
  const lib = await source('src-tauri/src/lib.rs');
  assert.match(lib, /tauri_plugin_global_shortcut::Builder::new\(\)\.build\(\)/);
  assert.match(lib, /tray::build_voice_tray\(app\.handle\(\)\)/);
  assert.match(lib, /tray::register_push_to_talk_shortcut\(app\.handle\(\)\)/);
});
