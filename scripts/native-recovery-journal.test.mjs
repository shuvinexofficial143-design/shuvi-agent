import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NATIVE_JOURNAL_KEY,readNativeRecovery,writeNativeRecovery,clearNativeRecovery,retireVerifiedNativeRecovery,inspectNativeRecoveryStore,assessNativeRecoveryPair} from "../web-dashboard/src/native-recovery-journal.mjs";
const makeStore=()=>{const m=new Map();return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const value={maxActions:24,stagedActions:3,modelRequests:4,expiresAt:7201000,phase:"awaiting_approval",actionId:"native_action-123"};
test("recoverable journal contains only bounded metadata and can be dismissed",()=>{
 const store=makeStore();
 assert.equal(writeNativeRecovery(store,value,1000),true);
 assert.deepEqual(readNativeRecovery(store,1001),{version:1,updatedAt:1000,...value});
 assert.deepEqual(Object.keys(JSON.parse(store.m.get(NATIVE_JOURNAL_KEY))).sort(),
  ["version","updatedAt",...Object.keys(value)].sort());
 assert.equal(clearNativeRecovery(store),true);
 assert.equal(readNativeRecovery(store,1001),null);
});
test("corrupt or forged recovery metadata never becomes valid authority",()=>{
 const store=makeStore();
 for(const patch of [{maxActions:200},{modelRequests:-1},{stagedActions:49},{phase:"execute"},
  {actionId:"<script>"},{updatedAt:70000},{expiresAt:99999999}]){
  store.m.set(NATIVE_JOURNAL_KEY,JSON.stringify({version:1,updatedAt:1000,...value,...patch}));
  assert.equal(readNativeRecovery(store,1001),null,JSON.stringify(patch));
 }
});
test("storage failure fails closed for new journal writes",()=>{
 const store={getItem(){return null},setItem(){throw Error("quota")},removeItem(){}};
 assert.equal(writeNativeRecovery(store,value,1000),false);
 assert.equal(writeNativeRecovery(null,value,1000),false);
});
test("native transport uses journal before provider dispatch and action approval",()=>{
 const text=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(text,/const previousRecoveryState=inspectNativeRecoveryStore\(recoveryStorage\)/);
 assert.match(text,/No paid model call or Windows tool action has resumed/);
 assert.match(text,/if\(route.role!=="chat"&&!await persistRecovery\(taskBudget,"model_reserved"\)\)\{/);
 assert.match(text,/if\(plannedReadback\)\{/);
 assert.match(text,/persistRecovery\(taskBudget,"readback_reserved",task.action.id\)/);
 assert.match(text,/else if\(!await persistRecovery\(taskBudget,"model_reserved",task.action.id\)\)/);
 assert.match(text,/if\(!await persistRecovery\(taskBudget,"awaiting_approval",proposed.id\)\)/);
 assert.match(text,/if\(!await persistRecovery\(taskBudget,"awaiting_approval",next.id\)\)/);
 assert.match(text,/if\(verifiedBudget&&!await persistRecovery\(verifiedBudget,"audit_verified"/);
});

test("a paused or uncertain task remains an inspection-only journal record",()=>{
 const store=makeStore();
 for(const phase of ["paused","outcome_unknown"]){
  assert.equal(writeNativeRecovery(store,{...value,phase},1000),true);
  assert.equal(readNativeRecovery(store,1001).phase,phase);
 }
 const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(native,/persistRecovery\(taskBudget,"outcome_unknown"\)/);
 assert.match(native,/persistRecovery\(taskBudget,"paused"\)/);
 assert.match(native,/route.role!=="chat"&&!await persistRecovery\(taskBudget,"model_reserved"\)/);
});

test("executing journal survives crash boundary and remains inspection-only",()=>{
 const store=makeStore();
 assert.equal(writeNativeRecovery(store,{...value,phase:"executing"},1000),true);
 const recovered=readNativeRecovery(store,2000);
 assert.equal(recovered.phase,"executing");
 assert.equal(recovered.actionId,value.actionId);
 assert.equal(recovered.modelRequests,value.modelRequests);
 assert.equal(recovered.stagedActions,value.stagedActions);
});
test("action dispatch MUST follow the durable executing write and unknown outcomes retain uncertainty",()=>{
 const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const start=source.indexOf("async function decide(allowed:boolean)");
 const stop=source.indexOf('approve.addEventListener("click"',start);
 const decide=source.slice(start,stop);
 const journal=decide.indexOf('persistRecovery(currentBudget,"executing",current.action.id)');
 const execute=decide.indexOf('invoke<ActionResult>("execute_action"');
 assert.ok(journal>=0&&execute>journal);
 const preflight=decide.slice(journal,execute);
 assert.match(preflight,/await invoke<void>\("deny_action",\{actionId:current.action.id\}\)/);
 assert.match(preflight,/recovery_journal_failed/);
 assert.match(preflight,/return;/);
 assert.match(decide,/persistRecovery\(unknownBudget,"outcome_unknown",current.action.id\)/);
 assert.match(decide,/persistRecovery\(verifiedBudget,"audit_verified",current.action.id\)/);
});

test("installed native execution must fail closed if recovery storage is absent",()=>{
 const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(source,/if\(!recoveryStorage\)return false/);
 assert.doesNotMatch(source,/if\(!recoveryStorage\)return true/);
});

test("submission acquires exclusive lock before awaiting Rust recovery disk IO",()=>{
 const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 const send=source.slice(source.indexOf("async send(text,threadId"),source.lastIndexOf("return {ok:true,reply};"));
 const lock=send.indexOf("sending=true;"),save=send.indexOf('await persistRecovery(taskBudget,"model_reserved")');
 assert.ok(lock>=0&&save>lock);
});

test("Rust journal captures terminal states after verified or uncertain native outcomes",()=>{
 const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(source,/await persistRecovery\(taskBudget,"paused",task.action.id\)/);
 assert.match(source,/const phase=failure.kind==="http_response"\?"planning_response_failed":"planning_outcome_unknown"/);
 assert.match(source,/await persistRecovery\(taskBudget,"paused"\)/);
 assert.match(source,/failure.kind==="http_response"\?"planning_response_failed":"planning_outcome_unknown"\)/);
 assert.match(source,/await persistRecovery\(unknownBudget,"outcome_unknown",current.action.id\)/);
});

test("recovered paused and audited states still require explicit owner review",()=>{
 const store=makeStore();
 for(const phase of ["paused","audit_verified"]){
  assert.equal(writeNativeRecovery(store,{...value,phase},1000),true);
  const local=inspectNativeRecoveryStore(store,1001);
  assert.equal(local.kind,"valid");
  const rust={...local.record,updatedAt:1005}; // Rust writes its own timestamp.
  assert.deepEqual(assessNativeRecoveryPair(local,rust,1006),
   {requiresReview:true,reason:"matched_previous_task"});
 }
});

test("terminal completion requires two staged actions and exact audited predecessor",()=>{
 const id="14a40d18-4df8-4cb8-ab90-0137027f3a8b",store=makeStore();
 const reserved={version:2,taskId:id,revision:1,maxActions:8,stagedActions:0,
  modelRequests:1,expiresAt:7201000,phase:"model_reserved",actionId:null};
 const save=(last,revision,phase,patch={})=>writeNativeRecovery(store,{...last,revision,phase,...patch},1000+revision);
 assert.equal(save(reserved,1,"model_reserved"),true);
 const approved={...reserved,revision:2,stagedActions:1,phase:"awaiting_approval",actionId:"first"};
 assert.equal(save(approved,2,"awaiting_approval"),true);
 const executing={...approved,revision:3,phase:"executing"};
 assert.equal(save(executing,3,"executing"),true);
 const audited={...executing,revision:4,phase:"audit_verified"};
 assert.equal(save(audited,4,"audit_verified"),true);
 assert.equal(save(audited,5,"completed_verified"),false,"one action cannot complete goal");
 assert.equal(save(audited,5,"readback_reserved"),true);
 const second={...audited,revision:6,stagedActions:2,actionId:"readback",phase:"awaiting_approval"};
 assert.equal(save(second,6,"awaiting_approval"),true);
 assert.equal(save(second,7,"executing"),true);
 assert.equal(save(second,8,"completed_verified"),false,"executing is not audit");
 assert.equal(save(second,8,"audit_verified"),true);
 const terminal={...second,revision:9,phase:"completed_verified"};
 for(const patch of [{actionId:"other"},{modelRequests:2},{stagedActions:3}])
  assert.equal(save(terminal,9,"completed_verified",patch),false);
 assert.equal(save(terminal,9,"completed_verified"),true);
 const local=inspectNativeRecoveryStore(store,1010);
 assert.deepEqual(assessNativeRecoveryPair(local,{...local.record,updatedAt:1015},1016),
  {requiresReview:true,reason:"matched_verified_completion"});
 assert.equal(save(terminal,10,"model_reserved",{modelRequests:2}),false);
 assert.equal(save(terminal,10,"paused"),false);
 assert.equal(retireVerifiedNativeRecovery(store,id,8,1010),false,"revision CAS");
 assert.equal(retireVerifiedNativeRecovery(store,"7811c24d-d01a-4b04-96ae-0d4ef664ca93",9,1010),false);
 assert.equal(retireVerifiedNativeRecovery(store,id,9,1010),true);
 assert.equal(inspectNativeRecoveryStore(store,1010).kind,"empty");
});

test("split-brain WebView and Rust recovery always fails closed",()=>{
 const store=makeStore();
 writeNativeRecovery(store,value,1000);
 const local=inspectNativeRecoveryStore(store,1001);
 const rust={...local.record,phase:"executing",actionId:"other-action",updatedAt:1005};
 assert.deepEqual(assessNativeRecoveryPair(local,rust,1006),
  {requiresReview:true,reason:"mismatched_stores"});
 assert.deepEqual(assessNativeRecoveryPair(local,null,1006),
  {requiresReview:true,reason:"missing_rust"});
 assert.deepEqual(assessNativeRecoveryPair({kind:"empty",record:null},rust,1006),
  {requiresReview:true,reason:"missing_webview"});
 assert.deepEqual(assessNativeRecoveryPair({kind:"empty",record:null},null,1006),
  {requiresReview:false,reason:"no_previous_task"});
});

test("corrupt or unreadable WebView recovery cannot silently disappear on restart",()=>{
 const store=makeStore();
 store.m.set(NATIVE_JOURNAL_KEY,"{broken JSON");
 const corrupt=inspectNativeRecoveryStore(store,1001);
 assert.equal(corrupt.kind,"invalid");
 assert.equal(corrupt.record,null);
 assert.deepEqual(assessNativeRecoveryPair(corrupt,null,1001),
  {requiresReview:true,reason:"invalid_webview"});
 const throwing={getItem(){throw Error("storage unavailable")}};
 assert.deepEqual(assessNativeRecoveryPair(inspectNativeRecoveryStore(throwing,1001),null,1001),
  {requiresReview:true,reason:"invalid_webview"});
});

test("native transport gates new Windows tasks on reconciled recovery and preserves manual clear",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(src,/const previousRecoveryState=inspectNativeRecoveryStore\(recoveryStorage\)/);
 assert.match(src,/let review=assessNativeRecoveryPair\(previousRecoveryState,rustRecovery\)/);
 assert.match(src,/recoveryAcknowledged=!review\.requiresReview/);
 assert.match(src,/if\(route\.role!=="chat"&&!recoveryAcknowledged&&!canContinueOriginalClarification\)/);
 assert.match(src,/pausedClarificationRecord\.taskId===taskRecoveryIds\.get\(pausedClarificationBudget\)/);
 assert.match(src,/await invoke<void>\("clear_native_recovery"\)/);
 assert.match(src,/if\(!clearNativeRecovery\(recoveryStorage\)\)/);
});

test("task-bound v2 checkpoints preserve identity and reject unbound or forged versions",()=>{
 const store=makeStore();
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const v2={...value,version:2,taskId};
 assert.equal(writeNativeRecovery(store,v2,1000),true);
 assert.deepEqual(readNativeRecovery(store,1001),{...v2,updatedAt:1000});
 for(const patch of [{taskId:undefined},{taskId:"bad"},{taskId:"14a40d18-4df8-4cb8-ab90-0137027f3a8B"},
  {taskId:"00000000-0000-0000-0000-000000000000"},{version:1}]){
  const candidate={...v2,...patch};
  assert.equal(writeNativeRecovery(makeStore(),candidate,1000),false,JSON.stringify(patch));
 }
});

test("equal phase and counters from different tasks cannot be reconciled as one",()=>{
 const store=makeStore();
 const original={...value,version:2,taskId:"14a40d18-4df8-4cb8-ab90-0137027f3a8b"};
 const other={...original,taskId:"7811c24d-d01a-4b04-96ae-0d4ef664ca93"};
 assert.equal(writeNativeRecovery(store,original,1000),true);
 const local=inspectNativeRecoveryStore(store,1001);
 assert.equal(local.kind,"valid");
 assert.deepEqual(assessNativeRecoveryPair(local,{...other,updatedAt:1005},1006),
  {requiresReview:true,reason:"mismatched_stores"});
 assert.deepEqual(assessNativeRecoveryPair(local,{...original,updatedAt:1005},1006),
  {requiresReview:true,reason:"matched_previous_task"});
});

test("historical v1 recovery remains readable only as evidence, not rewritten into v2",()=>{
 const store=makeStore();
 assert.equal(writeNativeRecovery(store,value,1000),true);
 const local=inspectNativeRecoveryStore(store,1001);
 assert.equal(local.kind,"valid");
 assert.equal(local.record.version,1);
 assert.equal("taskId" in local.record,false);
 assert.deepEqual(assessNativeRecoveryPair(local,{...local.record,updatedAt:1005},1006),
  {requiresReview:true,reason:"matched_previous_task"});
 assert.deepEqual(assessNativeRecoveryPair(local,{...local.record,version:2,taskId:"14a40d18-4df8-4cb8-ab90-0137027f3a8b"},1006),
  {requiresReview:true,reason:"mismatched_stores"});
});

test("native task writes task-bound checkpoint before paid request; any Rust write error latches admission",()=>{
 const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(native,/const taskRecoveryIds=new WeakMap<NativeTaskBudget,string>\(\)/);
 assert.match(native,/const id=globalThis\.crypto\?\.randomUUID\?\.\(\)/);
 assert.match(native,/version:2,taskId,revision,maxActions:b\.maxActions/);
 assert.match(native,/recoveryAcknowledged=false;[\s\S]*?if\(!writeRecovery\(b,phase,actionId\)\)return failClosed\(\)/);
 assert.match(native,/if\(!record\|\|record\.version!==2\)return failClosed\(\)/);
});

test("revisioned WebView journal rejects stale duplicate and cross-task replacement",()=>{
 const store=makeStore();
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const first={...value,version:2,taskId,revision:1,phase:"model_reserved",
  modelRequests:1,stagedActions:0,actionId:null};
 assert.equal(writeNativeRecovery(store,first,1000),true);
 const snapshot=store.m.get(NATIVE_JOURNAL_KEY);
 assert.equal(writeNativeRecovery(store,first,1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:3},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,
  taskId:"7811c24d-d01a-4b04-96ae-0d4ef664ca93"},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,modelRequests:0},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,stagedActions:2},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,expiresAt:7200999},1001),false);
 assert.equal(writeNativeRecovery(store,value,1001),false,"v1 must not overwrite v2");
 assert.equal(store.m.get(NATIVE_JOURNAL_KEY),snapshot,"no rejected write may alter journal");
 const second={...first,revision:2,phase:"awaiting_approval",
  stagedActions:1,actionId:"native_action-123"};
 assert.equal(writeNativeRecovery(store,second,1002),true);
 assert.equal(readNativeRecovery(store,1003).revision,2);
 const executing={...second,revision:3,phase:"executing"};
 assert.equal(writeNativeRecovery(store,executing,1004),true);
 assert.equal(readNativeRecovery(store,1005).revision,3);
 const audited={...executing,revision:4,phase:"audit_verified"};
 assert.equal(writeNativeRecovery(store,audited,1005),true);
});

