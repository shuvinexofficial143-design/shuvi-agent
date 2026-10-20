import test from "node:test";
import assert from "node:assert/strict";
import {
 newApplicationContinuity,recordAuditedApplication,selectApplicationContinuity,
 continuityReadback,continuityHint
 ,checkConfirmedContinuity
} from "../web-dashboard/src/native-application-continuity.mjs";

const now=1_800_000_000_000;
const id="00000000-0000-4000-8000-000000000001";
const native=(tool,stdout)=>({tool,stdout,stderr:"",success:true,exit_code:0});
const browserStart=(browser,pid,url)=>({proposal:{tool:"browser_start",arguments:{browser,url}},
 result:native("browser_start",`Started Shuvi-managed ${browser} with root PID ${pid}, local DevTools port 9222, and one bound page target.`)});
const page=(pid,origin="https://www.youtube.com")=>({proposal:{tool:"browser_page_state",arguments:{pid}},
 result:native("browser_page_state",JSON.stringify({origin,pathname:"/",readyState:"complete",title:"YouTube"}))});

test("Edge YouTube is reused for next independent YouTube search only after a fresh approval/readback",()=>{
 const registry=newApplicationContinuity();
 const launch=browserStart("edge",1234,"https://www.youtube.com/");
 assert.equal(recordAuditedApplication(registry,launch.proposal,launch.result,id,now),true);
 assert.equal(selectApplicationContinuity(registry,"YouTube par Arijit Singh search karo",now+10),null,
  "an audited launch alone is not proof of a live page");
 const observed=page(1234);
 assert.equal(recordAuditedApplication(registry,observed.proposal,observed.result,id,now+20),true);
 const candidate=selectApplicationContinuity(registry,"YouTube par Arijit Singh search karo",now+100);
 assert.equal(candidate.kind,"browser");
 assert.equal(candidate.browser,"edge");
 assert.deepEqual(continuityReadback(candidate,{tool:"browser_start",arguments:{browser:"chrome",url:"https://youtube.com/results"}}),
  {tool:"browser_page_state",arguments:{pid:1234}});
 assert.match(continuityHint(candidate),/new Allow once/);
 assert.equal(selectApplicationContinuity(registry,"Open YouTube in a new window",now+100),null);
 assert.equal(selectApplicationContinuity(registry,"Open YouTube in a new Edge browser",now+100),null);
 assert.equal(selectApplicationContinuity(registry,"Open YouTube in Chrome",now+100),null);
 assert.equal(selectApplicationContinuity(registry,"YouTube search",now+601_000),null,"stale hints expire");
});

test("Chrome website supports same-session follow-up, but unrelated site cannot silently reuse",()=>{
 const registry=newApplicationContinuity();
 const launch=browserStart("chrome",987,"https://github.com/");
 assert.equal(recordAuditedApplication(registry,launch.proposal,launch.result,id,now),true);
 const observed=page(987,"https://github.com");
 assert.equal(recordAuditedApplication(registry,observed.proposal,observed.result,id,now+10),true);
 assert.equal(selectApplicationContinuity(registry,"Github pe search karo",now+20).pid,987);
 assert.equal(selectApplicationContinuity(registry,"google.com kholo",now+20),null);
 assert.equal(selectApplicationContinuity(registry,"usme search karo",now+20).pid,987);
 assert.equal(checkConfirmedContinuity(selectApplicationContinuity(registry,"Github pe search karo",now+20),
  {tool:"browser_start",arguments:{browser:"chrome"}}).allowed,false);
 assert.equal(checkConfirmedContinuity(selectApplicationContinuity(registry,"Github pe search karo",now+20),
  {tool:"browser_navigate",arguments:{pid:987,url:"https://github.com/search"}}).allowed,true);
 assert.equal(checkConfirmedContinuity(selectApplicationContinuity(registry,"Github pe search karo",now+20),
  {tool:"browser_navigate",arguments:{pid:988,url:"https://github.com/search"}}).allowed,false);
});

