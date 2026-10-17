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

// The replay block must remain active even if a prior receipt has plausible
// Rust UUIDs but a different file path/hash than this task's saved evidence.
test("native replay display does not misreport a foreign or mutated Blender artifact",()=>{
 const g=graph();
 g.objective="Render Blender";
 g.steps[0].expected_tool="blender_run_plan";
 g.steps[0].evidence[0].tool="blender_run_plan";
 g.steps[0].evidence[0].artifact={
  kind:"blender_artifact",producer_action_id:A,path:"C:/render/owner.blend",
  sha256:"a".repeat(64),bytes:8192
 };
 const d=delivery();d.objective=g.objective;
 d.steps[0].tool="blender_run_plan";
 d.steps[0].artifact={kind:"blender_artifact",path:"C:/render/owner.blend",
  sha256:"a".repeat(64),bytes:8192};
 assert.equal(classify(g,d).delivered,true);
 for(const mutate of [
  x=>x.steps[0].artifact.path="C:/render/foreign.blend",
  x=>x.steps[0].artifact.sha256="b".repeat(64),
  x=>x.steps[0].artifact.bytes=8193,
  x=>x.steps[0].artifact=null,
  x=>x.steps[1].artifact={kind:"blender_artifact",
   path:"C:/render/owner.blend",sha256:"a".repeat(64),bytes:8192}
 ]){
  const changed=structuredClone(d);mutate(changed);
  const result=classify(g,changed);
  assert.equal(result.blocked,true);
  assert.equal(result.delivered,false);
 }
});
test("premiere project replay report requires project file and dependent audited reopen",()=>{
 const g=graph();
 g.objective="Premiere me naya project banao";
 g.steps[0].expected_tool="premiere_create_project";
 g.steps[0].evidence[0].tool="premiere_create_project";
 g.steps[1].expected_tool="premiere_open_project";
 g.steps[1].evidence[0].tool="premiere_open_project";
 const d=delivery();d.objective=g.objective;
 d.steps[0].tool="premiere_create_project";
 d.steps[1].tool="premiere_open_project";
 d.steps[0].artifact={kind:"premiere_project",path:"C:/Projects/owner.prproj",
  sha256:"a".repeat(64),bytes:8192};
 assert.equal(classify(g,d).delivered,true);
 for(const change of [
  x=>x.d.steps[0].artifact=null,
  x=>x.d.steps[0].artifact.sha256="bad",
  x=>x.d.steps[0].artifact.path="C:/Projects/owner.mp4",
  x=>x.g.steps[1].depends_on=[],
  x=>x.g.steps[1].evidence[0].orchestration_step=1
 ]){
  const x={g:structuredClone(g),d:structuredClone(d)};change(x);
  const result=classify(x.g,x.d);
  assert.equal(result.delivered,false);
  // Already completed or otherwise unverified tasks must never be re-run.
  if(result.blocked)assert.match(result.reason,/Inspect|Review/i);
 }
});
