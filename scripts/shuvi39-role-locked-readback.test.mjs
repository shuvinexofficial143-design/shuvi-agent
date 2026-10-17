import test from "node:test";
import assert from "node:assert/strict";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation,observedControlIdentity,observedControlRuntimeId,
 checkObservedControlTarget,currentObservedControls} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,auditUiReadback,checkPendingUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";
const TITLE="Adobe Premiere Pro", NOW=2000,BIRTH="638962156780123456";
const win=()=>newAuditedWindowObservation({tool:"ui_windows",success:true,exit_code:0,
 stdout:JSON.stringify([{Name:TITLE,NativeWindowHandle:9001,ProcessId:111,
 ProcessName:"Premiere",ProcessStartTicks:BIRTH}])},"win-1",NOW);
const ctrl={Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
 IsEnabled:true,IsOffscreen:false,ControlRuntimeId:[9,-3,100],
 ObservedWindowHwnd:9001,ObservedWindowPid:111,ObservedWindowProcessStartTicks:BIRTH};
const snapshot=(w=win(),items=[ctrl])=>newAuditedControlObservation({tool:"ui_discover",
 success:true,exit_code:0,stdout:JSON.stringify(items)},"discover-1",TITLE,w,NOW+1000);
const propose=(tool="ui_click",args={window:TITLE,name:"Save",automation_id:"save"})=>({tool,arguments:args});
const response=(tool="ui_find",row=ctrl)=>({tool,success:true,exit_code:0,
 stdout:JSON.stringify(tool==="ui_discover"?[row]:row)});
const lookup=propose("ui_find");
test("verified native UIA control captures immutable role and RuntimeId as one observation",()=>{
 const w=win(),s=snapshot(w),o=observedControlIdentity(propose(),s,w,NOW+1500);
 assert.deepEqual(o,{runtimeId:[9,-3,100],controlType:"ControlType.Button"});
 assert.equal(Object.isFrozen(o),true);
 assert.equal(Object.isFrozen(o.runtimeId),true);
 assert.deepEqual(observedControlRuntimeId(propose(),s,w,NOW+1500),[9,-3,100]);
 const p=newPendingUiReadback("action-3",propose(),w,NOW+1500,s);
 assert.equal(p.controlType,"ControlType.Button");
 assert.deepEqual(p.controlRuntimeId,[9,-3,100]);
 assert.equal(checkPendingUiReadback(propose(),p).allowed,false);
 assert.equal(auditUiReadback(p,lookup,response(),w,NOW+2000),null);
});
test("same HWND/PID/birth/RuntimeId/labels with a different UIA role cannot unlock action",()=>{
 const w=win(),s=snapshot(w);
 const pending=newPendingUiReadback("action-3",propose(),w,NOW+1500,s);
 for(const changed of ["ControlType.MenuItem","ControlType.Edit","ControlType.CheckBox",
  undefined,null,42,"Button"]){
  const observed={...ctrl,ControlType:changed};
  assert.equal(auditUiReadback(pending,lookup,response("ui_find",observed),w,NOW+2000),
   pending,String(changed));
 }
 assert.equal(auditUiReadback(pending,propose("ui_discover",{window:TITLE}),
   response("ui_discover",{...ctrl,ControlType:"ControlType.Edit"}),w,NOW+2000),pending);
});
test("an audited inventory with conflicting duplicate native RuntimeIds is wholly rejected",()=>{
 const w=win();
 const duplicate={...ctrl,Name:"Close",AutomationId:"close"};
 const s=snapshot(w,[ctrl,duplicate]);
 assert.equal(s,null);
 assert.equal(newPendingUiReadback("action-3",propose(),w,NOW+1500,s)?.controlType,null);
 // Null means a discovery was attempted but could not provide safe identity.
 assert.equal(checkObservedControlTarget(propose(),s,w,NOW+2000).allowed,false);
 assert.ok(snapshot(w,[ctrl,{...duplicate,ControlRuntimeId:[9,-3,101]}]));
});
test("two different native IDs remain addressable by exact valid selectors",()=>{
 const w=win(),s=snapshot(w,[ctrl,{...ctrl,Name:"Close",AutomationId:"close",ControlRuntimeId:[12]}]);
 assert.equal(currentObservedControls(s,w,NOW+2000).length,2);
 assert.equal(checkObservedControlTarget(propose(),s,w,NOW+2000).allowed,true);
 assert.equal(checkObservedControlTarget(propose("ui_click",{window:TITLE,name:"Close",automation_id:"close"}),
  s,w,NOW+2000).allowed,true);
});
test("model nonstring or hidden selector cannot crash or bypass observed control gate",()=>{
 const w=win(),s=snapshot(w);
 for(const bad of [12,{},[],false,["save"],"  ","save\n","s\u0000ave",
  "sa\u202eve","\u200bsave"," save","save ","s".repeat(181)]){
  for(const args of [{window:TITLE,name:"Save",automation_id:bad},
   {window:TITLE,name:bad,automation_id:"save"}]){
   assert.equal(checkObservedControlTarget(propose("ui_click",args),s,w,NOW+2000).allowed,false,
    "reject supplied invalid selector "+JSON.stringify(bad));
  }
 }
 assert.equal(checkObservedControlTarget(propose("ui_click",{window:TITLE,name:"Save",automation_id:""}),
  s,w,NOW+2000).allowed,true);
 // The window selector is also exact: a newline must never be trimmed away
 // into a different accepted audited HWND.
 for(const window of [TITLE+"\n"," "+TITLE,TITLE+"\u202e"]){
  assert.equal(checkObservedControlTarget(propose("ui_click",{window,name:"Save",automation_id:"save"}),
   s,w,NOW+2000).allowed,false);
  assert.equal(observedControlIdentity(propose("ui_click",{window,name:"Save",automation_id:"save"}),
   s,w,NOW+2000),null);
 }
 assert.equal(observedControlIdentity(propose("ui_click",
  {window:TITLE,name:"Save",automation_id:"save\n"}),s,w,NOW+2000),null);
});
test("no invented UIA role when no prior audited control discovery exists",()=>{
 const w=win(),pending=newPendingUiReadback("action-3",propose(),w,NOW+1500);
 assert.equal(pending.controlRuntimeId,null);
 assert.equal(pending.controlType,null);
 // Without the original discovery the native Rust UIA prepared target
 // independently enforces the original exact OS-controlled RuntimeId.
 assert.equal(auditUiReadback(pending,lookup,response(),w,NOW+2000),null);
});