test("recovery journal cannot resume revision chain after local evidence disappears",()=>{
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const store=makeStore(),first={...value,version:2,taskId,revision:1,phase:"model_reserved",
  modelRequests:1,stagedActions:0,actionId:null};
 assert.equal(writeNativeRecovery(store,first,1000),true);
 store.m.delete(NATIVE_JOURNAL_KEY);
 assert.equal(writeNativeRecovery(store,{...first,revision:2},1001),false);
 assert.equal(writeNativeRecovery(store,first,1001),true);
 store.m.set(NATIVE_JOURNAL_KEY,"{broken");
 assert.equal(writeNativeRecovery(store,{...first,revision:2},1002),false);
 assert.equal(store.m.get(NATIVE_JOURNAL_KEY),"{broken");
});

test("local recovery rejects forged execution and audit revisions without modifying journal",()=>{
 const store=makeStore();
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const first={...value,version:2,taskId,revision:1,phase:"model_reserved",
  modelRequests:1,stagedActions:0,actionId:null};
 assert.equal(writeNativeRecovery(store,first,1000),true);
 const original=store.m.get(NATIVE_JOURNAL_KEY);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,phase:"audit_verified"},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,phase:"executing",actionId:"wrong"},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,phase:"awaiting_approval"},1001),false);
 assert.equal(writeNativeRecovery(store,{...first,revision:2,phase:"model_reserved"},1001),false);
 assert.equal(store.m.get(NATIVE_JOURNAL_KEY),original);
 const approved={...first,revision:2,phase:"awaiting_approval",
  stagedActions:1,actionId:"native_action-123"};
 assert.equal(writeNativeRecovery(store,approved,1002),true);
 assert.equal(writeNativeRecovery(store,{...approved,revision:3,phase:"executing"},1003),true);
 const executing=store.m.get(NATIVE_JOURNAL_KEY);
 assert.equal(writeNativeRecovery(store,{...approved,revision:4,phase:"executing"},1004),false);
 assert.equal(writeNativeRecovery(store,{...approved,revision:4,phase:"paused"},1004),false);
 assert.equal(writeNativeRecovery(store,{...approved,revision:4,phase:"model_reserved",modelRequests:2},1004),false);
 assert.equal(store.m.get(NATIVE_JOURNAL_KEY),executing);
 assert.equal(writeNativeRecovery(store,{...approved,revision:4,phase:"audit_verified"},1004),true);
});

