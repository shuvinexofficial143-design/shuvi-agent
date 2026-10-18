import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {observedWindowInventory,normalizedProcessStartTicks} from "../web-dashboard/src/native-window-target-guard.mjs";
import {newAuditedWindowObservation,currentObservedWindows} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation,currentObservedControls} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";

const TITLE="Adobe Premiere Pro", BIRTH="638962156780123456", OTHER="638962156780123457";
const win=(birth=BIRTH)=>({tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify([
 {Name:TITLE,ProcessId:342,NativeWindowHandle:487,ProcessName:"Premiere",ProcessStartTicks:birth}])});
const ctrl=(birth=BIRTH,tool="ui_discover")=>({tool,success:true,exit_code:0,stdout:JSON.stringify(
 tool==="ui_discover"?[row(birth)]:row(birth))});
const row=(birth=BIRTH)=>({Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
 IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:487,ObservedWindowPid:342,
 ObservedWindowProcessStartTicks:birth,ControlRuntimeId:[42,-1,3]});
const selected={tool:"ui_click",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const read={tool:"ui_find",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
function setup(){
 const w=newAuditedWindowObservation(win(),"win-action",1000);
 const c=newAuditedControlObservation(ctrl(),"control-action",TITLE,w,1500);
 assert.ok(c);
 const p=newPendingUiReadback("click-action",selected,w,2000,c);
 return {w,c,p};
}
test("signed 64-bit process generation is an exact string, never a rounded JSON Number",()=>{
 for(const bad of [undefined,null,0,100,"0","01","-1","1e18","1.0"," 638962156780123456",
 "9223372036854775808","12345678901234567890",{}]){
  assert.equal(normalizedProcessStartTicks(bad),null);
 }
 assert.equal(normalizedProcessStartTicks(BIRTH),BIRTH);
 assert.equal(normalizedProcessStartTicks("9223372036854775807"),"9223372036854775807");
 assert.equal(normalizedProcessStartTicks("1"),"1");
});
test("native window inventory retains a frozen OS birth token and rejects malformed or contradictory token rows",()=>{
 const w=newAuditedWindowObservation(win(),"win-action",1000);
 assert.equal(w.windows[0].processStartTicks,BIRTH);
 assert.ok(Object.isFrozen(w.windows[0]));
 assert.equal(currentObservedWindows(w,2000)[0].processStartTicks,BIRTH);
 for(const invalid of [1234567890,"1e18","-1","9223372036854775808",null]){
  assert.deepEqual(observedWindowInventory(win(invalid),true),[]);
  assert.equal(newAuditedWindowObservation(win(invalid),"win-action",1000),null);
 }
});
test("control discovery requires the same native process instance as the selected window",()=>{
 const {w,c}=setup();
 assert.equal(c.processStartTicks,BIRTH);
 assert.equal(currentObservedControls(c,w,2000).length,1);
 assert.equal(newAuditedControlObservation(ctrl(OTHER),"read",TITLE,w,2000),null);
 assert.equal(newAuditedControlObservation(ctrl(null),"read",TITLE,w,2000),null);
 const changed=newAuditedWindowObservation(win(OTHER),"win-next",2050);
 assert.deepEqual(currentObservedControls(c,changed,2100),[]);
});
test("old process readback cannot authorize another UI mutation after PID and HWND reuse",()=>{
 const {w,p}=setup();
 assert.equal(p.processStartTicks,BIRTH);
 assert.equal(auditUiReadback(p,read,ctrl(BIRTH,"ui_find"),w,2500),null);
 assert.equal(auditUiReadback(p,read,ctrl(OTHER,"ui_find"),w,2500),p);
 assert.equal(auditUiReadback(p,read,ctrl(null,"ui_find"),w,2500),p);
 const reused=newAuditedWindowObservation(win(OTHER),"window-again",2200);
 assert.equal(auditUiReadback(p,read,ctrl(OTHER,"ui_find"),reused,2500),p);
});
test("legacy fixture without birth tick remains compatible but never claims generation-bound proof",()=>{
 const old={tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify([
 {Name:TITLE,ProcessId:342,NativeWindowHandle:487,ProcessName:"Premiere"}])};
 const w=newAuditedWindowObservation(old,"legacy",1000);
 assert.ok(w);
 assert.equal(w.windows[0].processStartTicks,undefined);
 const c=newAuditedControlObservation({tool:"ui_discover",success:true,exit_code:0,
  stdout:JSON.stringify([{...row(BIRTH),ObservedWindowProcessStartTicks:undefined}])},"legacy-control",TITLE,w,1500);
 assert.ok(c);
 const p=newPendingUiReadback("legacy-click",selected,w,2000,c);
 assert.equal(p.processStartTicks,null);
 assert.equal(auditUiReadback(p,read,{tool:"ui_find",success:true,exit_code:0,
  stdout:JSON.stringify({...row(BIRTH),ObservedWindowProcessStartTicks:undefined})},w,2500),null);
});
test("production Rust emits exact OS birth time in all three native read paths",()=>{
 const src=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const a=src.indexOf("        ToolAction::UiWindows => {");
 const b=src.indexOf("        ToolAction::UiDiscover { window } => {",a);
 const c=src.indexOf("        ToolAction::UiFind { name, automation_id, window } => {",b);
 const d=src.indexOf("        ToolAction::UiClick { name, automation_id, window } => {",c);
 assert.ok(a>0&&b>a&&c>b&&d>c);
 const list=src.slice(a,b),discover=src.slice(b,c),find=src.slice(c,d);
 assert.match(list,/GetWindowThreadProcessId/);
 assert.match(list,/StartTime.ToUniversalTime\(\).Ticks/);
 assert.match(list,/\$birthTicksAfter -ne \$birthTicks/);
 assert.match(list,/ProcessStartTicks = \$birthTicks.ToString/);
 assert.match(discover,/ObservedWindowProcessStartTicks=\$shuviReadStartTicks.ToString/);
 assert.match(find,/ObservedWindowProcessStartTicks = \$shuviObservedStartTicks/);
 assert.match(find,/\{finish_attestation\}/);
});
