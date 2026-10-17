import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureMasterProviderTurnFence as capture,isMasterProviderTurnFenceCurrent as isCurrent}
 from "../src/master-provider-turn-fence.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
function fixture(mode="normal"){
 const scope={taskId:TASK,revoked:false},graph={revision:1,steps:[]};
 const fence=capture(scope,graph,"Open Premiere",2,1,mode);
 const current={scope,graph,owner:"Open Premiere",nextStep:2,reserved:1,
  mode,cancelRequested:false};
 assert.ok(fence);return {scope,graph,fence,current};
}
test("only original task and exact reserved Master or specialist request may receive the provider reply",()=>{
 const {fence,current}=fixture();
 assert.equal(isCurrent(fence,current),true);
 assert.equal(Object.isFrozen(fence),true);
});
test("failed-step owner-reviewed replanning is permitted only within its own exact graph/reservation",()=>{
 const {fence,current}=fixture("replan_required");
 assert.equal(isCurrent(fence,current),true);
 assert.equal(isCurrent(fence,{...current,mode:"normal"}),false);
});
test("foreign or replayed owner scope, graph revision, reservation count or next step cannot reuse a stale response",()=>{
 const {fence,current}=fixture();
 for(const change of [
  {scope:{...current.scope}},{graph:{...current.graph}},
  {owner:"New goal"},{nextStep:3},{reserved:2},
  {mode:"replan_required"},{cancelRequested:true}
 ])assert.equal(isCurrent(fence,{...current,...change}),false);
 current.scope.revoked=true;
 assert.equal(isCurrent(fence,current),false);
});
test("no provider authority if missing original request, invalid UUID, expired consent or stopped task",()=>{
 const {scope,graph}=fixture();
 assert.equal(capture(scope,graph,null,1,1,"normal"),null);
 assert.equal(capture(scope,graph,"User",1,0,"normal"),null);
 assert.equal(capture(scope,graph,"User",0,1,"normal"),null);
 assert.equal(capture(scope,graph,"User",1,1,"stopped"),null);
 assert.equal(capture({taskId:"bad",revoked:false},graph,"User",1,1,"normal"),null);
 scope.revoked=true;
 assert.equal(capture(scope,graph,"User",1,1,"normal"),null);
});
test("Desktop pins task DAG and provider reservation AFTER purchase, then checks it after chat and checkpoint awaits",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const part=ui.slice(ui.indexOf("async function runAgentStep"),ui.indexOf('el<HTMLButtonElement>("#resumeTask")'));
 assert.match(part,/const requestGraph = orchestration\.task_graph/);
 assert.match(part,/const requestOwner = orchestration\.owner_request/);
 assert.match(part,/providerTurnFence=captureMasterProviderTurnFence\(/);
 assert.match(part,/isMasterProviderTurnFenceCurrent\(providerTurnFence/);
 assert.match(part,/if \(staleModelRequest\(\)\) return;/);
 assert.match(part,/await saveActiveCheckpoint\(\);\s*\/\/ Even if the provider returned correctly[\s\S]*if\(staleModelRequest\(\)\)return;/);
 assert.match(part,/if\(remoteTask&&!staleModelRequest\(\)\)await closeRemoteTask\("outcome_unknown"\)/);
 assert.doesNotMatch(part,/const masterEditing = Boolean\(editingMasterContext/);
});
test("the pure provider lease never opens network, grants native actions or accesses host secrets",()=>{
 const source=readFileSync(new URL("../src/master-provider-turn-fence.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/execute_action\(|prepare_tool\(|invoke\(|fetch\(|grantTaskRead/);
});
