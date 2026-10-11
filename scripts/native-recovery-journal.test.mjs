import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {NATIVE_JOURNAL_KEY,readNativeRecovery,writeNativeRecovery,clearNativeRecovery} from "../web-dashboard/src/native-recovery-journal.mjs";
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
 assert.match(text,/if\(route.role!=="chat"&&!writeRecovery\(taskBudget,"model_reserved"\)\)return/);
 assert.match(text,/if\(!writeRecovery\(taskBudget,"model_reserved",task.action.id\)\)/);
 assert.match(text,/if\(!writeRecovery\(taskBudget,"awaiting_approval",proposed.id\)\)/);
 assert.match(text,/if\(!writeRecovery\(taskBudget,"awaiting_approval",next.id\)\)/);
 assert.match(text,/if\(verifiedBudget&&!writeRecovery\(verifiedBudget,"audit_verified"/);
});

test("a paused or uncertain task remains an inspection-only journal record",()=>{
 const store=makeStore();
 for(const phase of ["paused","outcome_unknown"]){
  assert.equal(writeNativeRecovery(store,{...value,phase},1000),true);
  assert.equal(readNativeRecovery(store,1001).phase,phase);
 }
 const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(native,/writeRecovery\(taskBudget,"outcome_unknown"\)/);
 assert.match(native,/writeRecovery\(taskBudget,"paused"\)/);
 assert.match(native,/route.role!=="chat"&&!writeRecovery\(taskBudget,"model_reserved"\)/);
});
