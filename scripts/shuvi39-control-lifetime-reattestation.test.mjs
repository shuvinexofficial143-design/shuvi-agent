import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const core=read("../src-tauri/src/lib.rs");
const guard=read("../src-tauri/src/native_uia_window_guard.rs");
const start=core.indexOf("        ToolAction::UiDiscover { window } => {");
const mid=core.indexOf("        ToolAction::UiFind { name, automation_id, window } => {",start);
const end=core.indexOf("        ToolAction::UiClick { name, automation_id, window } => {",mid);
const arms=[core.slice(start,mid),core.slice(mid,end)];
const helper=guard.slice(guard.indexOf("pub(super) fn readonly_control_reattestation_script()"),
 guard.indexOf("pub(super) fn readonly_window_attestation_script()"));
test("both native UIA read paths reattest selected control and window before JSON",()=>{
 assert.ok(start>0&&mid>start&&end>mid);
 for(const arm of arms){
  assert.match(arm,/readonly_control_reattestation_script\(\)/);
  assert.match(arm,/\{control_attestation\}/);
  const element=arm.lastIndexOf("Assert-ShuviObservedControl -element");
  // Discovery embeds the exact root check, while named ui_find invokes its
  // pre-bound {finish_attestation} snippet twice after control lookup.
  const window=arm.includes("{finish_attestation}")?
   arm.lastIndexOf("{finish_attestation}"):
   arm.lastIndexOf("Assert-ShuviObservedWindow");
  const serialized=arm.lastIndexOf("ConvertTo-Json");
  assert.ok(element>0&&window>element&&serialized>window);
 }
});
test("discovery protects ephemeral UIA object and removes it before serializing",()=>{
 const d=arms[0];
 assert.match(d,/TreeWalker\]::ControlViewWalker/);
 assert.match(d,/shuviDiscoveryNodes -gt 1200/);
 assert.match(d,/shuviParent.Depth -ge 14/);
 assert.doesNotMatch(d,/\$root\.FindAll\(/);
 assert.match(d,/Select-Object -First 110/);
 assert.match(d,/Select-Object -First 40/);
 assert.match(d,/__ShuviOriginalElement=\$e/);
 assert.match(d,/Assert-ShuviObservedControl -element \$item.__ShuviOriginalElement/);
 assert.match(d,/Properties.Remove\('__ShuviOriginalElement'\)/);
 assert.ok(d.indexOf("Properties.Remove('__ShuviOriginalElement')")<d.lastIndexOf("ConvertTo-Json"));
});
test("ui_find bounds element references and performs all identity/state checks",()=>{
 const f=arms[1];
 assert.match(f,/Math\]::Min\(\$matches.Count, 25\)/);
 assert.match(f,/\$shuviReadElements.Add\(\$e\)/);
 assert.match(f,/Assert-ShuviObservedControl -element \$shuviReadElements\[\$i\]/);
 for(const part of ["GetRuntimeId()","ControlRuntimeId","ProcessId","Name","AutomationId",
  "ControlType","IsEnabled","IsOffscreen","HasKeyboardFocus","ToggleState",
  "ExpandCollapseState","IsSelected","VerticalScrollPercent","TryGetCurrentPattern"]){
  assert.ok(helper.includes(part),"not reattested: "+part);
 }
 assert.match(helper,/currentRid.Count -ne \$boundRid.Count/);
 assert.match(helper,/\$currentRid\[\$i\] -ne \$boundRid\[\$i\]/);
 for(const forbidden of [/\.SetValue\s*\(/i,/\.Invoke\s*\(/i,/\.Toggle\s*\(/i,
   /\.SetFocus\s*\(/i,/SendWait\s*\(/i,/SetForegroundWindow\s*\(/i])
  assert.doesNotMatch(helper,forbidden);
});
test("refused or changed native observations cannot clear pending UIA readback",()=>{
 const title="Adobe Premiere Pro",birth="638962156780123456";
 const win=newAuditedWindowObservation({tool:"ui_windows",success:true,exit_code:0,
  stdout:JSON.stringify([{Name:title,ProcessId:77,ProcessName:"Premiere",
  NativeWindowHandle:30,ProcessStartTicks:birth}])},"win",1000);
 const row={Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
  ControlRuntimeId:[10,-3],IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:30,
  ObservedWindowPid:77,ObservedWindowProcessStartTicks:birth};
 const observation=newAuditedControlObservation({tool:"ui_discover",success:true,
  exit_code:0,stdout:JSON.stringify([row])},"discover",title,win,1100);
 assert.ok(observation);
 const args={window:title,name:"Save",automation_id:"save"};
 const pending=newPendingUiReadback("click",{tool:"ui_click",arguments:args},win,1200,observation);
 const lookup={tool:"ui_find",arguments:args};
 const result=(r)=>({tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(r)});
 assert.equal(auditUiReadback(pending,lookup,{tool:"ui_find",success:false,exit_code:1,
  stdout:"",stderr:"Discard readback."},win,1300),pending);
 assert.equal(auditUiReadback(pending,lookup,result({...row,ControlRuntimeId:[10,-4]}),win,1300),pending);
 assert.equal(auditUiReadback(pending,lookup,result(row),win,1300),null);
});
