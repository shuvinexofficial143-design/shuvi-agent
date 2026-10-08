import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

function rustBlock(startNeedle, endNeedle) {
  const start = rust.lastIndexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = rust.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing end marker ${endNeedle}`);
  return rust.slice(start, end);
}

test("ui_find reports a real miss as failure instead of successful empty evidence", () => {
  const block = rustBlock("ToolAction::UiFind", "ToolAction::UiClick");
  assert.match(block, /if \(\$matches\.Count -eq 0\).*No matching UI element found/s);
});

test("ui_click has a foreground-verified physical fallback for Adobe-style controls", () => {
  const block = rustBlock("ToolAction::UiClick", "ToolAction::UiSetValue");
  assert.match(block, /InvokePattern/);
  assert.match(block, /SelectionItemPattern/);
  assert.match(block, /GetClickablePoint/);
  assert.match(block, /GetForegroundWindow/);
  assert.match(block, /foregroundPid -ne \[uint32\]\$e\.Current\.ProcessId/);
  assert.match(block, /refusing coordinate click/);
  assert.match(block, /GetSystemMetrics\(76\)/);
  assert.match(block, /GetSystemMetrics\(79\)/);
  assert.match(block, /outside the Windows virtual screen bounds/);
  assert.match(block, /if \(-not \[ShuviUiNative\]::SetCursorPos\(\$x, \$y\)\)/);
  assert.match(block, /Foreground application changed before the physical click/);
  assert.match(block, /mouse_event\(0x0002/);
  assert.match(block, /mouse_event\(0x0004/);
});

test("ui_send_keys can target a top-level window and refuses wrong foreground process", () => {
  const prepareStart = rust.indexOf('"ui_send_keys" => {');
  const prepareEnd = rust.indexOf('"pointer_click" => {', prepareStart);
  const prepare = rust.slice(prepareStart, prepareEnd);
  assert.match(prepare, /ui_selector_allow_window_only/);

  const block = rustBlock("ToolAction::UiSendKeys", "ToolAction::PointerClick");
  assert.match(block, /\$e = \$root/);
  assert.match(block, /ShowWindow/);
  assert.match(block, /BringWindowToTop/);
  assert.match(block, /GetForegroundWindow/);
  assert.match(block, /refusing keyboard fallback/);
  assert.match(block, /Foreground application changed after focus/);
  assert.match(block, /AutomationElement\]::FocusedElement/);
  assert.match(block, /Keyboard focus could not be confirmed inside the target application/);
});
