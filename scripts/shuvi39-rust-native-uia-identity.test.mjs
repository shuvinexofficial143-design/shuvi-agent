import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const core=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const guard=readFileSync(new URL("../src-tauri/src/native_uia_window_guard.rs",import.meta.url),"utf8");
const from=core.indexOf("        ToolAction::UiClick { name, automation_id, window } => {");
const to=core.indexOf("        ToolAction::PointerClick {",from);
assert.ok(from>0&&to>from,"expected typed native UIA executor boundaries");
const mutation=core.slice(from,to);

test("seven actual native UIA mutation tools use execution-time identity guard",()=>{
 assert.match(core,/mod native_uia_window_guard;/);
 assert.equal((mutation.match(/native_uia_window_guard::guarded_mutation_root\(/g)||[]).length,7);
 assert.equal((mutation.match(/Assert-ShuviNativeTarget -root \$root -element \$e/g)||[]).length,8);
 for(const arm of ["UiClick","UiSetValue","UiFocus","UiScroll","UiToggle","UiExpandCollapse","UiSendKeys"]){
  const begin=mutation.indexOf("ToolAction::"+arm+" {");
  assert.ok(begin>=0,arm+" arm missing");
  const next=mutation.indexOf("        ToolAction::",begin+4);
  const body=mutation.slice(begin,next<0?mutation.length:next);
  assert.match(body,/guarded_mutation_root\(/,arm+" window guard missing");
  assert.match(body,/Assert-ShuviNativeTarget -root \$root -element \$e/,arm+" target binding missing");
 }
});
test("Win32 validates HWND, native process, visibility and UIA element ownership",()=>{
 assert.match(guard,/GetWindowThreadProcessId/);
 assert.match(guard,/IsWindowVisible/);
 assert.match(guard,/IsIconic/);
 assert.match(guard,/\$nativePid -ne \[uint32\]\$shuviExpectedPid/);
 assert.match(guard,/\$root\.Current\.NativeWindowHandle -ne/);
 assert.match(guard,/\$element\.Current\.ProcessId -ne/);
 assert.match(guard,/\$element\.Current\.IsOffscreen/);
 assert.match(guard,/No UI mutation sent/);
});
test("keyboard fallback cannot send to the foreground approval UI",()=>{
 const begin=mutation.indexOf("ToolAction::UiSendKeys {");
 const send=mutation.slice(begin);
 const focus=send.indexOf("$e.SetFocus()");
 const recheck=send.indexOf("Assert-ShuviNativeTarget -root $root -element $e -requireForeground");
 const keySend=send.indexOf("[System.Windows.Forms.SendKeys]::SendWait");
 assert.ok(focus>=0&&recheck>focus&&keySend>recheck);
 assert.match(guard,/GetForegroundWindow\(\) -ne \$shuviExpectedHwnd/);
});
test("no desktop-root or empty window is accepted for approved mutations",()=>{
 assert.match(guard,/window\s*\.map\(str::trim\)/);
 assert.match(guard,/window\.eq_ignore_ascii_case\("desktop"\)/);
 assert.match(guard,/UI mutation cannot target desktop/);
 assert.match(guard,/window\.chars\(\)\.any\(char::is_control\)/);
});
test("read-only window discovery remains available separately from mutation lease",()=>{
 const read=core.slice(core.indexOf("ToolAction::UiDiscover { window } => {",550000),from);
 assert.match(read,/let root_script = ui_root_script\(Some\(&window\)\)/);
 assert.doesNotMatch(read,/guarded_mutation_root/);
 assert.match(read,/IsOffscreen=\[bool\]\$e\.Current\.IsOffscreen/);
});
test("native guard remains inside original permissioned execute path",()=>{
 assert.match(core,/ToolAction::UiClick/);
 assert.match(core,/ToolAction::UiSendKeys/);
 assert.match(core,/fn ui_root_script\(/);
 assert.match(core,/fn run_hidden_powershell\(/);
 assert.doesNotMatch(guard,/SetForegroundWindow\(/);
 assert.doesNotMatch(guard,/SendWait\(/);
});
