import test from "node:test";
import assert from "node:assert/strict";
import {parseWorkerArtifact,validWorkerArtifact,artifactHandoffFailure,importArtifactIdentity,workerBatchSources} from "../src/worker-artifact-lineage.mjs";
import {workerQueueView,nextWorkerTurn} from "../src/master-worker-queue.mjs";
import {graphDependencyFailure,restoreTaskGraph} from "../src/task-graph.mjs";
const id=n=>"123e4567-e89b-42d3-a456-"+String(n).padStart(12,"0");
const sha="a".repeat(64),path="/repo/remotion-render.mp4";
const receipt=(tool,step,number,actionId,artifact)=>({
 step_id:step,tool,orchestration_step:number,action_id:actionId,
 ...(artifact?{artifact}:{}),
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
 premiere_tool_proposal:{tool:"premiere_insert_media",arguments:{path,expected_sha256:sha}},
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
 assert.deepEqual(importArtifactIdentity(g,"insert"),{
  source:"remotion",source_action_id:id(3),path,sha256:sha
 });
 const proposal={tool:"premiere_insert_media",task_step_id:"insert",
  arguments:{path,expected_sha256:sha}};
 assert.equal(graphDependencyFailure(g,proposal),null);
 assert.equal(nextWorkerTurn(g).requires_owner_approval,true);
 assert.match(graphDependencyFailure(g,{...proposal,arguments:{path:"/repo/changed.mp4",expected_sha256:sha}}),
  /import path differs/);
 assert.match(graphDependencyFailure(g,{...proposal,arguments:{path}}),
  /expected_sha256/);
 assert.match(graphDependencyFailure(g,{...proposal,arguments:{path,expected_sha256:"b".repeat(64)}}),
  /expected_sha256/);
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

test("Blender typed output carries the exact Rust SHA-256 verified file identity",()=>{
 const raw={status:"verified",worker:"blender",full_plan_completed:true,
  verified_by_native_sha256:true,
  artifact:{path:"/repo/model.png",sha256:"c".repeat(64),bytes:8096}};
 const artifact=parseWorkerArtifact("blender_run_plan",JSON.stringify(raw),id(1));
 assert.deepEqual(artifact,{kind:"blender_artifact",producer_action_id:id(1),
  path:"/repo/model.png",sha256:"c".repeat(64),bytes:8096});
 assert.equal(validWorkerArtifact(artifact,"blender_run_plan",id(1)),true);
 for(const patch of [
  {full_plan_completed:false},{verified_by_native_sha256:false},
  {status:"partial"},{worker:"model"},
  {artifact:{...raw.artifact,bytes:0}},
  {artifact:{...raw.artifact,sha256:"short"}},
  {artifact:{...raw.artifact,path:"relative/model.png"}},
  {artifact:{...raw.artifact,path:"/repo/model.py"}},
  {artifact:{...raw.artifact,bytes:128*1024*1024+1}}
 ])assert.equal(parseWorkerArtifact("blender_run_plan",
  JSON.stringify({...raw,...patch}),id(1)),null,JSON.stringify(patch));
});
test("Blender PNG import requires matching Rust-verified producer identity and approval",()=>{
 const artifact=parseWorkerArtifact("blender_run_plan",JSON.stringify({
  status:"verified",worker:"blender",full_plan_completed:true,
  verified_by_native_sha256:true,
  artifact:{path:"/repo/blender.png",sha256:"b".repeat(64),bytes:8192}
 }),id(1));
 const g={objective:"Approved Blender PNG handoff",revision:1,
  steps:[step("model","blender_run_plan",1,[],artifact),
    step("import","premiere_insert_media",null,["model"])]};
 assert.equal(artifactHandoffFailure(g,"import"),null);
 assert.deepEqual(workerQueueView(g).ready_job_ids,["import"]);
 assert.deepEqual(importArtifactIdentity(g,"import"),{
  source:"blender",source_action_id:id(1),path:"/repo/blender.png",sha256:"b".repeat(64)
 });
 assert.equal(graphDependencyFailure(g,{tool:"premiere_insert_media",task_step_id:"import",
  arguments:{path:"/repo/blender.png",expected_sha256:"b".repeat(64)}}),null);
 assert.match(graphDependencyFailure(g,{tool:"premiere_insert_media",task_step_id:"import",
  arguments:{path:"/repo/other.png",expected_sha256:"b".repeat(64)}}),/Blender PNG output receipt/);
 assert.match(graphDependencyFailure(g,{tool:"premiere_insert_media",task_step_id:"import",
  arguments:{path:"/repo/blender.png"}}),/expected_sha256/);
 const noArtifact=JSON.parse(JSON.stringify(g));
 delete noArtifact.steps[0].evidence[0].artifact;
 assert.deepEqual(workerQueueView(noArtifact).ready_job_ids,[]);
 assert.equal(workerQueueView(noArtifact).jobs[1].status,"blocked");
 assert.equal(restoreTaskGraph(noArtifact,2,8).ok,false);
 const project=JSON.parse(JSON.stringify(g));
 project.steps[0].evidence[0].artifact.path="/repo/blender.blend";
 assert.match(artifactHandoffFailure(project,"import"),/not the Blender project/);
 assert.equal(nextWorkerTurn(project),null);
 assert.equal(restoreTaskGraph(g,2,8).ok,true);
});

test("mixed Blender and Remotion lineage is ambiguous rather than silently choosing a producer",()=>{
 const g=fixture();
 const blender=step("blender","blender_run_plan",4,[],{
  kind:"blender_artifact",producer_action_id:id(4),
  path:"/repo/blender.png",sha256:"b".repeat(64),bytes:5000
 });
 g.steps.splice(3,0,blender);
 g.steps.find(s=>s.step_id==="insert").depends_on=["plan","blender"];
 assert.match(artifactHandoffFailure(g,"insert"),/mixed Blender and Remotion sources/);
 assert.equal(importArtifactIdentity(g,"insert"),null);
 assert.deepEqual(workerQueueView(g).ready_job_ids,[]);
});

test("multiple Rust-verified Blender PNG outputs can enter a Premiere batch only as an exact set",()=>{
 const a1={kind:"blender_artifact",producer_action_id:id(1),path:"/repo/one.png",
  sha256:"a".repeat(64),bytes:2000};
 const a2={kind:"blender_artifact",producer_action_id:id(2),path:"/repo/two.png",
  sha256:"b".repeat(64),bytes:3000};
 for(const tool of ["premiere_import_media","premiere_create_sequence_from_media"]){
  const g={objective:"Audited two-file Premiere media batch",revision:1,steps:[
   step("first","blender_run_plan",1,[],a1),
   step("second","blender_run_plan",2,[],a2),
   step("deliver",tool,null,["first","second"])
  ]};
  assert.deepEqual(workerQueueView(g).ready_job_ids,["deliver"]);
  assert.equal(nextWorkerTurn(g).requires_owner_approval,true);
  assert.equal(nextWorkerTurn(g).batch_sources.length,2);
  assert.deepEqual(workerBatchSources(g,"deliver").map(src=>src.sha256),[a1.sha256,a2.sha256]);
  const base={tool,task_step_id:"deliver",arguments:{
   paths:[a2.path,a1.path],expected_sha256:[a2.sha256,a1.sha256],
   ...(tool==="premiere_create_sequence_from_media"?{name:"Shuvi-verified"}:{})
  }};
  assert.equal(graphDependencyFailure(g,base),null);
  assert.equal(graphDependencyFailure(g,{...base,arguments:{
   ...base.arguments,paths:[a1.path,a2.path],expected_sha256:[a1.sha256,a2.sha256]
  }}),null,"reordered arrays remain safe when path and SHA move together");
  for(const argumentsPatch of [
   {expected_sha256:[a2.sha256]},
   {paths:[a1.path],expected_sha256:[a1.sha256]},
   {paths:[a2.path,a1.path,"/repo/unapproved.mp4"],
    expected_sha256:[a2.sha256,a1.sha256,"c".repeat(64)]},
   {paths:[a1.path,a1.path],expected_sha256:[a1.sha256,a1.sha256]},
   {expected_sha256:[a1.sha256,a2.sha256]},
   {paths:[a1.path,a2.path],expected_sha256:[a1.sha256,"c".repeat(64)]},
   {expected_sha256:null}
  ]){
   const declined=graphDependencyFailure(g,{...base,arguments:{...base.arguments,...argumentsPatch}});
   assert.match(declined,/Batch import/,"dangerous alternate batch rejected: "+JSON.stringify(argumentsPatch));
  }
  assert.equal(restoreTaskGraph(g,3,8).ok,true);
 }
});
test("Remotion cannot bypass required final acceptance through Premiere batch or sequence creation",()=>{
 for(const tool of ["premiere_import_media","premiere_create_sequence_from_media"]){
  const g=fixture();
  g.steps[3].expected_tool=tool;
  assert.match(artifactHandoffFailure(g,"insert"),/must use accepted single-file/);
  assert.equal(workerQueueView(g).jobs[3].status,"blocked");
  assert.deepEqual(workerQueueView(g).ready_job_ids,[]);
  assert.match(graphDependencyFailure(g,{tool,task_step_id:"insert",arguments:{
   paths:[path],expected_sha256:[sha]
  }}),/must use accepted single-file/);
 }
});
test("unrelated manual batch imports retain the normal owner-approval flow",()=>{
 const g={objective:"Ordinary user media",revision:1,steps:[
  step("batch","premiere_import_media",null)
 ]};
 assert.equal(artifactHandoffFailure(g,"batch"),null);
 assert.deepEqual(workerQueueView(g).ready_job_ids,["batch"]);
 assert.equal(graphDependencyFailure(g,{tool:"premiere_import_media",task_step_id:"batch",
  arguments:{paths:["/user/media.mov"]}}),null);
});

test("restarted batch manifest cannot silently substitute a completed Blender source",()=>{
 const a1={kind:"blender_artifact",producer_action_id:id(1),path:"/repo/one.png",
  sha256:"a".repeat(64),bytes:2048};
 const a2={kind:"blender_artifact",producer_action_id:id(2),path:"/repo/two.png",
  sha256:"b".repeat(64),bytes:2048};
 const g={objective:"Completed auditable two-PNG batch",revision:1,steps:[
  step("first","blender_run_plan",1,[],a1),
  step("second","blender_run_plan",2,[],a2),
  step("batch","premiere_import_media",3,["first","second"],{
   kind:"premiere_worker_batch",import_action_id:id(3),
   sources:[
    {source_step_id:"second",producer_action_id:id(2),path:a2.path,sha256:a2.sha256},
    {source_step_id:"first",producer_action_id:id(1),path:a1.path,sha256:a1.sha256}
   ]
  })
 ]};
 assert.equal(validWorkerArtifact(g.steps[2].evidence[0].artifact,"premiere_import_media",id(3)),true);
 assert.equal(artifactHandoffFailure(g,"batch"),null);
 assert.equal(workerQueueView(g).verified,3);
 assert.equal(restoreTaskGraph(g,4,8).ok,true);
 for(const mutate of [
  x=>x.steps[2].evidence[0].artifact.sources[0].sha256="c".repeat(64),
  x=>x.steps[2].evidence[0].artifact.sources[0].producer_action_id=id(8),
  x=>x.steps[2].evidence[0].artifact.sources.push({
   source_step_id:"fake",producer_action_id:id(9),path:"/repo/extra.png",sha256:"d".repeat(64)}),
  x=>delete x.steps[2].evidence[0].artifact
 ]){
  const changed=JSON.parse(JSON.stringify(g));mutate(changed);
  assert.equal(restoreTaskGraph(changed,4,8).ok,false);
  assert.equal(workerQueueView(changed).jobs[2].verified,false);
 }
});
