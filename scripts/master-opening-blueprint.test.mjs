import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {attachNativePremiereOpeningBlueprint} from "../src/master-opening-blueprint.mjs";
import {parseTaskGraph,reviseTaskGraph,refreshTaskGraph} from "../src/task-graph.mjs";
import {validateMasterPlan,validateMasterAction} from "../src/master-autonomy-graph.mjs";
import {nextWorkerTurn} from "../src/master-worker-queue.mjs";

const first={tool:"premiere_launch",arguments:{}};
const fresh={task_graph:null,objective:null,recovery_mode:"normal",next_step:1,tool_actions:0};
const build=(brief="Premiere kholo",p=first,s=fresh)=>
 attachNativePremiereOpeningBlueprint(brief,p,s);

test("deterministic owner-brief-bound native DAG parses and runs through existing worker queue",()=>{
 for(const brief of ["Premiere kholo","Open Premiere","प्रीमियर खोलो","Premiere Pro kholo"]){
  const p=build(brief);
  assert.notEqual(p,first,"owner-scoped plan must be newly attached");
  assert.equal(p.task_step_id,"launch_premiere");
  assert.deepEqual(p.task_graph.steps.map(s=>s.expected_tool),["premiere_launch","ui_windows"]);
  assert.deepEqual(p.task_graph.steps[1].depends_on,["launch_premiere"]);
  assert.equal(p.task_graph.objective,brief);
  assert.equal(validateMasterAction(brief,p).ok,true);
  assert.equal(validateMasterPlan(brief,p.task_graph).ok,true);
  const parsed=parseTaskGraph(p.task_graph,8);
  assert.equal(parsed.ok,true,brief);
  const admitted=reviseTaskGraph(null,p.task_graph,null,0,8);
  assert.equal(admitted.ok,true);
  assert.equal(nextWorkerTurn(admitted.graph)?.tool,"premiere_launch");
  assert.equal(admitted.graph.steps[1].status,"pending");
  assert.equal(admitted.graph.steps[0].status,"ready");
 }
});
test("project/edit/export/multiple-app instructions never get an auto-authored graph",()=>{
 for(const brief of ["Premiere me naya project banao","Open Premiere and edit a clip",
  "Premiere export karo","Open Premiere then WhatsApp","Premiere kholo aur Blender kholo",
  "Premiere kholo aur folder delete kar do","Open Premiere and run PowerShell",
  "Open After Effects","Open Blender","Open Photoshop","Open Premiere and save a file"]){
   assert.equal(build(brief),first,brief);
 }
});
test("model-authored graph, worker IDs or task recovery are never silently overwritten",()=>{
 const custom={...first,task_graph:{objective:"changed",steps:[]}};
 const step={...first,task_step_id:"any"};
 const recovering={...first,task_recovery:true};
 assert.equal(build("Premiere kholo",custom),custom);
 assert.equal(build("Premiere kholo",step),step);
 assert.equal(build("Premiere kholo",recovering),recovering);
});
test("only exact first action, empty arguments and a brand-new owner task qualify",()=>{
 for(const p of [
  {tool:"launch_app",arguments:{}},
  {tool:"ui_windows",arguments:{}},
  {tool:"premiere_launch",arguments:{binary:"C:/fake.exe"}},
  {tool:"premiere_launch",arguments:[]},
  {tool:"premiere_launch",arguments:null}
 ])assert.equal(build("Premiere kholo",p),p);
 for(const state of [
  {...fresh,task_graph:{steps:[]}},
  {...fresh,objective:"Premiere kholo"},
  {...fresh,recovery_mode:"replan_required"},
  {...fresh,recovery_mode:"stopped"},
  {...fresh,next_step:2},
  {...fresh,tool_actions:1}
 ])assert.equal(build("Premiere kholo",first,state),first);
});
test("no model-defined status, execution, audit, grant or native permission in graph proposal",()=>{
 const p=build();
 assert.equal(p.task_graph.revision,1);
 for(const step of p.task_graph.steps){
  assert.deepEqual(Object.keys(step).sort(),
    ["step_id","title","purpose","success_criteria","expected_tool","depends_on"].sort());
  assert.ok(!("status" in step)&&!("evidence" in step)&&!("running" in step));
  assert.match(step.success_criteria,/Rust/);
 }
 assert.equal(p.task_graph.steps.length,2);
 assert.equal(p.arguments===first.arguments,true);
});
test("desktop attaches graph before native Rust preparation, cannot bypass approval",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=src.indexOf("async function stageProposal(");
 const blueprint=src.indexOf("attachNativePremiereOpeningBlueprint(ownerBrief,proposal,orchestration)",start);
 const scope=src.indexOf("const actionScope=validateMasterAction(ownerBrief,proposal)",start);
 const graphGate=src.indexOf("const planScope=validateMasterPlan(ownerBrief,proposal.task_graph)",start);
 const prepare=src.indexOf('await invoke<PendingAction>("prepare_tool"',start);
 assert.ok(start>0&&blueprint>start&&scope>blueprint&&graphGate>scope&&prepare>graphGate);
 assert.match(src.slice(start,scope),/if\(!remoteTask&&!cancelRequested\)/);
 assert.match(src,/const bound = bindPreparedAction\(orchestration, proposal, preparedId\)/);
 assert.match(src,/renderChatPermission\(proposal, step\)/);
 assert.match(src,/const receiptMatches = verifiedNativeActionResult/);
});
