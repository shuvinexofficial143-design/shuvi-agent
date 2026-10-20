import test from "node:test";
import assert from "node:assert/strict";
import {delegatedWorkerContext,reservedGoalEvidenceBudget} from "../src/native-worker-model-routing.mjs";
import {masterGoalEvidenceContext} from "../src/master-final-outcome.mjs";
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
test("Master model context reserves full proof instructions before the native 3000-character limit",()=>{
 const proof=masterGoalEvidenceContext("Premiere me naya project banao aur export karo");
 const budget=reservedGoalEvidenceBudget(proof);
 const base="Task state and prior audited evidence. ".repeat(150);
 assert.ok(budget>0&&budget<3000);
 assert.ok(new TextEncoder().encode(base+"\n"+proof).length>3000,
  "the old unreserved suffix must reproduce the Windows context rejection");
 for(const delegation of [{isSpecialist:false},assignment]){
  const worker=delegatedWorkerContext(base,delegation,graph,budget);
  assert.ok(worker!==null);
  if(delegation.isSpecialist){
   assert.match(worker,/matching task_step_id and tool/);
   assert.match(worker,/The owner must approve a new native action/);
  }
  const combined=worker+"\n"+proof;
  assert.ok(new TextEncoder().encode(combined).length<=3000);
  assert.ok([...combined].length<=3000);
  assert.ok(combined.endsWith("\n"+proof));
 }
});
test("Unicode boundaries never split a codepoint or omit required proof",()=>{
 const goalEvidence="अगले कदम की सत्यापित जानकारी ✅";
 const budget=reservedGoalEvidenceBudget(goalEvidence);
 const worker=delegatedWorkerContext("खिड़की🪟".repeat(1000),{isSpecialist:false},null,budget);
 assert.ok(worker!==null);
 assert.ok(new TextEncoder().encode(worker+"\n"+goalEvidence).length<=3000);
 assert.ok((worker+"\n"+goalEvidence).endsWith(goalEvidence));
 assert.equal(reservedGoalEvidenceBudget(""),null);
 assert.equal(reservedGoalEvidenceBudget("e".repeat(3000)),null);
 assert.equal(delegatedWorkerContext("abc",{isSpecialist:false},null,3001),null);
 assert.equal(delegatedWorkerContext("abc",{isSpecialist:false},null,-1),null);
});
