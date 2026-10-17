import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("inspect_screen binds OS-derived HWND/PID/process generation before staged owner approval",()=>{
 const stage=core.slice(core.indexOf("fn stage_tool("),core.indexOf("fn now_ms(",core.indexOf("fn stage_tool(")));
 const native=stage.indexOf("let capture_target = match &action");
 const probe=stage.indexOf("target_window_capture::prepare_window_capture(window)",native);
 const approval=stage.indexOf("let id = Uuid::new_v4()",probe);
 const insert=stage.indexOf("capture_target,",approval);
 assert.ok(native>0&&probe>native&&approval>probe&&insert>approval);
 assert.match(core,/capture_target: Option<target_window_capture::PreparedCaptureTarget>/);
 assert.equal((core.match(/capture_target:None/g)||[]).length,3,
  "three non-screenshot inner PendingActions must have no screenshot authority");
});
test("Rust executes screenshot only for its original approved prepared native target",()=>{
 const exec=core.slice(core.indexOf("async fn execute_tool_with_action_id("),
  core.indexOf("        ToolAction::ListProcesses => {",core.indexOf("async fn execute_tool_with_action_id(")));
 assert.match(exec,/let capture_target = action.capture_target.clone\(\)/);
 assert.match(exec,/target_window_capture::capture_window_png\(&window,capture_target\.as_ref\(\)\)/);
 assert.match(rust,/Screenshot action was not bound to a Windows HWND\/PID before approval/);
 assert.match(rust,/target\.title\.is_empty\(\)/);
 assert.match(rust,/\$title -cne \$shuviExpectedCaptureTitle/);
 assert.match(rust,/parse_prepared_capture\(proof,"Premiere"\)\.is_ok\(\)/);
 assert.match(rust,/Window target changed after owner approval/);
 assert.match(rust,/Approved app process generation changed before screenshot/);
});
test("native identity is captured by a nonmutating OS-attested UIA probe, never by model arguments",()=>{
 const start=rust.indexOf("pub(super) fn prepare_window_capture(");
 const stop=rust.indexOf("#[cfg(not(target_os = \"windows\"))]",start);
 const src=rust.slice(start,stop);
 for(const value of ["readonly_window_attestation_script","Assert-ShuviObservedWindow",
   "run_hidden_powershell","parse_prepared_capture(text,window)","process_start_ticks=[int64]$shuviReadStartTicks"])
   assert.ok(src.includes(value),value);
 for(const unsafe of [/SetForegroundWindow\s*\(/,/CopyFromScreen\s*\(/,/SendWait\s*\(/,/\.SetFocus\s*\(/])
   assert.doesNotMatch(src,unsafe);
});
test("native screenshot binding expires at 60 seconds, but not ordinary actions",()=>{
 assert.match(rust,/PREPARED_CAPTURE_TTL_MS: u64 = 60_000/);
 assert.match(rust,/target\.is_some\(\) &&/);
 const call=core.indexOf("target_window_capture::expired_capture_binding(");
 assert.ok(call>0&&core.slice(call,call+145).includes("prepared.capture_target.as_ref()"));
 assert.match(rust,/capture_identity_expires_after_one_minute_without_affecting_other_tools/);
});
test("execution PowerShell refuses recycled HWND, title, PID and process generation",()=>{
 const begin=rust.indexOf("__SHUVI_ROOT_SCRIPT__");
 const end=rust.indexOf("$previous = [ShuviTargetCaptureWin32]::GetForegroundWindow()",begin);
 const code=rust.slice(begin,end);
 for(const token of ["__SHUVI_APPROVED_HWND__","__SHUVI_APPROVED_PID__",
   "__SHUVI_APPROVED_BIRTH__","__SHUVI_APPROVED_TITLE__",
   "$uiPid -ne [int]$shuviExpectedCapturePid",
   "$title -cne $shuviExpectedCaptureTitle",
   "$shuviCaptureStartTicks -ne $shuviExpectedCaptureStartTicks"]){
   assert.ok(code.includes(token),token);
 }
 assert.match(rust,/\.replace\("__SHUVI_APPROVED_HWND__", &target\.hwnd\.to_string\(\)\)/);
 assert.match(rust,/\.replace\("__SHUVI_APPROVED_TITLE__", &ps_single_quote\(&target\.title\)\)/);
});
