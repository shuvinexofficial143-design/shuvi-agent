import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const capture=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const begin=core.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {");
const end=core.indexOf("ToolAction::ListProcesses => {",begin);
const action=core.slice(begin,end);
test("approved target or desktop capture -> bounded memory -> CRC -> verified deletion -> network",()=>{
 const stages=[
  "preflight_inspect_screen_vision(&provider, &prompt).await?",
  "target_window_capture::capture_window_png(&window,capture_target.as_ref())?",
  "EphemeralVisionCapture::new(path)",
  "read_file_bytes_bounded(",
  "verify_vision_png_bytes(&image_bytes)?",
  "captured.discard()?",
  "analyze_png_bytes_with_provider(&provider, &prompt, &image_bytes).await?",
  "Ok(ActionResult {"
 ];
 const positions=stages.map(x=>action.indexOf(x));
 assert.ok(positions.every(i=>i>=0),JSON.stringify(stages.map((x,i)=>[x,positions[i]])));
 assert.ok(positions.every((v,i)=>i===0||v>positions[i-1]));
 assert.doesNotMatch(action,/analyze_png_with_provider\(&provider, &prompt, captured\.path\(\)\)/);
 assert.doesNotMatch(action,/path\.display\(\)/);
});
test("the outgoing IMAGE BYTES are fully checked again after disk read",()=>{
 const wrapper=capture.slice(capture.indexOf("pub(super) fn verify_vision_png_bytes("),
  capture.indexOf("pub(super) fn verify_unbound_desktop_png("));
 assert.match(wrapper,/png_dimensions\(bytes\)/);
 assert.match(wrapper,/MAX_CAPTURE_PIXELS/);
 assert.match(wrapper,/verify_png_structure\(std::io::Cursor::new\(bytes\),bytes\.len\(\) as u64\)/);
 assert.match(capture,/in_memory_vision_upload_checks_exact_png_bytes_not_stale_disk_header/);
 for(const bad of ["crc_corrupt","secret trailing bytes","valid[..valid.len()-1]","8192_u32"])
  assert.ok(capture.includes(bad));
});
test("failure to read, CRC-check or unlink never initiates paid vision inference",()=>{
 assert.match(action,/read_file_bytes_bounded\([\s\S]*?"captured screenshot"\)\?/);
 assert.match(action,/verify_vision_png_bytes\(&image_bytes\)\?/);
 assert.match(action,/captured\.discard\(\)\?/);
 const prepare=action.indexOf("let mut captured");
 const network=action.indexOf("analyze_png_bytes_with_provider",prepare);
 assert.ok(network>action.indexOf("captured.discard()?",prepare));
 assert.match(core,/async fn analyze_png_with_provider\(/); // Other tools unchanged
});
