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
 assert.match(text,/const previousRecovery=readNativeRecovery\(recoveryStorage\)/);
 assert.match(text,/No paid model call or Windows tool action has resumed/);
 assert.match(text,/if\(route.role!=="chat"&&!await persistRecovery\(taskBudget,"model_reserved"\)\)\{/);
 assert.match(text,/if\(!await persistRecovery\(taskBudget,"model_reserved",task.action.id\)\)/);
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
