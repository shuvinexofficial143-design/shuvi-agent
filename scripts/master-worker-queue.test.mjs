import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {workerForTool,evidenceForStep,workerQueueView,workerQueueSummary,nextWorkerTurn} from "../src/master-worker-queue.mjs";
import {graphDependencyFailure} from "../src/task-graph.mjs";
const UUID="123e4567-e89b-42d3-a456-426614174000";
const step=(step_id,expected_tool,status="ready",depends_on=[],evidence=[])=>({step_id,expected_tool,status,depends_on,evidence,title:step_id});
const accepted=(tool,stepId,orchestrationStep=1,actionId=UUID)=>[{
  success:true,source:"typed_result",audit_event:"executed",outcome:"success",
  tool,step_id:stepId,fingerprint:"typed:"+tool+":"+stepId,orchestration_step:orchestrationStep,
  action_id:actionId
}];
test("Worker tool routing uses actual native tool families, never phantom Blender execution",()=>{
  for(const [tool,expected] of [
    ["premiere_context","premiere"],["premiere_insert_media","premiere"],
    ["after_effects_run","after_effects"],["motion_graphics_plan_after_effects","after_effects"],
    ["motion_graphics_run_remotion","remotion"],["motion_graphics_plan_premiere_insertion","premiere"],
    ["browser_dom_read","browser"],["pointer_click","windows"],["pointer_drag","windows"],["git_status","coding"],
    ["photoshop_layers","adobe"],["blender_inspect","blender"],["blender_run_plan","blender"],["blender_run","unsupported"]
  ])assert.equal(workerForTool(tool),expected,tool);
});
test("A job is not complete from model claims, an uncorrelated action or a naked success boolean",()=>{
  for(const ev of [
    [],[{success:true,source:"model_claim",audit_event:"executed",tool:"premiere_context",action_id:UUID}],
    [{success:true,source:"typed_result",audit_event:"executed",tool:"wrong",action_id:UUID}],
    [{success:true,source:"typed_result",audit_event:"denied",tool:"premiere_context",action_id:UUID}],
    [{success:true,source:"typed_result",audit_event:"executed",tool:"premiere_context",action_id:"fake-id"}]
  ])assert.equal(evidenceForStep(step("a","premiere_context","completed",[],ev)),null);
  assert.equal(evidenceForStep(step("a","premiere_context","completed",[],accepted("premiere_context","a")))?.action_id,UUID);
});
test("Worker dependencies and app locks exclude conflicted or unverified handoffs",()=>{
  const g={steps:[
    step("inspect","premiere_context","completed",[],accepted("premiere_context","inspect")),
    step("motion","motion_graphics_run_remotion","running",["inspect"]),
    step("another_render","motion_graphics_run_remotion","ready",["inspect"]),
    step("insert","premiere_insert_media","ready",["motion"]),
    step("ready_inspection","premiere_timeline","ready",["inspect"]),
    step("blender","blender_run","ready",["inspect"])
  ]};
  const q=workerQueueView(g);
  assert.equal(q.total,6);
  assert.equal(q.verified,1);
  assert.deepEqual(q.ready_job_ids,["ready_inspection"]);
  assert.equal(q.blocked,1);
  assert.match(workerQueueSummary(g),/1\/6 audited/);
});
test("Interrupted or stopped graphs are not reported as successful",()=>{
  const g={steps:[
    step("a","premiere_context","completed",[],accepted("premiere_context","a")),
    step("b","motion_graphics_run_remotion","failed",["a"]),
    step("c","premiere_insert_media","pending",["b"])
  ]};
  const q=workerQueueView(g);
  assert.equal(q.verified,1);
  assert.equal(q.ready,0);
  assert.equal(q.jobs[1].verified,false);
  assert.equal(q.jobs[2].status,"pending");
  assert.equal(workerQueueView(null).total,0);
  assert.equal(workerQueueView({steps:new Array(9).fill({})}).total,0);
});
test("Native Shuvi UI shows audit-backed worker progress, not fake cloud runtime",()=>{
  const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(ui,/workerQueueView\(orchestration\.task_graph\)/);
  assert.match(ui,/workerQueue\.verified/);
  assert.match(ui,/worker\?\.worker/);
  assert.match(ui,/renderOrchestrationStatus\(\)/);
});

test("task graph rejects falsely completed predecessor without audit-bound UUID",()=>{
  const g={steps:[
    step("asset","motion_graphics_run_remotion","completed",[],[{
      source:"typed_result",success:true,audit_event:"executed",
      tool:"motion_graphics_run_remotion",action_id:"not-a-UUID"
    }]),
    step("import","premiere_insert_media","ready",["asset"])
  ]};
  assert.match(graphDependencyFailure(g,{tool:"premiere_insert_media",task_step_id:"import"}),
    /Rust-audited dependency evidence/);
  g.steps[0].evidence=accepted("motion_graphics_run_remotion","asset");
  assert.equal(graphDependencyFailure(g,{tool:"premiere_insert_media",task_step_id:"import"}),null);
});
test("resource lock prevents claiming a second renderer while first is active",()=>{
  const g={steps:[
    step("first","motion_graphics_run_remotion","running"),
    step("second","motion_graphics_run_remotion","ready")
  ]};
  assert.match(graphDependencyFailure(g,{tool:"motion_graphics_run_remotion",task_step_id:"second"}),
    /Worker lane is busy/);
});

