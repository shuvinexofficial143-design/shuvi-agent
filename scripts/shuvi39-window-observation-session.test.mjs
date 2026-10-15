import test from "node:test";
import assert from "node:assert/strict";
import {
 newAuditedWindowObservation,currentObservedWindows,MAX_WINDOW_OBSERVATION_AGE_MS
} from "../web-dashboard/src/native-window-observation-session.mjs";
import {checkObservedMutationTarget,checkAmbiguousReadWindow} from "../web-dashboard/src/native-window-target-guard.mjs";
import {summarizeWindowObservation} from "../web-dashboard/src/native-window-observation.mjs";
import {readFileSync} from "node:fs";

const actionA="123e4567-e89b-42d3-a456-426614174000";
const actionB="123e4567-e89b-42d3-a456-426614174001";
const win=(Name,ProcessId,NativeWindowHandle,ProcessName)=>({
 Name,ProcessId,NativeWindowHandle,ProcessName
});
const base=[
 win("Shuvi - Allow once",100,800,"Shuvi"),
 win("Adobe Premiere Pro 2026",200,900,"Premiere")
];
const inventory=(rows=base,patch={})=>({
 success:true,tool:"ui_windows",exit_code:0,stdout:JSON.stringify(rows),...patch
});
const click=window=>({tool:"ui_click",arguments:{window}});
const lookup=(tool,window)=>({tool,arguments:{window}});
const observe=(rows=base)=>newAuditedWindowObservation(inventory(rows),actionA,10_000);

test("preserves exact read-only task-scoped HWND, PID, app and audited action identity",()=>{
 const s=observe();
 assert.equal(s.version,1);
 assert.equal(s.sourceTool,"ui_windows");
 assert.equal(s.sourceActionId,actionA);
 assert.equal(s.observedAtMs,10_000);
 assert.equal(s.expiresAtMs,10_000+MAX_WINDOW_OBSERVATION_AGE_MS);
 assert.deepEqual(s.windows.map(w=>[w.hwnd,w.pid]),[[800,100],[900,200]]);
 assert.equal(s.windows[1].app,"premiere");
 assert.ok(Object.isFrozen(s)&&Object.isFrozen(s.windows)&&Object.isFrozen(s.windows[1]));
 assert.equal(checkObservedMutationTarget(click("Adobe Premiere Pro 2026"),
  currentObservedWindows(s,10001)).allowed,true);
});

test("observation expires exactly at TTL and cannot silently downgrade into no-prior-observation",()=>{
 const s=observe();
 assert.equal(currentObservedWindows(s,10_000+MAX_WINDOW_OBSERVATION_AGE_MS-1).length,2);
 const stale=currentObservedWindows(s,10_000+MAX_WINDOW_OBSERVATION_AGE_MS);
 assert.deepEqual(stale,[]);
 assert.equal(checkObservedMutationTarget(click("Adobe Premiere Pro 2026"),stale).allowed,false);
 assert.equal(checkAmbiguousReadWindow(lookup("ui_discover","Adobe Premiere Pro 2026"),stale).allowed,false);
 assert.deepEqual(currentObservedWindows(s,9999),[]);
});

test("separate native action IDs produce distinct observations, not portable consent tokens",()=>{
 const a=observe();
 const b=newAuditedWindowObservation(inventory(base),actionB,10_000);
 assert.notEqual(a.sourceActionId,b.sourceActionId);
 assert.equal(newAuditedWindowObservation(inventory(base),"from\\nmodel",10_000),null);
 assert.equal(newAuditedWindowObservation(inventory(base),"action-1",10_000).sourceActionId,"action-1");
 assert.equal(newAuditedWindowObservation(inventory(base),"x".repeat(129),10_000),null);
 assert.equal(newAuditedWindowObservation(inventory(base),actionA,-1),null);
 assert.equal(newAuditedWindowObservation(inventory(base),actionA,Number.MAX_SAFE_INTEGER),null);
});

