import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createNativeTaskBudget,reserveNativeModelRequest,canStageNativeAction,canExecuteNativeAction,markNativeActionStaged} from "../web-dashboard/src/native-task-budget.mjs";
const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("native budgets are explicitly finite and cannot be forged or silently extended",()=>{
 for(const actions of [0,6,12,49,Infinity,NaN,undefined])assert.equal(createNativeTaskBudget(actions,1000),null);
 for(const actions of [8,24,48]){
  const b=createNativeTaskBudget(actions,1000);
  assert.ok(b);
  for(let i=0;i<actions;i++)assert.equal(markNativeActionStaged(b,1001+i),true);
  assert.equal(canStageNativeAction(b,1001+actions),false);
  assert.equal(markNativeActionStaged(b,1001+actions),false);
  for(let i=0;i<actions+1;i++)assert.equal(reserveNativeModelRequest(b,1001+i),true);
  assert.equal(reserveNativeModelRequest(b,1300),false);
 }
});
test("native task budget cannot authorize model calls or stages after expiry",()=>{
 const b=createNativeTaskBudget(24,1000);
 assert.equal(reserveNativeModelRequest(b,1000+2*60*60*1000),false);
 assert.equal(markNativeActionStaged(b,1000+2*60*60*1000),false);
 assert.equal(reserveNativeModelRequest({...b,modelRequests:NaN},1001),false);
 assert.equal(markNativeActionStaged({...b,stagedActions:-1},1001),false);
});
test("native UI exposes owner choice and verifies each paid continuation before dispatch",()=>{
 assert.match(native,/budgetSelect.value="8"/);
 assert.match(native,/for\(const count of \[8,24,48\]\)/);
 const follow=native.slice(native.indexOf("async function continueAfterVerifiedAction"),native.indexOf("async function prepareAuditedUiReadRecovery"));
 const reserve=follow.indexOf("reserveNativeModelRequest(taskBudget)");
 const paid=follow.indexOf('invoke<NativeChatResponse>("chat"');
 const guard=follow.indexOf("canStageNativeAction(taskBudget)");
 const staging=follow.indexOf('invoke<Pending>("prepare_tool"');
 assert.ok(reserve>=0&&paid>reserve&&guard>=0&&staging>paid&&staging>guard);
 assert.match(follow,/plannedReadback\?canStageNativeAction\(taskBudget\):reserveNativeModelRequest\(taskBudget\)/);
 assert.match(follow,/if\(!plannedReadback&&!await persistRecovery\(taskBudget,"model_reserved"/);
 assert.match(follow,/markNativeActionStaged\(taskBudget\)/);
 const first=native.slice(native.indexOf("async send(text,threadId"),native.lastIndexOf("\n } ;"));
 assert.match(native,/taskBudgets.set\(threadId,taskBudget\)/);
 assert.match(native,/if\(!canStageNativeAction\(taskBudget\)\)throw Error/);
 assert.match(native,/if\(!markNativeActionStaged\(taskBudget\)\)/);
 assert.match(native,/taskBudgets.delete\(threadId\)/);
 assert.match(native,/taskBudgets.clear\(\)/);
});

test("staged Windows action loses execution authority when owner deadline expires",()=>{
 const b=createNativeTaskBudget(8,1000);
 assert.equal(canExecuteNativeAction(b,1001),false);
 assert.equal(markNativeActionStaged(b,1001),true);
 assert.equal(canExecuteNativeAction(b,1002),true);
 assert.equal(canExecuteNativeAction(b,b.expiresAt),false);
 assert.equal(canExecuteNativeAction({...b,modelRequests:99},1002),false);
});
test("native approval rechecks budget before the actual OS execution IPC",()=>{
 const current=native.slice(native.indexOf("async function decide("),native.indexOf("approve.addEventListener("));
 const check=current.indexOf("canExecuteNativeAction(currentBudget)");
 const execute=current.indexOf('invoke<ActionResult>("execute_action"');
 assert.ok(check>=0&&execute>check);
 assert.match(current,/await invoke<void>\("deny_action",\{actionId:current.action.id\}\)/);
 assert.match(current,/owner_budget_expired/);
});
