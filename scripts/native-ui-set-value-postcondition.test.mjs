import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";
const oldWin={version:1,sourceTool:"ui_windows",sourceActionId:"old-window-id",
 observedAtMs:1000,expiresAtMs:121000,
 windows:[{title:"Untitled - Notepad",process:"notepad",pid:142,hwnd:987,
  processStartTicks:"123456789",app:"unknown"}]};
const win={...oldWin,sourceActionId:"new-window-id",observedAtMs:1400,expiresAtMs:121400};
const proposal={tool:"ui_set_value",arguments:{
 window:"Untitled - Notepad",name:"Text Editor",automation_id:"txt",value:"हैलो\nनया टेक्स्ट"}};
const read={tool:"ui_find",arguments:{window:proposal.arguments.window,
 name:proposal.arguments.name,automation_id:proposal.arguments.automation_id}};
const row={Name:"Text Editor",AutomationId:"txt",ControlType:"ControlType.Edit",
 ObservedWindowHwnd:987,ObservedWindowPid:142,
 ObservedWindowProcessStartTicks:"123456789",ControlRuntimeId:[1,2,3],
 Value:proposal.arguments.value};
const result=r=>({tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(r),stderr:""});
const pending=()=>newPendingUiReadback("mutate-id",proposal,oldWin,1100);
test("exact SetValue input is kept only in a bounded readback snapshot",()=>{
 const p=pending();assert.equal(p.expectedValue,proposal.arguments.value);
 assert.equal(p.hwnd,987);assert.equal(p.windowSourceActionId,"old-window-id");
 const oversized=newPendingUiReadback("other",{...proposal,arguments:{...proposal.arguments,value:"x".repeat(4097)}},oldWin,1100);
 assert.equal(oversized.expectedValue,null);
});
test("independent SAME HWND/PID/start ticks plus exact UIA ValuePattern clears barrier",()=>{
 assert.equal(auditUiReadback(pending(),read,result(row),win,1700,"control-read-id"),null);
 assert.equal(auditUiReadback(pending(),read,result([row]),win,1700,"control-read-id"),null);
});
test("missing, masked, truncated, changed or contradictory values never clear readback",()=>{
 for(const changed of [
  {...row,Value:undefined},{...row,Value:"wrong"},
  {...row,Value:"••••"},{...row,Value:proposal.arguments.value+"!"},
  {...row,Value:proposal.arguments.value,CurrentValue:"different"},
  {...row,Value:"x".repeat(4097)}
 ]){
  const before=pending();
  assert.equal(auditUiReadback(before,read,result(changed),win,1700,"control-read-id"),before);
 }
});
test("forged native root, reused action receipt, stale window and selector substitution all fail closed",()=>{
 const p=pending();
 const cases=[
  [read,result(row),oldWin,1700,"control-read-id"],
  [read,result({...row,ObservedWindowPid:999}),win,1700,"control-read-id"],
  [read,result({...row,AutomationId:"other"}),win,1700,"control-read-id"],
  [read,result([row,row]),win,1700,"control-read-id"],
  [read,result(row),win,1700,"mutate-id"],
  [read,result(row),win,1700,"old-window-id"],
  [read,result(row),{...win,windows:[{...win.windows[0],pid:222}]},1700,"control-read-id"],
  [{...read,arguments:{...read.arguments,automation_id:"other"}},result(row),win,1700,"control-read-id"]
 ];
 for(const [pr,res,window,time,id] of cases)
  assert.equal(auditUiReadback(p,pr,res,window,time,id),p);
});
test("native call site does not equate value mismatch to completed goal",()=>{
 const agent=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const policy=readFileSync(new URL("../web-dashboard/src/native-ui-readback-session.mjs",import.meta.url),"utf8");
 assert.match(policy,/row\.Value!==pending\.expectedValue/);
 assert.match(agent,/pendingUiReadback\.set\(current\.threadId,auditUiReadback\(/);
 assert.match(agent,/if\(boundUiReadback\?\.blocked\)/);
});
