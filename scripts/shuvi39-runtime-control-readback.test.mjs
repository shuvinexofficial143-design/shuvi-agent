import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation,parseRuntimeId,observedControlRuntimeId} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,checkPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";

const TITLE="Adobe Premiere Pro",TIME=10_000;
const windowRead=(hwnd=407,pid=88)=>({tool:"ui_windows",success:true,exit_code:0,
 stdout:JSON.stringify([{Name:TITLE,ProcessName:"Premiere",ProcessId:pid,NativeWindowHandle:hwnd}])});
const windows=()=>newAuditedWindowObservation(windowRead(),"action-1",TIME);
const original={Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
 IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:407,ObservedWindowPid:88,
 ControlRuntimeId:[42,-1,77]};
const observe=(row=original)=>({tool:"ui_discover",success:true,exit_code:0,
 stdout:JSON.stringify([row])});
const selected={tool:"ui_click",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const read={tool:"ui_find",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const readResponse=(row=original)=>({tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(row)});
const setup=()=>{
 const w=windows();
 const c=newAuditedControlObservation(observe(),"action-2",TITLE,w,TIME+1000);
 assert.ok(w);assert.ok(c);
 const p=newPendingUiReadback("action-3",selected,w,TIME+2000,c);
 return {w,c,p};
};

test("real bounded i32 RuntimeIds keep order, signs and immutable clone",()=>{
 const x=[22,-2147483648,2147483647],a=parseRuntimeId(x);
 assert.deepEqual(a,x);assert.ok(Object.isFrozen(a));
 x[0]=99;assert.equal(a[0],22);
 for(const bad of [null,undefined,[],[1.25],["1"],[2147483648],[-2147483649],
  [Number.NaN],[Number.POSITIVE_INFINITY],Array.from({length:65},(_,i)=>i)]){
  assert.equal(parseRuntimeId(bad),null);
 }
});
test("audited pre-action control snapshot binds exact native RuntimeId",()=>{
 const {w,c,p}=setup();
 assert.deepEqual(observedControlRuntimeId(selected,c,w,TIME+2000),[42,-1,77]);
 assert.deepEqual(p.controlRuntimeId,[42,-1,77]);
 assert.equal(checkPendingUiReadback(selected,p).allowed,false);
 assert.equal(auditUiReadback(p,read,readResponse(),w,TIME+3000),null);
});
test("same HWND, PID, name and AutomationId cannot replace runtime identity",()=>{
 const {w,p}=setup();
 for(const bad of [[42,-1,78],[42,-1],[42,-1,77,8],[9,-1,77],
  undefined,[],[42,-1,"77"],[99999999999]]) {
  const row={...original,ControlRuntimeId:bad};
  assert.equal(auditUiReadback(p,read,readResponse(row),w,TIME+3000),p);
 }
});
test("malformed Rust UIA runtime evidence invalidates the entire discovery",()=>{
 const w=windows();
 for(const bad of [[],["1"],[2147483648],Array.from({length:65},(_,i)=>i)]) {
  const observed=newAuditedControlObservation(observe({...original,ControlRuntimeId:bad}),
   "action-2",TITLE,w,TIME+1000);
  assert.equal(observed,null);
 }
});
test("changed HWND or PID cannot clear runtime-bound native readback",()=>{
 const {p}=setup();
 for(const [hwnd,pid] of [[408,88],[407,99]]) {
  const newer=newAuditedWindowObservation(windowRead(hwnd,pid),"action-4",TIME+2500);
  const row={...original,ObservedWindowHwnd:hwnd,ObservedWindowPid:pid};
  assert.equal(auditUiReadback(p,read,readResponse(row),newer,TIME+3000),p);
 }
});
test("duplicate matching runtime controls cannot clear independently audited readback",()=>{
 const {w,p}=setup();
 const rows={tool:"ui_discover",success:true,exit_code:0,
  stdout:JSON.stringify([original,original])};
 assert.equal(auditUiReadback(p,{tool:"ui_discover",arguments:{window:TITLE}},rows,w,TIME+3000),p);
});
test("UIA readback without earlier audited control inventory cannot manufacture RuntimeId",()=>{
 const w=windows(),p=newPendingUiReadback("action-3",selected,w,TIME+2000);
 assert.equal(p.controlRuntimeId,null);
 assert.equal(observedControlRuntimeId(selected,null,w,TIME+2000),null);
});
test("native source exports bounded RuntimeId in both verified read-only UIA paths",()=>{
 const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const a=source.indexOf("        ToolAction::UiDiscover { window } => {",570000);
 const b=source.indexOf("        ToolAction::UiFind { name, automation_id, window } => {",a);
 const c=source.indexOf("        ToolAction::UiClick { name, automation_id, window } => {",b);
 assert.ok(a>0&&b>a&&c>b);
 for(const arm of [source.slice(a,b),source.slice(b,c)]){
  assert.match(arm,/\$e.GetRuntimeId\(\)/);
  assert.match(arm,/ControlRuntimeId/);
  assert.match(arm,/Count -gt 64/);
 }
});
test("native agent captures controls before invalidation and attaches to executed action receipt",()=>{
 const s=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const before=s.indexOf("const beforeControlObservation=observedControls.get(current.threadId)");
 const invalidated=s.indexOf("observedControls.set(current.threadId,null)",before);
 const executed=s.indexOf('await invoke<ActionResult>("execute_action"',before);
 const readback=s.indexOf("beforeWindowObservation,beforeUiEvidenceAtMs,beforeControlObservation",executed);
 const timestamp=s.indexOf("const beforeUiEvidenceAtMs=Date.now()",before);
 assert.ok(before>0&&timestamp>before&&invalidated>timestamp&&executed>invalidated&&readback>executed);
 assert.match(s.slice(executed,readback),/verifiedExecutionReceipt/);
});

test("both UIA read-only actions Win32-check the same root before and after collecting evidence",()=>{
 const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const guard=readFileSync(new URL("../src-tauri/src/native_uia_window_guard.rs",import.meta.url),"utf8");
 const a=lib.indexOf("        ToolAction::UiDiscover { window } => {",570000);
 const b=lib.indexOf("        ToolAction::UiFind { name, automation_id, window } => {",a);
 const c=lib.indexOf("        ToolAction::UiClick { name, automation_id, window } => {",b);
 assert.ok(a>=0&&b>a&&c>b);
 for(const text of [lib.slice(a,b),lib.slice(b,c)]){
  const before=text.indexOf("{attestation}");
  const enumerate=Math.max(text.indexOf("$all = $root.FindAll("),text.indexOf("$matches = Resolve-ShuviUiMatches"));
  const after=text.lastIndexOf("Assert-ShuviObservedWindow");
  const output=text.lastIndexOf("ConvertTo-Json");
  assert.ok(text.includes("readonly_window_attestation_script()"));
  assert.ok(before>=0&&enumerate>before&&after>enumerate&&output>after);
 }
 for(const condition of ["GetWindowThreadProcessId","IsWindowVisible","IsIconic",
   "$shuviNativeReadPid", "Assert-ShuviObservedWindow","Discard readback"]){
  assert.ok(guard.includes(condition),"missing "+condition);
 }
 assert.doesNotMatch(guard.slice(guard.indexOf("pub(super) fn readonly_window_attestation_script()"),
    guard.indexOf("fn valid_label(")),/SetForegroundWindow|SendWait\(/);
});