test("revisioned v2 initial checkpoint must be a single reservation with no action",()=>{
 const id="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const first={...value,version:2,taskId:id,revision:1,phase:"model_reserved",
  modelRequests:1,stagedActions:0,actionId:null};
 assert.equal(writeNativeRecovery(makeStore(),first,1000),true);
 for(const patch of [
  {phase:"executing"},{phase:"audit_verified"},{phase:"paused"},
  {phase:"awaiting_approval"},{modelRequests:0},{modelRequests:2},
  {stagedActions:1},{actionId:"fabricated-action"},{revision:2}
 ]){
  assert.equal(writeNativeRecovery(makeStore(),{...first,...patch},1000),false,
   JSON.stringify(patch));
 }
});

test("a possibly executed action must become unknown or audited before a new approval",()=>{
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b",store=makeStore();
 const reserved={version:2,taskId,revision:1,maxActions:8,modelRequests:1,
  stagedActions:0,expiresAt:7201000,phase:"model_reserved",actionId:null};
 assert.equal(writeNativeRecovery(store,reserved,1000),true);
 const prepared={...reserved,revision:2,stagedActions:1,
  phase:"awaiting_approval",actionId:"action-1"};
 assert.equal(writeNativeRecovery(store,prepared,1001),true);
 const executing={...prepared,revision:3,phase:"executing"};
 assert.equal(writeNativeRecovery(store,executing,1002),true);
 assert.equal(writeNativeRecovery(store,{...executing,revision:4,phase:"paused"},1003),false);
 assert.equal(writeNativeRecovery(store,{...executing,revision:4,phase:"model_reserved",modelRequests:2},1003),false);
 assert.equal(writeNativeRecovery(store,{...executing,revision:4,phase:"awaiting_approval",
  stagedActions:2,actionId:"action-2"},1003),false);
 const unknown={...executing,revision:4,phase:"outcome_unknown"};
 assert.equal(writeNativeRecovery(store,unknown,1003),true);
 assert.equal(writeNativeRecovery(store,{...unknown,revision:5,phase:"paused"},1004),false);
 assert.equal(writeNativeRecovery(store,{...unknown,revision:5,phase:"model_reserved",modelRequests:2},1004),false);
 const observed={...unknown,revision:5,phase:"awaiting_approval",
  stagedActions:2,actionId:"read-only-inspection"};
 assert.equal(writeNativeRecovery(store,observed,1004),true,
  "separately verified UI recovery can stage a fresh inspection after an unknown outcome");
});

