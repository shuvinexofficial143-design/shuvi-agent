import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {workerForTool,evidenceForStep,workerQueueView,workerQueueSummary} from "../src/master-worker-queue.mjs";
import {graphDependencyFailure} from "../src/task-graph.mjs";
const UUID="123e4567-e89b-42d3-a456-426614174000";
const step=(step_id,expected_tool,status="ready",depends_on=[],evidence=[])=>({step_id,expected_tool,status,depends_on,evidence,title:step_id});
const accepted=(tool)=>[{success:true,source:"typed_result",audit_event:"executed",tool,action_id:UUID}];
test("Worker tool routing uses actual native tool families, never phantom Blender execution",()=>{
  for(const [tool,expected] of [
    ["premiere_context","premiere"],["premiere_insert_media","premiere"],
    ["after_effects_run","after_effects"],["motion_graphics_plan_after_effects","after_effects"],
    ["motion_graphics_run_remotion","remotion"],["motion_graphics_plan_premiere_insertion","premiere"],
    ["browser_dom_read","browser"],["pointer_click","windows"],["git_status","coding"],
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
  assert.equal(evidenceForStep(step("a","premiere_context","completed",[],accepted("premiere_context")))?.action_id,UUID);
});
test("Worker dependencies and app locks exclude conflicted or unverified handoffs",()=>{
  const g={steps:[
    step("inspect","premiere_context","completed",[],accepted("premiere_context")),
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
    step("a","premiere_context","completed",[],accepted("premiere_context")),
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
  g.steps[0].evidence=accepted("motion_graphics_run_remotion");
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
