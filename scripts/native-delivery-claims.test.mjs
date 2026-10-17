import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nativeTaskDeliveryClaims as claims} from "../src/native-delivery-claims.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const evidence=(id,tool,step,n)=>({
 step_id:step,tool,fingerprint:"exact-"+id,action_id:id,
 audit_event:"executed",success:true,outcome:"success",source:"typed_result",
 orchestration_step:n});
const node=(id,tool,receipt,deps=[])=>({
 step_id:id,title:id,expected_tool:tool,depends_on:deps,status:"completed",
 evidence:[receipt],running:null});
const dag=(nodes)=>({objective:"Produce edit",revision:1,steps:nodes});
const job=(id,tool,actionId,deps=[])=>({
 stepId:id,tool,dependsOn:deps,phase:"audited",actionId});
const schedule=(jobs)=>({version:1,objective:"Produce edit",revision:1,jobs});
test("final delivery requires ordered, Rust-verified action identities",()=>{
 const g=dag([
  node("inspect","read_file",evidence(A,"read_file","inspect",1)),
  node("check","git_status",evidence(B,"git_status","check",2),["inspect"])
 ]);
 const s=schedule([job("inspect","read_file",A),job("check","git_status",B,["inspect"])]);
 assert.deepEqual(claims(g,s),[
  {stepId:"inspect",tool:"read_file",actionId:A,artifact:null},
  {stepId:"check",tool:"git_status",actionId:B,artifact:null}]);
 assert.equal(claims(g,{...s,jobs:s.jobs.slice().reverse()}),null);
 assert.equal(claims(g,{...s,jobs:[s.jobs[0],{...s.jobs[1],actionId:A}]}),null);
 assert.equal(claims(g,{...s,objective:"Other"}),null);
 assert.equal(claims(g,{...s,jobs:s.jobs.map(x=>({...x,phase:"running"}))}),null);
});
test("Blender file must carry an exact native SHA-256 artifact",()=>{
 const a={kind:"blender_artifact",producer_action_id:A,path:"C:/renders/scene.blend",sha256:"a".repeat(64),bytes:4096};
 const e={...evidence(A,"blender_run_plan","model",1),artifact:a};
 const g=dag([node("model","blender_run_plan",e)]);
 const s=schedule([job("model","blender_run_plan",A)]);
 assert.deepEqual(claims(g,s),[
  {stepId:"model",tool:"blender_run_plan",actionId:A,
   artifact:{kind:a.kind,path:a.path,sha256:a.sha256,bytes:4096}}]);
 assert.equal(claims(dag([node("model","blender_run_plan",evidence(A,"blender_run_plan","model",1))]),s),null);
 assert.equal(claims(g,{...s,jobs:[{...s.jobs[0],actionId:B}]}),null);
});
test("unverified completed task is never promoted to final deliverable",()=>{
 const e={...evidence(A,"read_file","inspect",1),audit_event:"denied"};
 assert.equal(claims(dag([node("inspect","read_file",e)]),
   schedule([job("inspect","read_file",A)])),null);
});
test("real frontend wires delivery after terminal schedule validation, before clearing checkpoint",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const block=ui.slice(ui.indexOf('if (continuation.mode==="complete")'),
   ui.indexOf("setBusy(false);",ui.indexOf('if (continuation.mode==="complete")')));
 assert.match(block,/nativeTaskDeliveryClaims\(orchestration.task_graph,schedule,\{/);
 assert.match(block,/taskId:activePermissionScope.taskId,created:projectCreationEvidence/);
 assert.match(block,/invoke<NativeTaskDelivery>\("finalize_native_task_delivery"/);
 assert.match(block,/nativeDelivery/);
 const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.match(rust,/fn finalize_native_task_delivery\(/);
 assert.match(rust,/native_task_delivery::finalize\(&app,steps\)/);
});

test("audited UUIDs cannot launder graph dependency drift into Rust final delivery",()=>{
 const g=dag([
  node("inspect","read_file",evidence(A,"read_file","inspect",1)),
  node("check","git_status",evidence(B,"git_status","check",2),["inspect"])
 ]);
 const s=schedule([job("inspect","read_file",A),job("check","git_status",B,["inspect"])]);
 assert.ok(claims(g,s));
 assert.equal(claims(g,{...s,jobs:[s.jobs[0],{...s.jobs[1],dependsOn:[]}]}),null);
 assert.equal(claims(g,{...s,jobs:[s.jobs[0],{...s.jobs[1],dependsOn:["foreign"]}]}),null);
 assert.equal(claims(g,{...s,jobs:[s.jobs[0],{...s.jobs[1],dependsOn:["inspect","inspect"]}]}),null);
 const forged=structuredClone(g);forged.steps[1].depends_on=[];
 assert.equal(claims(forged,s),null);
 for(const bad of [null,undefined,7,{},false]){
  const wrong=structuredClone(g);
  wrong.steps[1].depends_on=[bad];
  const native=structuredClone(s);
  native.jobs[1].dependsOn=[bad];
  assert.equal(claims(wrong,native),null,"invalid dependency "+String(bad));
 }
 const valid=structuredClone(s);valid.jobs[1].dependsOn=["inspect"];
 assert.ok(claims(g,valid));
});
