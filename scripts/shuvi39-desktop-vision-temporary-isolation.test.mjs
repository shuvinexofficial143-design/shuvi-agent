import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const target=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const manual=core.slice(core.indexOf("ToolAction::CaptureScreen => {"),
 core.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"));
const visual=core.slice(core.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"),
 core.indexOf("ToolAction::ListProcesses => {",core.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {")));
const capture=core.slice(core.indexOf("fn capture_screen_png()"),
 core.indexOf("async fn preflight_inspect_screen_vision("));

test("explicit desktop vision emits ephemeral vision- PNG directly, never a saved screen-*",()=>{
 assert.match(manual,/let path = capture_screen_png\(\)\?/);
 assert.match(visual,/capture_vision_desktop_png\(\)\?/);
 assert.doesNotMatch(visual,/capture_screen_png\(\)\?/);
 const split=capture.indexOf("fn capture_screen_png_with_mode(ephemeral: bool)");
 const name=capture.indexOf("let path = dir.join(if ephemeral {",split);
 const vision=capture.indexOf('format!("vision-{}-{}.png"',name);
 const user=capture.indexOf('format!("screen-{}-{}.png"',vision);
 assert.ok(split>0&&name>split&&vision>name&&user>vision);
 assert.match(capture,/fn capture_screen_png\(\) -> Result<[^]*?capture_screen_png_with_mode\(false\)/);
 assert.match(capture,/fn capture_vision_desktop_png\(\) -> Result<[^]*?capture_screen_png_with_mode\(true\)/);
});
test("vision does not run manual screenshot quota pruning and old vision leftovers use existing stale-only cleanup",()=>{
 const mode=capture.indexOf("fn capture_screen_png_with_mode(ephemeral: bool)");
 const conditional=capture.indexOf("if !ephemeral {",mode);
 const pruning=capture.indexOf("prune_screenshot_dir(&dir",conditional);
 const naming=capture.indexOf("let path = dir.join(",pruning);
 assert.ok(conditional>mode&&pruning>conditional&&naming>pruning);
 const separate=capture.indexOf("fn capture_vision_desktop_png(");
 const scavenger=capture.indexOf("scavenge_old_vision_capture_files()",separate);
 assert.ok(scavenger>separate&&scavenger<mode);
 assert.match(target,/pub\(super\) fn scavenge_old_vision_capture_files\(\) -> Result<usize, String>/);
 assert.match(target,/prune_stale_vision_captures\(&directory\)/);
 assert.match(target,/elapsed >= STALE_VISION_CAPTURE_AGE/);
 assert.match(target,/name\.starts_with\("vision-"\)/);
 assert.match(target,/kind\.is_file\(\)/);
});
test("new desktop vision PNG is still validated, removed before network upload, never returned on disk",()=>{
 const returned=capture.indexOf("if let Err(error)=target_window_capture::verify_unbound_desktop_png(&path)");
 const ready=capture.indexOf("return Ok(path)",returned);
 assert.ok(returned>0&&ready>returned);
 const created=visual.indexOf("EphemeralVisionCapture::new(path)");
 const bounded=visual.indexOf("read_file_bytes_bounded(",created);
 const verify=visual.indexOf("verify_vision_png_bytes(&image_bytes)",bounded);
 const unlink=visual.indexOf("captured.discard()?",verify);
 const paid=visual.indexOf("analyze_png_bytes_with_provider(",unlink);
 assert.ok(created>0&&bounded>created&&verify>bounded&&unlink>verify&&paid>unlink);
 assert.doesNotMatch(visual,/path\.display\(\)/);
});
