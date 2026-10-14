import test from "node:test";
import assert from "node:assert/strict";
import {delegatedWorkerContext} from "../src/native-worker-model-routing.mjs";
const graph={objective:"Video",steps:[{
 step_id:"x",expected_tool:"blender_run_plan",status:"ready",title:"Shape temple",
 purpose:"Model entrance",success_criteria:"Save .blend with verified render"
}]};
const assignment={isSpecialist:true,role:"blender",step_id:"x",tool:"blender_run_plan"};
test("specialist receives bounded exact step and tool without obtaining action authority",()=>{
 const context=delegatedWorkerContext("Audit state\n".repeat(1000),assignment,graph);
 assert.ok(context.includes("matching task_step_id and tool"));
 assert.ok(context.includes("Only permitted proposed tool for this turn: blender_run_plan"));
 assert.ok(context.includes("The owner must approve a new native action"));
 assert.ok(new TextEncoder().encode(context).length<=3000);
});
test("unready or tool-mismatched worker cannot buy a delegated model call",()=>{
 assert.equal(delegatedWorkerContext("",assignment,{...graph,steps:[{...graph.steps[0],status:"running"}]}),null);
 assert.equal(delegatedWorkerContext("",{...assignment,tool:"powershell"},graph),null);
 assert.equal(delegatedWorkerContext("",{isSpecialist:false},"bad-graph"),"");
});
