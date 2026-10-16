import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {observedWindowInventory, checkObservedMutationTarget} from "../web-dashboard/src/native-window-target-guard.mjs";
import {invalidatesObservedWindows} from "../web-dashboard/src/native-ui-snapshot-lifetime.mjs";

const capture=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const inventory=(rows)=>observedWindowInventory({
  tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify(rows)
},true);
const win=(name,pid,handle,process)=>({
  Name:name,ProcessId:pid,NativeWindowHandle:handle,ProcessName:process
});
const action=(window)=>({tool:"ui_click",arguments:{window}});

test("Shuvi foreground cannot replace explicitly selected target and no desktop fallback exists",()=>{
  assert.match(capture,/ui_root_script\(Some\(window\)\)/);
  assert.match(capture,/GetWindowThreadProcessId\(\$target/);
  assert.match(capture,/GetForegroundWindow\(\) -ne \$target/);
  assert.match(capture,/Target identity changed after focus/);
  assert.match(capture,/Target moved or changed identity during capture/);
  assert.doesNotMatch(capture,/capture_screen_png\(/);
});

test("target capture does not silently restore minimized app or ignore foreign overlays",()=>{
  assert.match(capture,/Target window minimized or hidden/);
  assert.doesNotMatch(capture,/ShowWindow\(\$target/);
  assert.match(capture,/WindowFromPoint\(\$point\)/);
  assert.match(capture,/Foreign process occludes target/);
  assert.match(capture,/No screenshot sent/);
});

test("physical monitor bounds and PNG metadata must match verified capture",()=>{
  assert.match(capture,/SetThreadDpiAwarenessContext\(\[IntPtr\]::new\(-4\)\)/);
  assert.match(capture,/SetThreadDpiAwarenessContext\(\$previousDpi\)/);
  assert.match(capture,/VirtualScreen/);
  assert.match(capture,/\$desktop.Contains\(\$bounds\)/);
  assert.match(capture,/fn png_dimensions\(/);
  assert.match(capture,/verify_capture_receipt\(&receipt, &header, size\)/);
  assert.match(capture,/fs::remove_file\(&path\)/);
});

test("premiere target remains unique when Shuvi approval UI is foreground",()=>{
  const observed=inventory([
    win("Shuvi - Allow once",300,100,"Shuvi"),
    win("Adobe Premiere Pro 2026",500,200,"Adobe Premiere Pro")
  ]);
  assert.equal(checkObservedMutationTarget(action("Adobe Premiere Pro 2026"),observed).allowed,true);
  assert.equal(checkObservedMutationTarget(action("Shuvi - Allow once"),observed).allowed,true);
  assert.equal(checkObservedMutationTarget(action("Premiere"),observed).allowed,false);
  // Window choice is explicit; permissions are still enforced by the native action journal.
});

test("duplicate title, contradictory process and invalid inventory cannot ground mutation",()=>{
  const duplicated=inventory([
    win("Adobe Premiere Pro",500,200,"Premiere"),
    win("Adobe Premiere Pro",501,201,"Premiere")
  ]);
  assert.equal(checkObservedMutationTarget(action("Adobe Premiere Pro"),duplicated).allowed,false);
  const contradictory=inventory([win("Adobe Premiere Pro",500,200,"Blender")]);
  assert.equal(checkObservedMutationTarget(action("Adobe Premiere Pro"),contradictory).allowed,false);
  const malformed=inventory([win("Adobe Premiere Pro",500,200,"Premiere"),win("bad",0,0,"")]);
  assert.deepEqual(malformed,[]);
  assert.equal(checkObservedMutationTarget(action("Adobe Premiere Pro"),malformed).allowed,false);
});

test("UI mutations invalidate a prior window snapshot; subsequent action requires refresh",()=>{
  assert.equal(invalidatesObservedWindows("ui_click"),true);
  assert.equal(invalidatesObservedWindows("ui_set_value"),true);
  assert.equal(invalidatesObservedWindows("ui_windows"),false);
  assert.equal(checkObservedMutationTarget(action("Adobe Premiere Pro"),[]).allowed,false);
});

test("selected-screen capture binds original process birth time before focus",()=>{
 const start=capture.indexOf("$shuviCaptureProcess = Get-Process -Id $uiPid");
 const verify=capture.indexOf("Assert-ShuviCaptureProcessGeneration",start+5);
 const focus=capture.indexOf("SetForegroundWindow($target)");
 assert.ok(start>0&&verify>start&&focus>verify);
 assert.match(capture,/StartTime\.ToUniversalTime\(\)\.Ticks/);
 assert.match(capture,/Application process restarted during window capture/);
});
test("screenshot checks process-generation before PNG write and after focus",()=>{
 const start=capture.indexOf("if (-not $focused)");
 const afterFocus=capture.indexOf("Assert-ShuviCaptureProcessGeneration",start);
 const copy=capture.indexOf("CopyFromScreen(");
 const afterCopy=capture.indexOf("Assert-ShuviCaptureProcessGeneration",copy);
 const save=capture.indexOf("$bitmap.Save(");
 assert.ok(start>=0&&afterFocus>start&&copy>afterFocus&&afterCopy>copy&&save>afterCopy);
 assert.match(capture,/GetWindowThreadProcessId\(\$target, \[ref\]\$pidAfterCopy\)/);
 assert.match(capture,/GetForegroundWindow\(\) -ne \$target/);
});
test("unknown process birth time fails closed rather than sending another app screenshot",()=>{
 assert.match(capture,/Cannot establish original app process start time; no screenshot sent/);
 assert.match(capture,/Captured application process exited; no screenshot sent/);
 assert.match(capture,/Invalid app process generation; no screenshot sent/);
 assert.doesNotMatch(capture,/Start-Process -FilePath/);
});
