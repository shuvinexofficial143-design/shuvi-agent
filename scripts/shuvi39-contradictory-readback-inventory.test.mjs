import test from "node:test";
import assert from "node:assert/strict";
import {newAuditedWindowObservation} from "../web-dashboard/src/native-window-observation-session.mjs";
import {newAuditedControlObservation} from "../web-dashboard/src/native-ui-control-session.mjs";
import {newPendingUiReadback,auditUiReadback} from "../web-dashboard/src/native-ui-readback-session.mjs";
const TITLE="Adobe Premiere Pro",T=10000,BIRTH="638962156780123456";
const initial={Name:"Save",AutomationId:"save",ControlType:"ControlType.Button",
 ControlRuntimeId:[20,-4,1],IsEnabled:true,IsOffscreen:false,
 ObservedWindowHwnd:433,ObservedWindowPid:55,ObservedWindowProcessStartTicks:BIRTH};
const unrelated={...initial,Name:"Close",AutomationId:"close",ControlRuntimeId:[20,-4,2]};
const window=(id,time)=>newAuditedWindowObservation({tool:"ui_windows",success:true,exit_code:0,
 stdout:JSON.stringify([{Name:TITLE,NativeWindowHandle:433,ProcessId:55,
 ProcessName:"Premiere",ProcessStartTicks:BIRTH}])},id,time);
const discover=(rows)=>({tool:"ui_discover",success:true,exit_code:0,stdout:JSON.stringify(rows)});
const click={tool:"ui_click",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const lookup={tool:"ui_discover",arguments:{window:TITLE}};
const exactFind={tool:"ui_find",arguments:{window:TITLE,name:"Save",automation_id:"save"}};
const found=row=>({tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify(row)});
function setup(){
 const before=window("win-before",T);
 const control=newAuditedControlObservation(discover([initial,unrelated]),"control-before",TITLE,before,T+100);
 assert.ok(control);
 const p=newPendingUiReadback("mutation",click,before,T+200,control);
 const after=window("win-after",T+300);
 return {p,after,before};
}
test("readback binds three distinct source actions: original controls, mutation and new window",()=>{
 const {p,after,before}=setup();
 assert.equal(p.controlSourceActionId,"control-before");
 assert.equal(p.windowSourceActionId,"win-before");
 assert.equal(p.sourceActionId,"mutation");
 assert.equal(auditUiReadback(p,lookup,discover([initial,unrelated]),after,T+600,"read-after"),null);
 for(const id of ["control-before","mutation","win-after"]){
  assert.equal(auditUiReadback(p,lookup,discover([initial,unrelated]),after,T+600,id),p,id);
 }
 assert.equal(auditUiReadback(p,lookup,discover([initial,unrelated]),before,T+600,"read-after"),p);
});
test("duplicated native RuntimeId on an unrelated UIA control invalidates whole readback",()=>{
 const {p,after}=setup();
 const collision={...unrelated,ControlRuntimeId:initial.ControlRuntimeId};
 assert.equal(auditUiReadback(p,lookup,discover([initial,collision]),after,T+600,"read-after"),p);
 assert.equal(auditUiReadback(p,lookup,discover([initial,unrelated]),after,T+600,"read-after"),null);
});
test("unrelated malformed native RuntimeId fails closed even though target uniquely matches",()=>{
 const {p,after}=setup();
 for(const bad of [[1.2],[2147483648],[-2147483649],["1"],[],null,Array.from({length:65},()=>0)]){
  const row={...unrelated,ControlRuntimeId:bad===null?["bad"]:bad};
  assert.equal(auditUiReadback(p,lookup,discover([initial,row]),after,T+600,"read-after"),p);
 }
});
test("contradictory role and native UIA state anywhere in inventory block clearance",()=>{
 const {p,after}=setup();
 for(const row of [
  {...unrelated,ControlType:144}, {...unrelated,ControlType:""},
  {...unrelated,ControlType:"a".repeat(101)}, {...unrelated,IsEnabled:"true"},
  {...unrelated,IsOffscreen:0}
 ]){
  assert.equal(auditUiReadback(p,lookup,discover([initial,row]),after,T+600,"read-after"),p);
 }
});
test("exact singleton ui_find still works but model-supplied newline selector cannot clear",()=>{
 const {p,after}=setup();
 assert.equal(auditUiReadback(p,exactFind,found(initial),after,T+600,"read-after"),null);
 for(const spoof of ["Save\n"," Save","Save ","S\u202eave","S\u200bave"]){
  const request={...exactFind,arguments:{...exactFind.arguments,name:spoof}};
  assert.equal(auditUiReadback(p,request,found(initial),after,T+600,"read-after"),p,spoof);
 }
});
