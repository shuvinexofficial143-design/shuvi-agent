import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {exactUiSelector} from "../web-dashboard/src/native-observation-text.mjs";
import {checkObservedMutationTarget,checkAmbiguousReadWindow} from "../web-dashboard/src/native-window-target-guard.mjs";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation,checkObservedControlTarget} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,auditUiReadback,checkPendingUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";
const TITLE="Adobe Premiere Pro",birth="638962156780123456",START=10_000;
const windowResult=()=>({tool:"ui_windows",success:true,exit_code:0,
 stdout:JSON.stringify([{Name:TITLE,ProcessName:"Premiere",NativeWindowHandle:440,ProcessId:91,ProcessStartTicks:birth}])});
const observation=(actionId,t=START)=>newAuditedWindowObservation(windowResult(),actionId,t);
const row={Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
 ControlRuntimeId:[15,-6],IsEnabled:true,IsOffscreen:false,
 ObservedWindowHwnd:440,ObservedWindowPid:91,ObservedWindowProcessStartTicks:birth};
const found=(r=row)=>({tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(r)});
const selected={tool:"ui_click",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const read={tool:"ui_find",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
function context(){
 const before=observation("window-before",START);
 const control=newAuditedControlObservation({tool:"ui_discover",success:true,
  exit_code:0,stdout:JSON.stringify([row])},"discovery-before",TITLE,before,START+100);
 const pending=newPendingUiReadback("mutation",selected,before,START+200,control);
 return {before,control,pending,after:observation("window-after",START+300)};
}
test("all three dashboard gates require exactly the same unmodified window/control selector",()=>{
 const {before,control}=context();
 const windows=before.windows;
 assert.equal(exactUiSelector("Save Button"),true);
 assert.equal(exactUiSelector(TITLE),true);
 for(const spoof of [TITLE+"\n",TITLE+"\r",TITLE+"\t",TITLE+" ", " "+TITLE,
  TITLE+"\u200b",TITLE+"\u202e",TITLE+"\u2066",TITLE+"\u0000",42,{},["Adobe Premiere Pro"]]){
  assert.equal(exactUiSelector(spoof),false,String(spoof));
  assert.equal(checkObservedMutationTarget({...selected,arguments:{...selected.arguments,window:spoof}},windows).allowed,false);
  assert.equal(checkAmbiguousReadWindow({...read,arguments:{...read.arguments,window:spoof}},windows).allowed,false);
  assert.equal(checkAmbiguousReadWindow({tool:"inspect_screen",arguments:{window:spoof}},windows).allowed,false);
  assert.equal(checkObservedControlTarget({...selected,arguments:{...selected.arguments,window:spoof}},control,before,START+400).allowed,false);
  const blocked=newPendingUiReadback("mutation", {...selected,arguments:{...selected.arguments,window:spoof}},
   before,START+400,control);
  assert.equal(blocked.hwnd,null);
 }
 assert.equal(checkObservedMutationTarget(selected,windows).allowed,true);
 assert.equal(checkAmbiguousReadWindow(read,windows).allowed,true);
 assert.equal(checkObservedControlTarget(selected,control,before,START+400).allowed,true);
});
test("explicit desktop capture remains separate and cannot normalize hidden characters to desktop",()=>{
 const {before}=context();
 assert.equal(checkAmbiguousReadWindow({tool:"inspect_screen",arguments:{window:"desktop"}},before.windows).allowed,true);
 for(const spoof of ["desktop\n","desktop "," desktop","desk\u200btop","desktop\u202e"])
  assert.equal(checkAmbiguousReadWindow({tool:"inspect_screen",arguments:{window:spoof}},before.windows).allowed,false);
});
test("pending UI mutation readback remembers provenance and exact original OS identity",()=>{
 const {before,pending}=context();
 assert.equal(pending.sourceActionId,"mutation");
 assert.equal(pending.windowSourceActionId,before.sourceActionId);
 assert.equal(pending.processStartTicks,birth);
 assert.deepEqual(pending.controlRuntimeId,[15,-6]);
 assert.equal(pending.controlType,"ControlType.Button");
 assert.equal(checkPendingUiReadback(selected,pending).allowed,false);
});
test("new separately audited ui_windows and distinct read action are required in production",()=>{
 const {before,pending,after}=context();
 assert.equal(auditUiReadback(pending,read,found(),before,START+500,"read-1"),pending,
  "pre-mutation window evidence reused");
 assert.equal(auditUiReadback(pending,read,found(),after,START+500,"mutation"),pending,
  "mutation's own action cannot masquerade as independent read");
 assert.equal(auditUiReadback(pending,read,found(),after,START+500,"read-1"),null);
 assert.equal(auditUiReadback(pending,read,found(),after,START+500),null,
  "legacy fixtures without production provenance argument remain supported");
});
test("clock reversal, stale window identity and a failed read never clear pending",()=>{
 const {pending,after}=context();
 const beforeMutation=observation("window-after",START+100);
 assert.equal(auditUiReadback(pending,read,found(),beforeMutation,START+500,"read-1"),pending);
 assert.equal(auditUiReadback(pending,read,found(),after,START+100,"read-1"),pending);
 for(const bad of [undefined,"","mutation",17]){
  assert.equal(auditUiReadback(pending,read,found(),after,START+500,bad??"mutation"),pending);
 }
 assert.equal(auditUiReadback(pending,read,{...found(),success:false},after,START+500,"read-1"),pending);
 assert.equal(auditUiReadback(pending,read,found({...row,ObservedWindowPid:99}),after,START+500,"read-1"),pending);
});
test("bad original model selectors cannot create a readback clearance capability",()=>{
 const {before,after,control}=context();
 const broken={...selected,arguments:{...selected.arguments,automation_id:"save\n"}};
 const pending=newPendingUiReadback("mutation",broken,before,START+200,control);
 assert.equal(pending.hwnd,null);
 assert.equal(auditUiReadback(pending,read,found(),after,START+500,"read-1"),pending);
});
test("production Agent passes native read action ID after Rust's verified execution receipt",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const verified=src.indexOf("const verified=verifiedExecutionReceipt(");
 const invocation=src.lastIndexOf("auditUiReadback(");
 assert.ok(verified>0&&invocation>verified);
 const segment=src.slice(invocation,invocation+250);
 assert.match(segment,/Date\.now\(\),current\.action\.id/);
});
