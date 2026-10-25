import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/native_uia_window_guard.rs",import.meta.url),"utf8");
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const prep=native.slice(native.indexOf("const PREPARED_CONTROL_PROBE: &str"),
 native.indexOf("// Pattern is *not* passed",native.indexOf("const PREPARED_CONTROL_PROBE: &str")));
const preflight=native.slice(native.indexOf("fn capability_preflight("),
 native.indexOf("pub(super) fn prepared_control_probe(",native.indexOf("fn capability_preflight(")));
const ix=t=>prep.indexOf(t);
test("seven typed native UIA preparation paths have a two-phase process/control identity barrier",()=>{
 const stage=core.slice(core.indexOf("fn prepare_native_uia_binding("),core.indexOf("fn stage_tool(",core.indexOf("fn prepare_native_uia_binding(")));
 for(const tool of ["ui_click","ui_set_value","ui_focus","ui_scroll","ui_toggle","ui_expand_collapse","ui_send_keys"]){
  assert.match(stage,new RegExp('"'+tool+'"'));
 }
 assert.match(stage,/native_uia_window_guard::prepared_control_probe/);
 assert.match(native,/__CAPABILITY_PREFLIGHT__/);
 assert.ok(ix("$matches = Resolve-ShuviPreparedMatches")>ix("$shuviBoundProcessStartTicks ="));
 assert.ok(ix("[int[]]$runtimeId = $control.GetRuntimeId()")>ix("$matches = Resolve-ShuviPreparedMatches"));
 assert.ok(ix("$shuviBoundControlName =")>ix("[int[]]$runtimeId ="));
 const a=ix("__CAPABILITY_PREFLIGHT__"),b=ix("$shuviPostPreflightPid ="),c=ix("$shuviPostPreflightRuntimeId ="),d=ix("$shuviFinalNativePid ="),e=ix("} | ConvertTo-Json -Compress");
 assert.ok(a>0&&b>a&&c>b&&d>c&&e>d,"two native post-preflight OS/control checks precede approval receipt");
});
test("prepare refuses recycled HWND/PID and process birth even when titles and selectors are identical",()=>{
 for(const token of ["GetWindowThreadProcessId($shuviBoundHwnd",
  "Get-Process -Id $shuviBoundPid -ErrorAction Stop",
  "$shuviPostPreflightPid -ne [uint32]$shuviBoundPid",
  "$shuviPostPreflightStartTicks -ne $shuviBoundProcessStartTicks",
  "$shuviFinalStartTicks -ne $shuviBoundProcessStartTicks",
  "$shuviFinalNativePid -ne [uint32]$shuviBoundPid",
  "No action prepared."]){
  assert.ok(prep.includes(token),token);
 }
 assert.ok((prep.match(/StartTime\.ToUniversalTime\(\)\.Ticks/g)||[]).length>=3);
});
test("exact original control identity and runtime are re-read after capability inspection",()=>{
 for(const token of ["$shuviBoundControlName","$shuviBoundAutomationId","$shuviBoundControlType",
  "$control.Current.ProcessId -ne $shuviBoundPid",
  "$control.Current.Name -cne $shuviBoundControlName",
  "$control.Current.AutomationId -cne $shuviBoundAutomationId",
  "$control.Current.ControlType.ProgrammaticName -cne $shuviBoundControlType",
  "$shuviPostPreflightRuntimeId.Count -ne $runtimeId.Count",
  "($shuviPostPreflightRuntimeId -join ',') -cne ($runtimeId -join ',')"]){
   assert.ok(prep.includes(token),token);
 }
 const output=prep.slice(prep.indexOf("[PSCustomObject]@{"),prep.indexOf("} | ConvertTo-Json -Compress"));
 for(const token of ["control_name = $shuviBoundControlName","automation_id = $shuviBoundAutomationId",
   "control_type = $shuviBoundControlType","runtime_id = [int[]]$runtimeId"])
  assert.ok(output.includes(token),token);
 assert.doesNotMatch(output,/= \[string\]\$control.Current\./);
});
test("native prepare refuses hidden, minimized, disabled, offscreen owner and control after preflight",()=>{
 for(const token of ["IsWindowVisible($shuviBoundHwnd)","IsIconic($shuviBoundHwnd)",
   "$root.Current.NativeWindowHandle -ne","$root.Current.IsEnabled",
   "$root.Current.IsOffscreen","$control.Current.IsEnabled","$control.Current.IsOffscreen"]){
  assert.ok(prep.includes(token),token);
 }
 assert.match(prep,/No action prepared/);
});
test("preparation and capabilities remain read-only, exact native executor separately owns mutations",()=>{
 for(const source of [prep,preflight]){
  for(const bad of [/\.Invoke\s*\(/i,/\.SetValue\s*\(/i,/\.Toggle\s*\(/i,
   /\.SetFocus\s*\(/i,/SendWait\s*\(/i,/SetForegroundWindow\s*\(/i])
   assert.doesNotMatch(source,bad);
 }
 const exec=native.slice(native.indexOf("const NATIVE_CONTROL_EXECUTION_GUARD:"),
  native.indexOf("pub(super) fn guarded_mutation_root("));
 assert.match(exec,/Assert-ShuviNativeTarget/);
 assert.match(exec,/\$shuviLiveStartTicks -ne \$shuviExpectedProcessStartTicks/);
});
