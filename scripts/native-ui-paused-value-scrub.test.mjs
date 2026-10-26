import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newPendingUiReadback,scrubPausedUiReadback,checkPendingUiReadback,auditUiReadback}
 from "../web-dashboard/src/native-ui-readback-session.mjs";
const win={version:1,sourceTool:"ui_windows",sourceActionId:"before-win",
 observedAtMs:100,expiresAtMs:120100,
 windows:[{title:"Notes",process:"notepad",pid:142,hwnd:999,
 processStartTicks:"12345678901234",app:"unknown"}]};
const proposal={tool:"ui_set_value",arguments:{
 window:"Notes",name:"Editor",automation_id:"body",value:"private long text 123456"}};
test("a paused native task scrubs private approved text but preserves the no-second-mutation readback barrier",()=>{
 const original=newPendingUiReadback("mutation-1",proposal,win,200);
 assert.equal(original.expectedValue,proposal.arguments.value);
 const paused=scrubPausedUiReadback(original);
 assert.equal(paused.expectedValue,null);
 assert.equal(paused.readbackRequired,true);
 assert.equal(paused.sourceActionId,"mutation-1");
 assert.equal(paused.hwnd,999);
 assert.notEqual(paused,original);
 assert.ok(Object.isFrozen(paused));
 assert.doesNotMatch(JSON.stringify(paused),/private long text 123456/);
 const second={tool:"ui_click",arguments:{window:"Notes",name:"Save"}};
 assert.equal(checkPendingUiReadback(second,paused).allowed,false);
});
test("scrub is idempotent and cannot reconstruct the previous SetValue value",()=>{
 assert.equal(scrubPausedUiReadback(null),null);
 assert.equal(scrubPausedUiReadback({readbackRequired:false}),null);
 const s=scrubPausedUiReadback(newPendingUiReadback("mutation-1",proposal,win,200));
 assert.equal(scrubPausedUiReadback(s),s);
 const after={...win,sourceActionId:"after-win",observedAtMs:250,expiresAtMs:120250};
 const read={tool:"ui_find",arguments:{window:"Notes",name:"Editor",automation_id:"body"}};
 const result={tool:"ui_find",success:true,exit_code:0,stdout:JSON.stringify({
  Name:"Editor",AutomationId:"body",ObservedWindowHwnd:999,ObservedWindowPid:142,
  ObservedWindowProcessStartTicks:"12345678901234",Value:proposal.arguments.value
 })};
 assert.equal(auditUiReadback(s,read,result,after,400,"read-id"),s);
});
test("native task halting scrubs ONLY in-memory evidence; retains no-replay and approval safety gates",()=>{
 const agent=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const begin=agent.indexOf("function haltTask(id:string,why:string)");
 const end=agent.indexOf("function updateReply(",begin);
 assert.ok(begin>=0&&end>begin);
 const block=agent.slice(begin,end);
 assert.match(block,/pendingUiReadback\.set\(id,scrubPausedUiReadback/);
 assert.match(agent,/nativeReadbackGate\(task\.threadId,response\.tool_proposal\)/);
 assert.match(agent,/persistRecovery\(taskBudget,"readback_reserved",task\.action\.id\)/);
});
