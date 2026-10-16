import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const guard=readFileSync(new URL("../src-tauri/src/native_uia_window_guard.rs",import.meta.url),"utf8");
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("native preparation binds the actual process creation time to observed HWND and PID",()=>{
 const start=guard.indexOf("const PREPARED_CONTROL_PROBE");
 const stop=guard.indexOf("fn capability_preflight(",start);
 const src=guard.slice(start,stop);
 const before=src.indexOf("GetWindowThreadProcessId($shuviBoundHwnd");
 const process=src.indexOf("StartTime.ToUniversalTime().Ticks");
 const after=src.indexOf("GetWindowThreadProcessId($shuviBoundHwnd",before+10);
 assert.ok(before>=0&&process>before&&after>process,"OS process evidence must be bracketed by HWND/PID read checks");
 assert.match(src,/Get-Process -Id \$shuviBoundPid -ErrorAction Stop/);
 assert.match(src,/process_start_ticks = \[int64\]\$shuviBoundProcessStartTicks/);
});
test("Rust preserves 64-bit OS process birth ticks within its private prepared action",()=>{
 assert.match(guard,/process_start_ticks: i64/);
 assert.match(guard,/v.get\("process_start_ticks"\).and_then\(Value::as_i64\)/);
 assert.match(guard,/process_start_ticks <= 0/);
 assert.match(guard,/process_start_ticks,/);
 assert.match(core,/native_uia_target: Option<native_uia_window_guard::NativeUiaTarget>/);
 assert.match(core,/let native_uia_target = prepare_native_uia_binding\(&action\)/);
 assert.doesNotMatch(core.slice(core.indexOf("fn prepare_native_uia_binding("),core.indexOf("fn stage_tool(")),/"expected_process_start_ticks"/);
});
test("execution rejects same numeric HWND/PID after application restart",()=>{
 const start=guard.indexOf("const NATIVE_CONTROL_EXECUTION_GUARD");
 const end=guard.indexOf("pub(super) fn guarded_mutation_root(",start);
 const src=guard.slice(start,end);
 assert.match(src,/Get-Process -Id \(\[int\]\$shuviExpectedPid\)/);
 assert.match(src,/\$shuviLiveStartTicks -ne \$shuviExpectedProcessStartTicks/);
 assert.match(src,/Application process restarted after approval\. No UI mutation sent\./);
 assert.match(guard,/\$shuviExpectedProcessStartTicks = \[int64\]\{\}/);
});
test("seven native mutation paths use same OS-bound private prepared token",()=>{
 const start=core.indexOf("        ToolAction::UiClick { name, automation_id, window } => {");
 const stop=core.indexOf("        ToolAction::PointerClick {",start);
 assert.ok(start>0&&stop>start);
 const section=core.slice(start,stop);
 assert.equal((section.match(/native_uia_target\.as_ref\(\)/g)||[]).length,7);
 assert.ok((section.match(/Assert-ShuviNativeTarget -root \$root -element \$e/g)||[]).length>=8);
});
test("refusal is no side-effect, not an invitation to retry a possibly executed action",()=>{
 const src=guard.slice(guard.indexOf("const NATIVE_CONTROL_EXECUTION_GUARD"));
 assert.match(src,/No UI mutation sent/);
 assert.doesNotMatch(src,/SetForegroundWindow\(/);
 assert.doesNotMatch(src,/SendWait\(/);
});