test("a forged, malformed or failed ui_windows result cannot mint an observation",()=>{
 for(const bad of [
  inventory(base,{success:false}),inventory(base,{tool:"ui_find"}),
  inventory(base,{exit_code:1}),inventory(base,{stdout:"{broken"}),
  inventory([]),inventory(base,{stdout:"x".repeat(250001)})
 ])assert.equal(newAuditedWindowObservation(bad,actionA,10_000),null);
});

test("duplicate HWND identity and negative PID prevent a new snapshot",()=>{
 const duplicate=[
  win("Adobe Premiere Pro",200,900,"Premiere"),
  win("Adobe Premiere Pro - Child",200,900,"Premiere")
 ];
 assert.equal(observe(duplicate),null);
 assert.equal(observe([win("Premiere",0,900,"Premiere")]),null);
 assert.equal(observe([win("Premiere",200,0,"Premiere")]),null);
});

test("duplicate title across distinct HWND/PID blocks both reads and mutations",()=>{
 const s=observe([
  win("Adobe Premiere Pro",200,901,"Premiere"),
  win("Adobe Premiere Pro",201,902,"Premiere")
 ]);
 const windows=currentObservedWindows(s,10001);
 assert.equal(checkObservedMutationTarget(click("Adobe Premiere Pro"),windows).allowed,false);
 assert.equal(checkAmbiguousReadWindow(lookup("ui_find","Adobe Premiere Pro"),windows).allowed,false);
 assert.equal(checkAmbiguousReadWindow(lookup("inspect_screen","Adobe Premiere Pro"),windows).allowed,false);
});

test("Shuvi foreground does not make its HWND the approved Premiere capture target",()=>{
 const observed=currentObservedWindows(observe(),10001);
 assert.equal(checkAmbiguousReadWindow(lookup("inspect_screen","Adobe Premiere Pro 2026"),observed).allowed,true);
 assert.equal(checkAmbiguousReadWindow(lookup("inspect_screen","Premiere"),observed).allowed,false);
 assert.equal(checkAmbiguousReadWindow(lookup("inspect_screen","Other App"),observed).allowed,false);
});

test("full desktop is distinct and still requires independent native owner permission",()=>{
 const rows=currentObservedWindows(observe(),10001);
 const gate=checkAmbiguousReadWindow(lookup("inspect_screen","desktop"),rows);
 assert.equal(gate.allowed,true);
 assert.match(gate.reason,/native_approval/);
});

test("a stale observation blocks paid target inspection instead of sending wrong pixels",()=>{
 const s=observe();
 const stale=currentObservedWindows(s,999999);
 assert.equal(checkAmbiguousReadWindow(lookup("inspect_screen","Adobe Premiere Pro 2026"),stale).allowed,false);
});

test("source summary must not show plausible controls if source inventory is contradictory",()=>{
 const fake=inventory([
  win("Adobe Premiere Pro",200,900,"Premiere"),
  win("Other",0,0,"")
 ]);
 const summary=summarizeWindowObservation(fake,true);
 assert.match(summary,/no trustworthy unique window inventory/);
 assert.doesNotMatch(summary,/Observed sample/);
});

test("snapshot is not created by a non-audited or mixed tool result",()=>{
 assert.equal(newAuditedWindowObservation({success:true,tool:"ui_find",stdout:"[]"},actionA,10000),null);
 const code=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(code,/newAuditedWindowObservation\(result,current\.action\.id\)/);
 assert.match(code,/currentObservedWindows\(observedWindows\.get\(id\)\)/);
 assert.match(code,/observedWindows\.has\(id\)/);
 assert.match(code,/const verified=verifiedExecutionReceipt\(current\.action,result,receipts\)/);
});

test("invalidations do not fallback to unrestricted mutation when snapshot has existed",()=>{
 const rows=currentObservedWindows(null,10001);
 assert.deepEqual(rows,[]);
 assert.equal(checkObservedMutationTarget(click("Adobe Premiere Pro 2026"),rows).allowed,false);
});
