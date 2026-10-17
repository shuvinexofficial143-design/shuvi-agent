import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyMasterCommentaryCompletion as classify} from "../src/master-commentary-completion.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
function graph(done=true){
 const mk=(id,tool,action,n,deps=[])=>({step_id:id,expected_tool:tool,
  depends_on:deps,status:done?"completed":"running",running:done?null:{action_id:action,orchestration_step:n,fingerprint:"f"},
  evidence:done?[{step_id:id,tool,action_id:action,fingerprint:"f",
   source:"typed_result",audit_event:"executed",outcome:"success",success:true,
   orchestration_step:n}]:[]});
 return {objective:"Open Premiere",revision:1,steps:[
  mk("launch","premiere_launch",A,1),
  mk("inspect","ui_windows",B,2,["launch"])
 ]};
}
test("completed and audited DAG must enter strict Rust finalization, never generic chat-only checkpoint clear",()=>{
 const result=classify(graph());
 assert.equal(result.mode,"native_finalizer");
 assert.equal(Object.isFrozen(result),true);
});
test("unfinished and malformed DAG must be preserved; absence of DAG is distinct",()=>{
 assert.equal(classify(graph(false)).mode,"preserve_checkpoint");
 assert.equal(classify({steps:[]}).mode,"preserve_checkpoint");
 assert.equal(classify({objective:"missing steps"}).mode,"preserve_checkpoint");
 assert.equal(classify(null).mode,"no_graph");
});
test("completed step with forged/unverified native receipt cannot promote into finalizer",()=>{
 const f=graph();f.steps[0].evidence[0].audit_event="denied";
 assert.equal(classify(f).mode,"preserve_checkpoint");
 const bad=graph();bad.steps[1].evidence[0].action_id=A;
 assert.equal(classify(bad).mode,"preserve_checkpoint");
});
test("model dispatch is impossible for already fully audited DAG; Rust finalizer owns outcome",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("async function runAgentStep(): Promise<void> {");
 const end=ui.indexOf('el<HTMLButtonElement>("#resumeTask")',start);
 const body=ui.slice(start,end);
 const classification=body.indexOf('if(classifyMasterCommentaryCompletion(orchestration.task_graph).mode==="native_finalizer"){');
 const handoff=body.indexOf("await continueAfterOutcome();",classification);
 const billing=body.indexOf("const reservation = reserveTaskModelRequest(orchestration)");
 assert.ok(classification>=0&&handoff>classification&&billing>handoff);
 assert.match(body,/classifyMasterCommentaryCompletion\(orchestration.task_graph\)/);
});
test("commentary on completed DAG never clears recovery before native Rust SHA verification",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("const progress = taskGraphProgress(orchestration.task_graph)");
 const end=ui.indexOf('if(remoteTask&&!staleModelRequest())await closeRemoteTask',start);
 const body=ui.slice(start,end);
 assert.match(body,/if\(completionRoute.mode==="native_finalizer"\)\{/);
 assert.match(body,/await continueAfterOutcome\(\);\s*return;/);
 assert.match(body,/if\(completionRoute.mode==="preserve_checkpoint"\)\{/);
 assert.match(body,/await stopAgentForSafety\("A native task DAG is not safely finalizable from AI commentary/);
 assert.match(body,/else\s*\{\s*await clearActiveCheckpoint\(\);/);
});
test("pure classifier never grants owner consent or makes a claim about creative acceptance",()=>{
 const source=readFileSync(new URL("../src/master-commentary-completion.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/invoke\(|execute_action|grantTaskRead|assessMasterFinalOutcome|original_goal_verified/);
});
