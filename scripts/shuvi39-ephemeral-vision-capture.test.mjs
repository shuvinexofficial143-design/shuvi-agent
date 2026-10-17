import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const guard=readFileSync(new URL("../src-tauri/src/vision_screenshot_guard.rs",import.meta.url),"utf8");
const stage=lib.slice(lib.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"),
 lib.indexOf("ToolAction::ListProcesses => {",lib.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {")));
test("vision model and prompt preflight happen before ANY screenshot capture",()=>{
 const pre=stage.indexOf("preflight_inspect_screen_vision(&provider, &prompt).await?");
 const desktop=stage.indexOf("capture_screen_png()?");
 const app=stage.indexOf("target_window_capture::capture_window_png(&window,capture_target.as_ref())?");
 assert.ok(pre>=0&&desktop>pre&&app>pre);
 const logic=lib.slice(lib.indexOf("async fn preflight_inspect_screen_vision("),
  lib.indexOf("async fn analyze_png_with_provider("));
 assert.match(logic,/chosen\.vision != Some\(true\)/);
 assert.match(logic,/list_xkiro_models\(\)\.await/);
 assert.match(logic,/prompt\.len\(\) > MAX_CHAT_MESSAGE_BYTES/);
 assert.doesNotMatch(logic,/capture_screen_png|CopyFromScreen|SetForegroundWindow/);
});
test("one-time PNG stays owned across awaited AI provider call and is unlinked before response",()=>{
 const acquire=stage.indexOf("EphemeralVisionCapture::new(path)");
 const read=stage.indexOf("read_file_bytes_bounded(",acquire);
 const verify=stage.indexOf("verify_vision_png_bytes(&image_bytes)",read);
 const cleanup=stage.indexOf("captured.discard()?",verify);
 const analyze=stage.indexOf("analyze_png_bytes_with_provider(&provider, &prompt, &image_bytes).await?",cleanup);
 const response=stage.indexOf("Ok(ActionResult {",analyze);
 assert.ok(acquire>0&&read>acquire&&verify>read&&cleanup>verify&&analyze>cleanup&&response>analyze);
 assert.doesNotMatch(stage,/path\.display\(\)/);
 assert.match(stage,/Screenshot: temporary capture deleted after analysis/);
 assert.match(guard,/pub\(super\) fn discard\(&mut self\) -> Result<\(\), String>/);
 assert.match(guard,/cleanup failed:/);
 assert.match(guard,/impl Drop for EphemeralVisionCapture/);
 assert.match(guard,/fs::remove_file\(&self\.path\)/);
 for(const t of ["disposable_screenshot_is_unlinked_after_success",
   "disposable_screenshot_is_unlinked_on_error",
   "disposable_screenshot_is_unlinked_on_task_unwind",
   "missing_capture_unlink_is_idempotent",
   "discarding_deleted_capture_is_idempotent"])
   assert.ok(guard.includes(t),t);
});
test("ephemeral image is not substituted for manual capture_screen user output",()=>{
 const manual=lib.slice(lib.indexOf("ToolAction::CaptureScreen => {"),
   lib.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"));
 assert.match(manual,/let path = capture_screen_png\(\)\?/);
 assert.doesNotMatch(manual,/EphemeralVisionCapture/);
});
