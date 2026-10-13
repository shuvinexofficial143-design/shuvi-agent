import test from "node:test";
import assert from "node:assert/strict";
import {parseWorkerArtifact,validWorkerArtifact,artifactHandoffFailure} from "../src/worker-artifact-lineage.mjs";
import {workerQueueView,nextWorkerTurn} from "../src/master-worker-queue.mjs";
import {graphDependencyFailure,restoreTaskGraph} from "../src/task-graph.mjs";
const id=n=>"123e4567-e89b-42d3-a456-"+String(n).padStart(12,"0");
const sha="a".repeat(64),path="/repo/remotion-render.mp4";
const receipt=(tool,step,number,actionId,artifact)=>({
 step_id:step,tool,orchestration_step:number,action_id:actionId,artifact,
 fingerprint:"sha256-case:"+step,source:"typed_result",audit_event:"executed",
 outcome:"success",success:true,summary:"Native Rust audited action"
});
const step=(step_id,expected_tool,number,depends_on=[],artifact=null)=>{
 const done=number!=null;
 return {step_id,expected_tool,depends_on,status:done?"completed":"ready",
 title:step_id,purpose:"Verify file",success_criteria:"Native typed result",
 blocked_reason:null,running:null,
 evidence:done?[receipt(expected_tool,step_id,number,id(number),artifact)]:[]};
};
const accepted=()=>({
 schema_version:1,acceptance_action_id:id(2),render_action_id:id(1),
 output_file:path,output_sha256:sha,final_output_sha256_verified:true,
 runtime_process_provenance_verified:true,visual_review_verified:true,
 delivery_acceptance_verified:true,dependency_source_integrity_verified:false,
 production_ready:false
});
const insertion=()=>({
 schema_version:1,source:"verified_motion_graphics_delivery",
 final_acceptance_action_id:id(2),output_file:path,output_sha256:sha,
 premiere_tool_proposal:{tool:"premiere_insert_media",arguments:{path}},
 automatic_execution:false,requires_normal_premiere_approval:true,
 production_ready:false
});
const fixture=()=>{
 const accept=parseWorkerArtifact("motion_graphics_accept_final_remotion",JSON.stringify(accepted()),id(2));
 const plan=parseWorkerArtifact("motion_graphics_plan_premiere_insertion",JSON.stringify(insertion()),id(3));
 const steps=[
  step("render","motion_graphics_run_remotion",1),
  step("accept","motion_graphics_accept_final_remotion",2,["render"],accept),
  step("plan","motion_graphics_plan_premiere_insertion",3,["accept"],plan),
  step("insert","premiere_insert_media",null,["plan"])
 ];
 return {objective:"Verified animation import",revision:1,steps};
};
test("native acceptance and plan expose only bounded exact path/hash/action identity",()=>{
 const accept=parseWorkerArtifact("motion_graphics_accept_final_remotion",JSON.stringify(accepted()),id(2));
 const plan=parseWorkerArtifact("motion_graphics_plan_premiere_insertion",JSON.stringify(insertion()),id(3));
 assert.deepEqual(accept,{kind:"accepted_remotion",acceptance_action_id:id(2),
  render_action_id:id(1),path,sha256:sha});
 assert.deepEqual(plan,{kind:"premiere_insertion_plan",final_acceptance_action_id:id(2),
  path,sha256:sha});
 assert.equal(validWorkerArtifact(accept,"motion_graphics_accept_final_remotion",id(2)),true);
 assert.equal(validWorkerArtifact(plan,"motion_graphics_plan_premiere_insertion",id(3)),true);
 assert.equal(parseWorkerArtifact("premiere_insert_media",JSON.stringify(accepted()),id(2)),null);
});
test("a final acceptance requires Rust provenance and the currently executing action ID",()=>{
 for(const patch of [
  {acceptance_action_id:id(9)}, {render_action_id:"no-uuid"},
  {output_sha256:"not-a-sha256"},{output_file:"relative.mp4"},
  {runtime_process_provenance_verified:false},{final_output_sha256_verified:false},
  {visual_review_verified:false},{delivery_acceptance_verified:false},
  {dependency_source_integrity_verified:true},{production_ready:true},
  {schema_version:2}
 ])assert.equal(parseWorkerArtifact("motion_graphics_accept_final_remotion",
  JSON.stringify({...accepted(),...patch}),id(2)),null,JSON.stringify(patch));
 assert.equal(parseWorkerArtifact("motion_graphics_accept_final_remotion",
  "x".repeat(65537),id(2)),null);
});
test("a planner response is not accepted if it omits identity or claims automatic execution",()=>{
 for(const patch of [
  {final_acceptance_action_id:"fake"},{automatic_execution:true},
  {requires_normal_premiere_approval:false},{production_ready:true},
  {output_sha256:"b".repeat(63)},{output_file:"relative/path"},
  {source:"model_supplied_file"},{premiere_tool_proposal:{tool:"other",arguments:{path}}},
  {premiere_tool_proposal:{tool:"premiere_insert_media",arguments:{path:"/repo/other.mov"}}}
 ])assert.equal(parseWorkerArtifact("motion_graphics_plan_premiere_insertion",
  JSON.stringify({...insertion(),...patch}),id(3)),null,JSON.stringify(patch));
});
test("valid Remotion lineage is ready only for the exact accepted output file",()=>{
 const g=fixture();
 assert.equal(artifactHandoffFailure(g,"insert"),null);
 assert.deepEqual(workerQueueView(g).ready_job_ids,["insert"]);
 const proposal={tool:"premiere_insert_media",task_step_id:"insert",arguments:{path}};
 assert.equal(graphDependencyFailure(g,proposal),null);
 assert.equal(nextWorkerTurn(g).requires_owner_approval,true);
 assert.match(graphDependencyFailure(g,{...proposal,arguments:{path:"/repo/changed.mp4"}}),
  /import path differs/);
});
test("changed SHA, output path, acceptance ID, or render action blocks cross-app import",()=>{
 for(const edit of [
  g=>g.steps[1].evidence[0].artifact.render_action_id=id(7),
  g=>g.steps[1].evidence[0].artifact.sha256="b".repeat(64),
  g=>g.steps[2].evidence[0].artifact.sha256="b".repeat(64),
  g=>g.steps[2].evidence[0].artifact.path="/repo/another.mp4",
  g=>g.steps[2].evidence[0].artifact.final_acceptance_action_id=id(9),
  g=>delete g.steps[1].evidence[0].artifact,
  g=>delete g.steps[2].evidence[0].artifact
 ]){
  const g=fixture();edit(g);
  assert.notEqual(artifactHandoffFailure(g,"insert"),null);
  assert.deepEqual(workerQueueView(g).ready_job_ids,[]);
  assert.equal(workerQueueView(g).jobs[3].status,"blocked");
  assert.equal(nextWorkerTurn(g),null);
 }
});
test("saved checkpoint never upgrades forged or missing artifact to a completed identity",()=>{
 const g=fixture();
 g.steps[3].status="completed";
 g.steps[3].evidence=[receipt("premiere_insert_media","insert",4,id(4))];
 assert.equal(restoreTaskGraph(g,5,8).ok,true);
 for(const mutate of [
  x=>delete x.steps[1].evidence[0].artifact,
  x=>x.steps[2].evidence[0].artifact.sha256="b".repeat(64),
  x=>x.steps[1].evidence[0].artifact.path="../escape.mp4",
  x=>x.steps[2].evidence[0].artifact.final_acceptance_action_id=id(8)
 ]){
  const modified=JSON.parse(JSON.stringify(g));
  mutate(modified);
  assert.equal(restoreTaskGraph(modified,5,8).ok,false);
 }
});
