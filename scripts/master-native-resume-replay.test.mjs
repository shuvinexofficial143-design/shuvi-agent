import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyNativeResumeReplay as classify} from "../src/master-native-resume-replay.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
function graph(status="completed"){
 const step=(step_id,tool,action_id,n,depends_on=[])=>({
  step_id,expected_tool:tool,depends_on,status,running:null,
  evidence:status==="completed"?[{step_id,tool,action_id,
    fingerprint:"native-"+action_id,orchestration_step:n,
    source:"typed_result",audit_event:"executed",outcome:"success",success:true}]:[]
 });
 return {objective:"Open Premiere",revision:3,steps:[
  step("launch","premiere_launch",A,1),
  step("inspect","ui_windows",B,2,["launch"])
 ]};
}
function delivery(){return {version:1,objective:"Open Premiere",revision:3,
 recordedAtMs:1700000100000,steps:[
  {stepId:"launch",tool:"premiere_launch",actionId:A,artifact:null},
  {stepId:"inspect",tool:"ui_windows",actionId:B,artifact:null}
 ]};}
test("fully audited and already Rust-delivered native DAG is blocked from paid Resume",()=>{
 const x=classify(graph(),delivery());
 assert.equal(x.blocked,true);assert.equal(x.delivered,true);
 assert.match(x.reason,/cannot be resumed or billed again/);
 assert.equal(Object.isFrozen(x),true);
});
test("fully audited graph with missing or unrelated last delivery remains blocked, NOT retried",()=>{
 for(const change of [null,{...delivery(),revision:4},
  {...delivery(),steps:delivery().steps.slice().reverse()},
  {...delivery(),steps:delivery().steps.map(x=>({...x,actionId:A}))},
  {...delivery(),objective:"Foreign owner"},
  {...delivery(),recordedAtMs:0}]){
  const r=classify(graph(),change);
  assert.equal(r.blocked,true);assert.equal(r.delivered,false);
 }
});
test("running, unfinished or invalid DAG does not claim terminal delivery/replay",()=>{
 assert.equal(classify(null,delivery()).blocked,false);
 assert.equal(classify({objective:"x",steps:[]},delivery()).blocked,false);
 assert.equal(classify(graph("running"),delivery()).blocked,false);
 const g=graph();g.steps[1].evidence[0].audit_event="denied";
 assert.equal(classify(g,delivery()).blocked,false);
});
test("Resume checks host and Rust scheduler, then last delivery, before confirm or restoring paid task",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf('el<HTMLButtonElement>("#resumeTask")');
 const end=ui.indexOf('el<HTMLButtonElement>("#reviewNativeJob")',start);
 const block=ui.slice(start,end);
 const host=block.indexOf('invoke<NativeWorkerStatus>("native_worker_status")');
 const schedule=block.indexOf('invoke<NativeSchedule|null>("native_scheduler_status")',host);
 const last=block.indexOf('invoke<NativeTaskDelivery|null>("native_task_delivery_status")',schedule);
 const replay=block.indexOf('classifyNativeResumeReplay(restored.task_graph,lastDelivery)',last);
 const confirm=block.indexOf('window.confirm(',replay);
 const disk=block.indexOf('assessNativeCheckpointReadback(checkpoint,onDisk)',confirm);
 const paid=block.indexOf("await runAgentStep();",disk);
 assert.ok(host>0&&schedule>host&&last>schedule&&replay>last&&confirm>replay&&disk>confirm&&paid>disk);
 assert.match(block,/if\(replay\.blocked\)\{/);
 assert.match(block,/if\(savedCheckpoint!==checkpoint\|\|busy\)return;/);
});
test("native replay classifier has no OS write, Rust grant or billed-provider authority",()=>{
 const src=readFileSync(new URL("../src/master-native-resume-replay.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/execute_action|prepare_tool|invoke\(|grantTaskRead\(|fetch\(/);
});
