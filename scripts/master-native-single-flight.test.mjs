import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createMasterNativeSingleFlight} from "../src/master-native-single-flight.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const SECOND="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
test("Allow Once double clicks never issue a second same-UUID native execution",()=>{
 const gate=createMasterNativeSingleFlight(),scope={taskId:TASK,revoked:false};
 const a=gate.acquire(scope,ACTION);assert.ok(a);
 assert.equal(gate.acquire(scope,ACTION),null);
 assert.equal(gate.acquire(scope,SECOND),null);
 assert.equal(gate.acquire({...scope},ACTION),null);
 assert.equal(a.release(),true);
 assert.equal(a.release(),false);
 assert.ok(gate.acquire(scope,SECOND));
});
test("new task cannot overlap unknown old Windows side effect until its IPC settles",async()=>{
 const gate=createMasterNativeSingleFlight(),old={taskId:TASK,revoked:false};
 let release;const done=new Promise(x=>release=x);
 const first=gate.acquire(old,ACTION),newScope={...old};
 assert.ok(first);
 const wait=(async()=>{await done;first.release()})();
 old.revoked=true;
 assert.equal(gate.acquire(newScope,SECOND),null);
 release();await wait;
 assert.ok(gate.acquire(newScope,SECOND));
});
test("forged action or invalid revoked task may not acquire even when idle",()=>{
 const gate=createMasterNativeSingleFlight();
 assert.equal(gate.acquire(null,ACTION),null);
 assert.equal(gate.acquire({taskId:TASK,revoked:true},ACTION),null);
 assert.equal(gate.acquire({taskId:"bad",revoked:false},ACTION),null);
 assert.equal(gate.acquire({taskId:TASK,revoked:false},"bad"),null);
});
test("the Desktop acquires BEFORE deadline/IPC and releases after existing audit finally",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("async function executePendingProposal");
 const end=ui.indexOf("function renderChatPermission",start);
 const body=ui.slice(start,end);
 const a=body.indexOf("const nativeFlight=masterNativeSingleFlight.acquire");
 const budget=body.indexOf("if (!taskDeadlineAllows");
 const execution=body.indexOf('invoke<ActionResult>("execute_action"');
 const local=body.indexOf("clearExecutingAction(actionId)",execution);
 const final=body.indexOf("nativeFlight.release()",local);
 assert.ok(a>0&&a<budget&&budget<execution&&execution<local&&local<final);
 assert.match(body,/if\(!nativeFlight\)return;/);
 assert.match(body,/finally\s*\{\s*nativeFlight\.release\(\);\s*\}/);
});
test("native single-flight guard never grants read consent or fakes action receipts",()=>{
 const m=readFileSync(new URL("../src/master-native-single-flight.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(m,/invoke\(|execute_action|grantTaskRead|prepare_tool|verified:true/);
});