test("Notepad and Premiere prior HWND require fresh ui_windows, and multiple windows are ambiguous",()=>{
 const registry=newApplicationContinuity();
 const windows=[
  {Name:"Untitled - Notepad",ProcessName:"notepad.exe",ProcessId:71,NativeWindowHandle:201,ProcessStartTicks:"123456"},
  {Name:"Adobe Premiere Pro - Project 1",ProcessName:"Adobe Premiere Pro.exe",ProcessId:72,NativeWindowHandle:202,ProcessStartTicks:"123457"}
 ];
 const snapshot={tool:"ui_windows",arguments:{}};
 assert.equal(recordAuditedApplication(registry,snapshot,native("ui_windows",JSON.stringify(windows)),id,now),true);
 const notepad=selectApplicationContinuity(registry,"Notepad me text likho",now+1);
 assert.equal(notepad.pid,71);
 assert.equal(notepad.processStartTicks,"123456");
 assert.deepEqual(continuityReadback(notepad,{tool:"ui_send_keys",arguments:{window:"Untitled - Notepad",text:"Hello"}}),
  {tool:"ui_windows",arguments:{}});
 const premiere=selectApplicationContinuity(registry,"Premiere me project kholo",now+1);
 assert.equal(premiere.pid,72);
 assert.deepEqual(continuityReadback(premiere,{tool:"premiere_launch",arguments:{}}),
  {tool:"ui_windows",arguments:{}});
 assert.equal(selectApplicationContinuity(registry,"usi app me likho",now+1).kind,"ambiguous");
 const double=[...windows,{...windows[0],ProcessId:73,NativeWindowHandle:203}];
 assert.equal(recordAuditedApplication(registry,snapshot,native("ui_windows",JSON.stringify(double)),id,now+5),true);
 assert.equal(selectApplicationContinuity(registry,"Notepad me likho",now+6).kind,"ambiguous");
});

test("six-step workflow never needs to launch Chrome after a verified Edge session",()=>{
 const registry=newApplicationContinuity();
 const start=browserStart("edge",6024,"https://www.youtube.com/");
 assert.equal(recordAuditedApplication(registry,start.proposal,start.result,id,now),true);
 const state=page(6024);
 assert.equal(recordAuditedApplication(registry,state.proposal,state.result,id,now+1),true);
 const active=selectApplicationContinuity(registry,"YouTube par search, official video play pause, phir next search",now+2);
 assert.equal(active.kind,"browser");
 const steps=[
  {tool:"browser_navigate",arguments:{pid:6024,url:"https://www.youtube.com/results?search_query=Arijit+Singh"}},
  {tool:"browser_dom_read",arguments:{pid:6024,selector:"ytd-video-renderer"}},
  {tool:"browser_dom_click",arguments:{pid:6024,selector:"a#video-title"}},
  {tool:"browser_dom_click",arguments:{pid:6024,selector:"video"}},
  {tool:"browser_dom_click",arguments:{pid:6024,selector:"video"}},
  {tool:"browser_navigate",arguments:{pid:6024,url:"https://www.youtube.com/results?search_query=Shreya+Ghoshal+Songs"}}
 ];
 assert.ok(steps.every(step=>checkConfirmedContinuity(active,step).allowed));
 assert.ok(steps.every(step=>step.arguments.pid===6024));
 assert.equal(checkConfirmedContinuity(active,{tool:"browser_start",arguments:{browser:"chrome"}}).allowed,false);
 // This tests routing invariants only; it does not claim actual media playback
 // or a five-second timer happened on a real Windows host.
});

test("bad audit, missing PID, malformed readback and wrong process evidence are never promoted",()=>{
 const registry=newApplicationContinuity();
 const launch=browserStart("edge",444,"https://youtube.com/");
 assert.equal(recordAuditedApplication(registry,launch.proposal,{...launch.result,success:false},id,now),false);
 assert.equal(recordAuditedApplication(registry,launch.proposal,native("browser_start","malformed"),id,now),false);
 assert.equal(recordAuditedApplication(registry,launch.proposal,launch.result,id,now),true);
 const malformed=page(444);
 malformed.result.stdout="<html>bad</html>";
 assert.equal(recordAuditedApplication(registry,malformed.proposal,malformed.result,id,now+1),false);
 assert.equal(selectApplicationContinuity(registry,"youtube kholo",now+2),null);
});