test("model-free audited readback uses two durable transitions without a new paid request",()=>{
 const store=makeStore(), taskId="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
 const first={
   version:2,taskId,revision:1,maxActions:8,stagedActions:0,
   modelRequests:1,expiresAt:7201000,phase:"model_reserved",actionId:null
 };
 const attempt=(patch,now)=>writeNativeRecovery(store,{...patch},now);
 assert.equal(attempt(first,1000),true);
 const approved={...first,revision:2,phase:"awaiting_approval",stagedActions:1,actionId:"action-1"};
 assert.equal(attempt(approved,1001),true);
 const running={...approved,revision:3,phase:"executing"};
 assert.equal(attempt(running,1002),true);
 const audited={...running,revision:4,phase:"audit_verified"};
 assert.equal(attempt(audited,1003),true);
 const second={...audited,revision:5,phase:"awaiting_approval",stagedActions:2,actionId:"action-2"};
 assert.equal(attempt(second,1004),false,"a new UUID cannot appear directly after an audit without a reservation");
 const readback={...audited,revision:5,phase:"readback_reserved"};
 assert.equal(attempt(readback,1004),true);
 const recorded=readNativeRecovery(store,1005);
 assert.equal(recorded.phase,"readback_reserved");
 assert.equal(recorded.modelRequests,1,"deterministic readback spends no provider request");
 assert.equal(recorded.stagedActions,1,"native staging count changes only for a new action");
 assert.equal(attempt({...second,revision:6,actionId:"action-1"},1005),false,
   "cannot replay the old audited UUID");
 assert.equal(attempt({...second,revision:6,modelRequests:2},1005),false,
   "no hidden paid provider reservation");
 assert.equal(attempt({...second,revision:6,stagedActions:1},1005),false,
   "readback must consume another bounded native action stage");
 assert.equal(attempt({...second,revision:6,phase:"executing"},1005),false,
   "fresh owner approval phase is mandatory");
 assert.equal(attempt({...second,revision:6},1005),true);
 const approvedRecord=readNativeRecovery(store,1006);
 assert.equal(approvedRecord.actionId,"action-2");
 assert.equal(approvedRecord.modelRequests,1);
 assert.equal(approvedRecord.stagedActions,2);
});
test("readback reservation rejects unknown, executing, forged and stale native records",()=>{
 const taskId="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
 const base={version:2,taskId,revision:1,maxActions:8,stagedActions:0,
   modelRequests:1,expiresAt:7201000,phase:"model_reserved",actionId:null};
 const setup=phase=>{
   const store=makeStore();assert.equal(writeNativeRecovery(store,base,1000),true);
   const approved={...base,revision:2,phase:"awaiting_approval",stagedActions:1,actionId:"action-1"};
   assert.equal(writeNativeRecovery(store,approved,1001),true);
   const executing={...approved,revision:3,phase:"executing"};
   assert.equal(writeNativeRecovery(store,executing,1002),true);
   if(phase==="executing")return {store,previous:executing,revision:4};
   const audited={...executing,revision:4,phase:"audit_verified"};
   assert.equal(writeNativeRecovery(store,audited,1003),true);
   return {store,previous:audited,revision:5};
 };
 for(const [previousPhase,patch] of [
   ["executing",{}],
   ["audit_verified",{modelRequests:2}],
   ["audit_verified",{actionId:"forged-action"}],
   ["audit_verified",{stagedActions:2}],
   ["audit_verified",{taskId:"e8b36b21-1c6a-459e-9b6f-75dd5692ab81"}]
 ]){
   const x=setup(previousPhase);
   assert.equal(writeNativeRecovery(x.store,{...x.previous,
     revision:x.revision,phase:"readback_reserved",...patch},1005),false,
     JSON.stringify({previousPhase,patch}));
 }
});

