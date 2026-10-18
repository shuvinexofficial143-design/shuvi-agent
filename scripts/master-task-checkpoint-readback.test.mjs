import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessNativeCheckpointReadback as check} from "../src/master-task-checkpoint-readback.mjs";
const task=(owner="A",requestCount=1)=>({
 version:2,updated_at_ms:1700000000000,provider:"openrouter",model:"model-1",
 base_url:null,messages:[{role:"user",content:"Open Premiere"}],
 orchestration:{version:5,owner_request:owner,task_graph:{
  objective:owner,revision:1,steps:[{step_id:"open",expected_tool:"premiere_launch"}]},
  next_step:2,model_requests_reserved:requestCount,recovery_mode:"normal",
  task_expires_at_ms:1700001000000},
 worker_models:{premiere:"model-1"}
});
test("exact native-loaded durable bytes including task and model reservation pass independent readback",()=>{
 const x=task(),readback=structuredClone(x);
 assert.equal(check(x,readback).verified,true);
 assert.equal(Object.isFrozen(check(x,readback)),true);
});
test("ordering-independent ordinary JSON map field order is accepted",()=>{
 const x=task(),y=structuredClone(x);
 y.messages=y.messages.map(z=>({content:z.content,role:z.role}));
 y.worker_models={premiere:"model-1"};
 assert.equal(check(x,y).verified,true);
});
test("another task, replayed generation, altered DAG or reserved billed turn is NEVER accepted",()=>{
 for(const mutate of [
  x=>x.updated_at_ms++,
  x=>x.orchestration.owner_request="B",
  x=>x.orchestration.task_graph.objective="B",
  x=>x.orchestration.task_graph.revision=2,
  x=>x.orchestration.model_requests_reserved=2,
  x=>x.orchestration.task_graph.steps[0].step_id="not original",
  x=>x.messages.push({role:"assistant",content:"I finished"}),
  x=>x.worker_models.premiere="foreign",
  x=>x.provider="foreign",
  x=>x.model="foreign"
 ]){
  const a=task(),b=structuredClone(a);mutate(b);
  assert.equal(check(a,b).verified,false);
 }
});
test("missing, malformed, oversize, prototype-polluted and cyclic checkpoints are rejected",()=>{
 const x=task();
 for(const changed of [
  null,{},[],{...x,version:3},{...x,orchestration:null},
  {...x,updated_at_ms:-1},
  {...x,messages:[{role:"user",content:"X".repeat(3*1024*1024)}]}
 ])assert.equal(check(x,changed).verified,false);
 const cycle=task();cycle.messages[0].self=cycle;
 assert.equal(check(x,cycle).verified,false);
 const evil=task();evil.orchestration.constructor="unexpected";
 assert.equal(check(x,evil).verified,false);
});
test("checkpoint content comparison never logs credentials or other sensitive payload values",()=>{
 const x=task(),y=structuredClone(x);
 x.messages[0].content="secret-challenge-token";y.messages[0].content="different";
 const res=check(x,y);assert.equal(res.verified,false);
 assert.doesNotMatch(res.reason,/secret|different|challenge/);
});
test("required provider reservation, native prepared approval and continuation require SAVE followed by readback before native/paid IPC",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(ui,/guardedSaveNativeCheckpoint\(verifyReadback=false\)/);
 assert.match(ui,/save_session_checkpoint_if_revision/);
 assert.match(ui,/expectedRevision:nativeCheckpointRevision/);
 assert.match(ui,/const reloaded=await invoke<NativeCheckpointSnapshot>\("session_checkpoint_snapshot"\)/);
 assert.match(ui,/assessNativeCheckpointReadback\(checkpoint,reloaded\.checkpoint\)/);
 assert.match(ui,/const verified=assessNativeCheckpointReadback\(checkpoint,reloaded\.checkpoint\)/);
 assert.match(ui,/reloaded\.revision!==nativeCheckpointRevision/);
 assert.ok((ui.match(/await guardedSaveNativeCheckpoint\(true\)/g)||[]).length>=4);
 assert.match(ui,/const stillReading=\(\)=>readingScope===activePermissionScope/);
 assert.match(ui,/if\(savedCheckpoint!==checkpoint\|\|busy\)return;/);
});
test("generic mobile task text or audited action alone cannot assert original user task succeeded",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const part=ui.slice(ui.indexOf("async function runAgentStep()"),
  ui.indexOf('el<HTMLButtonElement>("#resumeTask")'));
 assert.match(part,/if\(remoteTask\)await closeRemoteTask\("outcome_unknown"\)/);
 assert.doesNotMatch(part,/closeRemoteTask\(\s*remoteTask\.evidenceActionId/);
 const terminal=ui.slice(ui.indexOf("async function continueAfterOutcome"),ui.indexOf("async function stageProposal"));
 assert.match(terminal,/const finalOutcome=assessMasterFinalOutcome/);
 assert.match(terminal,/if\(!finalOutcome\.verified\)/);
});
