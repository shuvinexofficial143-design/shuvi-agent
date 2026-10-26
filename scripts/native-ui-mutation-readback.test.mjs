import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nextAuditedUiMutationReadback} from "../web-dashboard/src/native-ui-mutation-readback.mjs";

const before={
 readbackRequired:true,sourceActionId:"mutate-1",windowSourceActionId:"old-windows-1",
 mutationTool:"ui_set_value",observedAtMs:1000,
 title:"Notes - Notepad",pid:123,hwnd:987,processStartTicks:"123456789012345678",
 controlName:"Text Editor",automationId:"15"
};
const fresh={
 version:1,sourceTool:"ui_windows",sourceActionId:"windows-2",
 observedAtMs:1200,expiresAtMs:121200,
 windows:[{title:before.title,process:"notepad",pid:before.pid,hwnd:before.hwnd,
   processStartTicks:before.processStartTicks,app:"unknown"}]
};
test("audited UI mutation stages a DIFFERENT, separately approved ui_windows read with no model proposal",()=>{
 assert.deepEqual(nextAuditedUiMutationReadback("mutate-1","ui_set_value",before,null,1100),
  {proposal:{tool:"ui_windows",arguments:{}}});
 assert.equal(nextAuditedUiMutationReadback("other","ui_set_value",null,null,1100),null);
});
test("fresh exact HWND/PID/start-ticks matches and stages one exact read-only control lookup",()=>{
 assert.deepEqual(nextAuditedUiMutationReadback("windows-2","ui_windows",before,fresh,1300),{
  proposal:{tool:"ui_find",arguments:{window:before.title,name:before.controlName,automation_id:"15"}}
 });
});
test("replacement same-title window, recycled handle, start-ticks changes and duplicated identity fail closed",()=>{
 for(const changed of [
  [{...fresh.windows[0],pid:321}],
  [{...fresh.windows[0],hwnd:654}],
  [{...fresh.windows[0],processStartTicks:"123456789012345679"}],
  [fresh.windows[0],{...fresh.windows[0]}],
  []
 ]){
  const decision=nextAuditedUiMutationReadback("windows-2","ui_windows",before,
   {...fresh,windows:changed},1300);
  assert.equal(typeof decision?.blocked,"string");
  assert.equal(decision?.proposal,undefined);
 }
});
test("stale, old, mismatched or spoofed window receipts cannot become safe follow-up",()=>{
 for(const session of [
  null,
  {...fresh,sourceActionId:"wrong"},
  {...fresh,sourceActionId:before.sourceActionId},
  {...fresh,sourceActionId:before.windowSourceActionId},
  {...fresh,observedAtMs:999,expiresAtMs:120999},
  {...fresh,expiresAtMs:1250},
  {...fresh,sourceTool:"ui_find"}
 ]){
  assert.ok(nextAuditedUiMutationReadback("windows-2","ui_windows",before,session,1300)?.blocked);
 }
});
test("missing original selector/window and unrelated reads never fall through to a paid AI replan",()=>{
 for(const modified of [
  {...before,controlName:"",automationId:""},
  {...before,hwnd:null},
  {...before,windowSourceActionId:null},
  {...before,controlName:"Text\u202eEditor",automationId:""},
  {...before,processStartTicks:"0"}
 ])assert.ok(nextAuditedUiMutationReadback("mutate-1","ui_set_value",modified,null,1100)?.blocked);
 for(const tool of ["ui_find","ui_discover","browser_page_state","ui_click"])
  assert.ok(nextAuditedUiMutationReadback("unrelated-9",tool,before,fresh,1300)?.blocked);
});
test("native continuation stages audited model-free probes through existing approval and recovery gates",()=>{
 const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(source,/nextAuditedUiMutationReadback\(task\.action\.id,result\.tool/);
 assert.match(source,/if\(boundUiReadback\?\.blocked\)/);
 assert.match(source,/boundUiReadback\?\.proposal\?\?premiereRead/);
 assert.match(source,/persistRecovery\(taskBudget,"readback_reserved",task\.action\.id\)/);
 assert.match(source,/await invoke<Pending>\("prepare_tool"/);
 assert.match(source,/markNativeActionStaged\(taskBudget\)/);
 assert.match(source,/validPreparedApproval\(next\)/);
 assert.match(source,/nativeReadbackGate\(task\.threadId,response\.tool_proposal\)/);
});
