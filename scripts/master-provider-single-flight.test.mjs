import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createMasterProviderSingleFlight} from "../src/master-provider-single-flight.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const scope=()=>({taskId:TASK,revoked:false});
test("second paid model request cannot enter while the first has reserved an active provider flight",()=>{
 const gate=createMasterProviderSingleFlight(),owner=scope();
 const first=gate.acquire(owner);assert.ok(first);
 assert.equal(gate.acquire(owner),null);
 assert.equal(gate.acquire({...owner}),null);
 assert.equal(first.release(),true);
 assert.equal(first.release(),false);
 assert.ok(gate.acquire(owner));
});
test("new task cannot purchase another provider call while an old call is still uncertain",()=>{
 const gate=createMasterProviderSingleFlight(),old=scope(),newOwner={...old};
 const oldClaim=gate.acquire(old);assert.ok(oldClaim);
 old.revoked=true;
 assert.equal(gate.acquire(newOwner),null);
 oldClaim.release();
 assert.ok(gate.acquire(newOwner));
});
test("invalid, revoked and zero UUID owner cannot gain a model-dispatch permit",()=>{
 const gate=createMasterProviderSingleFlight();
 assert.equal(gate.acquire(null),null);
 assert.equal(gate.acquire({taskId:"bad",revoked:false}),null);
 assert.equal(gate.acquire({taskId:TASK,revoked:true}),null);
 const ok=gate.acquire(scope());assert.ok(ok);
 assert.equal(ok.release(),true);
});
test("a failed or completed paid provider request releases once and permits bounded next-turn reentry",async()=>{
 const gate=createMasterProviderSingleFlight(),owner=scope();
 async function attempt(throws){
  const lease=gate.acquire(owner);assert.ok(lease);
  try{await Promise.resolve();if(throws)throw Error("provider outcome unknown");return "result"}
  finally{lease.release()}
 }
 assert.equal(await attempt(false),"result");
 await assert.rejects(attempt(true),/provider outcome unknown/);
 assert.equal(await attempt(false),"result");
});
test("Desktop acquires before billing reservation, releases on provider reply AND in outer finally",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("async function runAgentStep(): Promise<void> {");
 const end=ui.indexOf('el<HTMLButtonElement>("#resumeTask")',start);
 const src=ui.slice(start,end);
 const admission=src.indexOf("const paidFlight=masterProviderSingleFlight.acquire(activePermissionScope);");
 const reserve=src.indexOf("const reservation = reserveTaskModelRequest(orchestration)");
 const chat=src.indexOf('const response = await invoke<ChatResponse>("chat"');
 const release=src.indexOf("paidFlight.release();",chat);
 const nested=src.indexOf("await runAgentStep();",chat);
 assert.ok(admission>=0&&admission<reserve&&reserve<chat&&chat<release&&release<nested);
 assert.match(src,/finally \{[\s\S]*?paidFlight\.release\(\);[\s\S]*?\}/);
 assert.match(src,/if\(staleModelRequest\(\)\) return;/);
});
test("provider gate cannot grant high-risk approval or execute native Windows actions",()=>{
 const text=readFileSync(new URL("../src/master-provider-single-flight.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(text,/prepare_tool|execute_action|grantTaskRead|invoke\(|\bfetch\(/);
});