test("Rust-audited native denial records an action-bound terminal owner-review phase",()=>{
 const store=makeStore();
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b",actionId="action-1";
 const base={maxActions:8,stagedActions:0,modelRequests:1,expiresAt:7201000,
  version:2,taskId,actionId:null,phase:"model_reserved",revision:1};
 assert.equal(writeNativeRecovery(store,base,1000),true);
 const approved={...base,revision:2,phase:"awaiting_approval",stagedActions:1,actionId};
 assert.equal(writeNativeRecovery(store,approved,1001),true);
 const dispatched={...approved,revision:3,phase:"executing"};
 assert.equal(writeNativeRecovery(store,dispatched,1002),true);
 // An executing checkpoint MUST NOT become a normal paused checkpoint.
 assert.equal(writeNativeRecovery(store,{...dispatched,revision:4,phase:"paused"},1003),false);
 const denied={...dispatched,revision:4,phase:"native_denied"};
 assert.equal(writeNativeRecovery(store,{...denied,modelRequests:2},1003),false);
 assert.equal(writeNativeRecovery(store,denied,1003),true);
 assert.equal(readNativeRecovery(store,1004).phase,"native_denied");
 assert.equal(writeNativeRecovery(store,{...denied,revision:5,phase:"model_reserved",modelRequests:2},1004),false);
 assert.equal(writeNativeRecovery(store,{...denied,revision:5,phase:"executing"},1004),false);
 assert.equal(writeNativeRecovery(store,{...denied,revision:5,phase:"awaiting_approval",stagedActions:2,actionId:"new"},1004),false);
 assert.equal(assessNativeRecoveryPair(inspectNativeRecoveryStore(store,1004),
   {...denied,updatedAt:1005},1006).requiresReview,true);
});
test("native_denied cannot be forged without an action-bound revisioned v2 checkpoint",()=>{
 const store=makeStore();
 const taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const invalid={...value,phase:"native_denied"};
 assert.equal(writeNativeRecovery(store,invalid,1000),false);
 assert.equal(writeNativeRecovery(store,{...invalid,version:2,taskId,revision:1},1000),false);
 const rust=readFileSync(new URL("../src-tauri/src/native_recovery.rs",import.meta.url),"utf8");
 assert.match(rust,/next\.phase=="native_denied"/);
 assert.match(rust,/previous\.phase!="executing"/);
 assert.match(rust,/previous\.action_id!=next\.action_id/);
 assert.match(rust,/next\.action_id\.is_none\(\)/);
});

test("native-denied recovery never silently opens admission for a new Windows task",()=>{
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(src,/phase==="outcome_unknown"\|\|phase==="native_denied"/);
 assert.match(src,/recoveryAcknowledged=false/);
 assert.match(src,/Review Activity\/Audit and acknowledge this prior task/);
 assert.match(src,/if\(route\.role!=="chat"&&!recoveryAcknowledged&&!canContinueOriginalClarification\)/);
});
test("Rust and WebView agree native_denied must be revisioned v2 evidence",()=>{
 const source=readFileSync(new URL("../src-tauri/src/native_recovery.rs",import.meta.url),"utf8");
 assert.match(source,/value\.phase=="native_denied"/);
 assert.match(source,/value\.revision\.is_none\(\)/);
 assert.match(source,/value\.version!=2/);
 const journal=readFileSync(new URL("../web-dashboard/src/native-recovery-journal.mjs",import.meta.url),"utf8");
 assert.match(journal,/record\.phase==="native_denied"/);
 assert.match(journal,/!Number\.isSafeInteger\(record\.revision\)/);
});
