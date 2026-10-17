import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const core=get("../src-tauri/src/lib.rs");
const capture=get("../src-tauri/src/target_window_capture.rs");
const native=get("../src-tauri/src/native_uia_window_guard.rs");
const scope=get("../docs/SHUVI39_CODING_SCOPE.md");
test("native discovery, owner-prepared seven UI action variants and readback remain present",()=>{
 for(const marker of ["ToolAction::UiWindows","ToolAction::UiDiscover","ToolAction::UiFind",
  "ToolAction::UiClick","ToolAction::UiSetValue","ToolAction::UiFocus",
  "ToolAction::UiScroll","ToolAction::UiToggle",
  "ToolAction::UiExpandCollapse","ToolAction::UiSendKeys",
  "prepare_native_uia_binding("])
  assert.ok(core.includes(marker),marker);
 assert.match(native,/PREPARED_CONTROL_PROBE/);
 assert.match(native,/NATIVE_CONTROL_EXECUTION_GUARD/);
});
test("image source gates enforce identity, PNG validation and delete-before-upload",()=>{
 for(const marker of ["prepare_window_capture(window)","expired_capture_binding(",
  "capture_window_png(&window,capture_target.as_ref())",
  "preflight_inspect_screen_vision(","verify_vision_png_bytes(&image_bytes)",
  "captured.discard()?","analyze_png_bytes_with_provider(&provider, &prompt, &image_bytes).await?"])
  assert.ok(core.includes(marker),marker);
 for(const marker of ["GetAncestor($hit, [uint32]2)","verify_png_structure(",
  "validate_vision_capture_directory(","is_owned_vision_capture_name(",
  "FILE_ATTRIBUTE_REPARSE_POINT"])
  assert.ok(capture.includes(marker),marker);
});
test("finite source coding scope explicitly excludes live Windows acceptance",()=>{
 for(const marker of ["coding completion only","LIVE acceptance",
  "Adobe/Blender live acceptance","local-uia-fixture.ps1","Draft PR #17"])
  assert.ok(scope.includes(marker),marker);
});
