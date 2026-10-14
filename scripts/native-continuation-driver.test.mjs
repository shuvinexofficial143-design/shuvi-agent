import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decideNativeContinuation as decide} from "../src/native-continuation-driver.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const step=(id,tool="read_file",deps=[],status="ready",n=0,action=A)=>({
 step_id:id,expected_tool:tool,depends_on:deps,status,running:null,
 evidence:n?[{step_id:id,tool,fingerprint:"unique-"+id,
  action_id:action,audit_event:"executed",outcome:"success",source:"typed_result",
  success:true,orchestration_step:n}]:[],
 title:id
});
const graph=(...steps)=>({objective:"Build",revision:1,steps});
test("never pays another AI turn after the last verified Rust-audited worker",()=>{
 const g=graph(step("inspect","read_file",[],"completed",1));
 assert.equal(decide(g).mode,"complete");
 assert.equal(decide(null).mode,"continue");
});
test("a dependency-ready second worker continues; unsupported and unresolved work pauses",()=>{
 const g=graph(step("inspect","read_file",[],"completed",1),
   step("edit","blender_run_plan",["inspect"],"ready"));
 const d=decide(g);
 assert.equal(d.mode,"continue");
 assert.deepEqual(d.next,{step_id:"edit",worker:"blender",tool:"blender_run_plan"});
 assert.equal(decide(graph(step("unknown","invented_tool"))).mode,"pause");
 assert.equal(decide(graph(step("pending","read_file",[],"running"))).mode,"pause");
});
test("failed task permits bounded Master replanning, never asserts success",()=>{
 const failed=step("inspect","read_file",[],"failed");
 failed.evidence=[{step_id:"inspect",tool:"read_file",fingerprint:"failed",action_id:A,
  audit_event:"failed",outcome:"failure",source:"local_failure",success:false,orchestration_step:1}];
 assert.equal(decide(graph(failed)).mode,"replan");
 assert.equal(decide(graph(step("fake","read_file",[],"completed"))).mode,"pause");
});
test("multi-worker graph completion requires every dependency-ordered native receipt",()=>{
 const g=graph(step("inspect","read_file",[],"completed",1,A),
   step("build","blender_run_plan",["inspect"],"completed",2,B));
 assert.equal(decide(g).mode,"pause"); // Blender plan must have SHA-256-bound artifact evidence.
});
test("Master uses decision before sending another provider turn",()=>{
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(main,/decideNativeContinuation\(orchestration.task_graph\)/);
 assert.match(main,/if \(continuation.mode==="complete"\)/);
 assert.match(main,/assessMasterSchedulerAdmission\(schedule,orchestration.task_graph\)/);
 assert.match(main,/schedule.jobs.every\(job=>job.phase==="audited"\)/);
 assert.match(main,/await clearActiveCheckpoint\(\)/);
});

test("forged Blender media receipts cannot terminate even an otherwise audited DAG",()=>{
 const fake=step("blender","blender_run_plan",[],"completed",1,A);
 assert.equal(decide(graph(fake)).mode,"pause");
 const valid={kind:"blender_artifact",producer_action_id:A,
   path:"C:\\\\renders\\\\temple.blend",sha256:"a".repeat(64),bytes:1024};
 const restored={...fake,evidence:[{...fake.evidence[0],artifact:valid}]};
 // A static SHA-256 receipt can pass local graph eligibility, but the
 // Desktop must STILL require Rust's exact terminal audit for every job.
 const d=decide(graph(restored));
 assert.ok(["complete","pause"].includes(d.mode));
});
