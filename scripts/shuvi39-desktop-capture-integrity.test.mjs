import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const verifier=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const src=rust.slice(rust.indexOf("fn capture_screen_png()"),
 rust.indexOf("async fn preflight_inspect_screen_vision("));
test("desktop screenshot enforces raw pixel budget before allocating unmanaged GDI bitmap",()=>{
 const bounds=src.indexOf("$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen");
 const guard=src.indexOf("([int64]$bounds.Width * [int64]$bounds.Height) -gt 36864000",bounds);
 const allocation=src.indexOf("New-Object System.Drawing.Bitmap $bounds.Width",bounds);
 assert.ok(bounds>=0&&guard>bounds&&allocation>guard);
 assert.match(src,/try \\{\\{/);
 assert.match(src,/finally \\{\\{/);
});
test("manual desktop capture and desktop vision validate original PNG structure before release",()=>{
 const exec=src.indexOf("let output = match run_hidden_powershell(&script)");
 const deleteOnLaunch=src.indexOf("fs::remove_file(&path)",exec);
 const checksum=src.indexOf("target_window_capture::verify_unbound_desktop_png(&path)",deleteOnLaunch);
 const end=src.indexOf("return Ok(path)",checksum);
 assert.ok(exec>0&&deleteOnLaunch>exec&&checksum>deleteOnLaunch&&end>checksum);
 const verify=verifier.slice(verifier.indexOf("pub(super) fn verify_unbound_desktop_png("),
   verifier.indexOf("fn verify_capture_receipt("));
 assert.match(verify,/png_dimensions\\(&header\\)/);
 assert.match(verify,/verify_png_structure\\(fs::File::open\\(path\\)/);
 assert.match(verify,/MAX_CAPTURE_PIXELS/);
 assert.match(verifier,/desktop_png_verification_rejects_corruption_and_accepts_bounded_container/);
});
test("manual capture_screen retains path while inspect_screen remains temporary by default",()=>{
 const manual=rust.slice(rust.indexOf("ToolAction::CaptureScreen => {"),
   rust.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"));
 assert.match(manual,/Screenshot saved to \\{\\}/);
 assert.match(manual,/let path = capture_screen_png\\(\\)\\?/);
 const visual=rust.slice(rust.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {"),
  rust.indexOf("ToolAction::ListProcesses => {",rust.indexOf("ToolAction::InspectScreen { prompt, provider, window } => {")));
 assert.match(visual,/EphemeralVisionCapture::new\\(path\\)/);
 assert.match(visual,/captured\\.discard\\(\\)\\?/);
});
