import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const path=new URL("./shuvi39-windows-uia-readonly-diagnostics.ps1",import.meta.url);
const source=readFileSync(path,"utf8");

test("diagnostic is explicit-target and opt-in, never wired as a native AI tool",()=>{
 assert.match(source,/\[Parameter\(Mandatory = \$true\)\]/);
 assert.match(source,/\[string\]\$WindowName/);
 assert.match(source,/\$matches\.Count -ne 1/);
 assert.match(source,/OrdinalIgnoreCase/);
 assert.match(source,/Run manually only with owner consent/);
 const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.doesNotMatch(native,/shuvi39-windows-uia-readonly-diagnostics\.ps1/);
});
test("diagnostic never contains mutation, keyboard, launch or filesystem write commands",()=>{
 const forbidden=[
  /\.SetFocus\s*\(/i,/\.Invoke\s*\(/i,/\.Select\s*\(/i,
  /\.Toggle\s*\(/i,/\.SetValue\s*\(/i,/SendWait\s*\(/i,
  /SetForegroundWindow\s*\(/i,/SetCursorPos\s*\(/i,
  /Start-Process\b/i,/New-Item\b/i,/Set-Content\b/i,
  /Out-File\b/i,/Invoke-Expression\b/i,/iex\s/i
 ];
 for(const rx of forbidden)assert.doesNotMatch(source,rx);
});
test("native window observation crosschecks real Win32 PID visibility minimized and monitor DPI",()=>{
 for(const marker of ["GetWindowThreadProcessId","IsWindowVisible","IsIconic",
  "MonitorFromWindow","GetDpiForWindow","$nativePid -ne $pid",
  "NativeWindowHandle"])assert.ok(source.includes(marker),marker);
});
test("traversal and output are bounded, private by default and no raw window labels leak",()=>{
 assert.match(source,/\[ValidateRange\(1,32\)\]/);
 assert.match(source,/\$maxVisited = 256/);
 assert.match(source,/\$siblings -lt 16/);
 assert.match(source,/\$entry\.Depth -ge 8/);
 assert.match(source,/Get-LabelFingerprint/);
 assert.match(source,/SHA256/);
 assert.match(source,/if \(\$IncludeNames\.IsPresent\)/);
 assert.match(source,/schema = 'shuvi39\.uia\.readonly\.v1'/);
 assert.match(source,/target_title = \(Get-SafeLabel \$WindowName\)/);
 assert.match(source,/name = Get-SafeLabel \$name/);
 assert.match(source,/automation_id = Get-SafeLabel \$automationId/);
});
test("read-only diagnostic emits control state without authorizing any state change",()=>{
 for(const marker of ["keyboard_focusable","offscreen","enabled",
  "runtime_id_length","app_modal","app_enabled","app_offscreen","dpi"])
   assert.ok(source.includes(marker),marker);
 assert.doesNotMatch(source,/function\s+Approve/i);
});
