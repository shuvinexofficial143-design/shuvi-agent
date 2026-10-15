import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NATIVE_JOURNAL_KEY,readNativeRecovery,writeNativeRecovery,clearNativeRecovery,inspectNativeRecoveryStore,assessNativeRecoveryPair} from "../web-dashboard/src/native-recovery-journal.mjs";
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
 assert.match(text,/if\(!plannedReadback&&!await persistRecovery\(taskBudget,"model_reserved",task.action.id\)\)/);
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
 assert.match(source,/await persistRecovery\(taskBudget,"outcome_unknown",task.action.id\)/);
 assert.match(source,/await persistRecovery\(taskBudget,"paused"\)/);
 assert.match(source,/await persistRecovery\(taskBudget,"outcome_unknown"\)/);
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
 assert.match(src,/const review=assessNativeRecoveryPair\(previousRecoveryState,rustRecovery\)/);
 assert.match(src,/recoveryAcknowledged=!review\.requiresReview/);
 assert.match(src,/if\(route\.role!=="chat"&&!recoveryAcknowledged\)/);
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