test("cross-worker handoff exposes typed predecessor receipts but never becomes execution permission",()=>{
 const receiptA="123e4567-e89b-42d3-a456-426614174001";
 const receiptB="123e4567-e89b-42d3-a456-426614174002";
 const g={steps:[
  step("asset","motion_graphics_run_remotion","completed",[],accepted("motion_graphics_run_remotion","asset",1,receiptA)),
  step("insert","premiere_insert_media","completed",["asset"],accepted("premiere_insert_media","insert",2,receiptB)),
  step("inspect","premiere_timeline","ready",["insert"])
 ]};
 const q=workerQueueView(g);
 assert.equal(q.verified,2);
 assert.deepEqual(q.ready_job_ids,["inspect"]);
 assert.deepEqual(q.jobs[2].handoffs,[{
  from_step_id:"insert",to_step_id:"inspect",from_worker:"premiere",to_worker:"premiere",
  action_id:receiptB,orchestration_step:2
 }]);
 assert.equal(q.jobs[1].handoffs[0].from_worker,"remotion");
 assert.equal(q.jobs[1].handoffs[0].to_worker,"premiere");
});
test("duplicate native UUID across workers never unlocks a downstream handoff",()=>{
 const g={steps:[
  step("asset","motion_graphics_run_remotion","completed",[],accepted("motion_graphics_run_remotion","asset",1)),
  step("insert","premiere_insert_media","completed",["asset"],accepted("premiere_insert_media","insert",2)),
  step("verify","premiere_timeline","ready",["insert"])
 ]};
 const q=workerQueueView(g);
 assert.equal(q.verified,0,"shared action UUID is not independent Rust proof");
 assert.deepEqual(q.ready_job_ids,[]);
 assert.match(graphDependencyFailure(g,{tool:"premiere_timeline",task_step_id:"verify"}),/Rust-audited dependency evidence/);
});
test("a child action cannot complete before its parent action receipt",()=>{
 const g={steps:[
  step("model","blender_run_plan","completed",[],accepted("blender_run_plan","model",4,UUID)),
  step("import","premiere_insert_media","completed",["model"],accepted("premiere_insert_media","import",2,
   "123e4567-e89b-42d3-a456-426614174004")),
  step("check","premiere_timeline","ready",["import"])
 ]};
 const q=workerQueueView(g);
 assert.equal(q.verified,1);
 assert.equal(q.jobs[1].verified,false);
 assert.deepEqual(q.ready_job_ids,[]);
});
test("recovered failure history remains visible but a later exact audit can handoff",()=>{
 const failed={
  step_id:"model",tool:"blender_run_plan",fingerprint:"first-attempt",
  action_id:"123e4567-e89b-42d3-a456-426614174003",orchestration_step:1,
  success:false,source:"typed_result",audit_event:"failed",outcome:"failure"
 };
 const g={steps:[
  step("model","blender_run_plan","completed",[],[failed,...accepted("blender_run_plan","model",3,UUID)]),
  step("export","premiere_insert_media","ready",["model"])
 ]};
 const q=workerQueueView(g);
 assert.equal(q.verified,1);
 assert.deepEqual(q.ready_job_ids,["export"]);
 assert.equal(q.jobs[1].handoffs[0].orchestration_step,3);
});

test("nextWorkerTurn makes a deterministic plan preview, never an executable approval",()=>{
 const g={steps:[
  step("inspect","premiere_context","completed",[],accepted("premiere_context","inspect")),
  step("motion","motion_graphics_run_remotion","ready",["inspect"]),
  step("insert","premiere_insert_media","pending",["motion"])
 ]};
 const turn=nextWorkerTurn(g);
 assert.equal(turn.step_id,"motion");
 assert.equal(turn.worker,"remotion");
 assert.equal(turn.tool,"motion_graphics_run_remotion");
 assert.equal(turn.requires_owner_approval,true);
 assert.equal(turn.handoffs[0].action_id,UUID);
 assert.equal(nextWorkerTurn({steps:[
  step("running","motion_graphics_run_remotion","running"),
  step("wait","motion_graphics_run_remotion","ready")
 ]}),null);
 assert.equal(nextWorkerTurn(null),null);
});

test("owner-approved extended 24/48 task graphs retain every worker gate and resource lock",()=>{
 for(const count of [24,48]){
  const steps=Array.from({length:count},(_,i)=>step("s"+i,"read_file","ready"));
  const q=workerQueueView({steps});
  assert.equal(q.total,count);
  assert.equal(q.ready,count);
  assert.equal(q.ready_job_ids.at(-1),"s"+(count-1));
  assert.equal(nextWorkerTurn({steps}).step_id,"s0");
  assert.equal(graphDependencyFailure({steps},{tool:"read_file",task_step_id:"s"+(count-1)}),null);
  const running=steps.map((s,i)=>i===0?{...s,status:"running"}:s);
  assert.deepEqual(workerQueueView({steps:running}).ready_job_ids,[],
   "one workspace action holds the coding lane even at the 48-action limit");
 }
 assert.equal(workerQueueView({steps:Array.from({length:49},(_,i)=>step("s"+i,"read_file"))}).total,0);
});
