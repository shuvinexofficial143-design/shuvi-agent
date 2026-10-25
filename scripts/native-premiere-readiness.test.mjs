import test from "node:test";
import assert from "node:assert/strict";
import {premiereUiReadback,auditedPremiereUiReady} from "../web-dashboard/src/native-premiere-readiness.mjs";
const ids=["c0421234-1234-4123-8123-123456789012","d0421234-1234-4123-8123-123456789012","e0421234-1234-4123-8123-123456789012"];
const tick="638962980000000000";
const two={observations:[{id:ids[0],tool:"premiere_launch"},{id:ids[1],tool:"ui_windows"}],
 lastTool:"ui_windows",seenIds:new Set(ids.slice(0,2))};
const win={tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify([
 {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:10,
 NativeWindowHandle:250,ProcessStartTicks:tick}])};
const session={version:1,sourceTool:"ui_windows",sourceActionId:ids[1],
 observedAtMs:Date.now()-100,expiresAtMs:Date.now()-100+120000,
 windows:[{app:"premiere",title:"Adobe Premiere Pro 2026",process:"Adobe Premiere Pro",
 pid:10,hwnd:250,processStartTicks:tick}]};
const prop={tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}};
const three={observations:[...two.observations,{id:ids[2],tool:"ui_discover"}],
 lastTool:"ui_discover",seenIds:new Set(ids)};
const rows=()=>["File","New Project","Open Project"].map((Name,i)=>({
 Name,AutomationId:"a"+i,ControlType:i===0?"ControlType.MenuItem":"ControlType.Button",
 IsEnabled:true,IsOffscreen:false,ControlRuntimeId:[5,i],
 ObservedWindowHwnd:250,ObservedWindowPid:10,ObservedWindowProcessStartTicks:tick}));
const result=r=>({tool:"ui_discover",success:true,exit_code:0,stdout:JSON.stringify(r)});
test("window proof proposes a separate native UI readiness read",()=>{
 assert.deepEqual(premiereUiReadback("Premiere kholo",ids[1],win,two,true),prop);
 assert.equal(premiereUiReadback("Premiere kholo",ids[1],win,two,false),null);
});
test("Premiere readiness requires three native audit receipts and live interactive controls",()=>{
 assert.equal(auditedPremiereUiReady("Premiere kholo",ids[2],result(rows()),prop,three,session,true)?.scope,"premiere_ui_ready");
 assert.equal(auditedPremiereUiReady("Premiere kholo",ids[2],result(rows()),prop,three,session,false),null);
});
test("splash, duplicate RuntimeId and recycled process fail closed",()=>{
 assert.equal(auditedPremiereUiReady("Premiere kholo",ids[2],result(rows().slice(0,1)),prop,three,session,true),null);
 let dupe=rows();dupe[2].ControlRuntimeId=dupe[1].ControlRuntimeId;
 assert.equal(auditedPremiereUiReady("Premiere kholo",ids[2],result(dupe),prop,three,session,true),null);
 let other=rows();other[2].ObservedWindowPid=11;
 assert.equal(auditedPremiereUiReady("Premiere kholo",ids[2],result(other),prop,three,session,true),null);
});
