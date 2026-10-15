// Shuvi 37: MOCK native receipts, not a live Windows acceptance run.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {planVerifiedNativeReadback} from "../src/master-safe-continuation.mjs";
import {decideNativeContinuation} from "../src/native-continuation-driver.mjs";

const OWNER="Premiere kholo";
const A="123e4567-e89b-42d3-a456-426614174001";
const B="123e4567-e89b-42d3-a456-426614174002";
const C="123e4567-e89b-42d3-a456-426614174003";
const validReceipt=(step_id,tool,action_id,n)=>({
 step_id,tool,fingerprint:"mock-"+step_id+":"+action_id,
 action_id,audit_event:"executed",outcome:"success",
 source:"typed_result",success:true,orchestration_step:n
});
const node=(id,tool,deps=[],status="ready",receipts=[])=>({
 step_id:id,title:id,purpose:"native mock",success_criteria:"Native receipt required",
 expected_tool:tool,depends_on:deps,status,evidence:receipts,
 running:null,blocked_reason:null
});
const graph=()=>({
 objective:OWNER,revision:1,steps:[
  node("launch","premiere_launch",[],"completed",[validReceipt("launch","premiere_launch",A,1)]),
  node("window","ui_windows",["launch"]),
  node("process","list_processes",["window"],"pending")
 ]});
const policy=(overrides={})=>({
 lastOutcome:"success",recoveryMode:"normal",
 cancelRequested:false,remoteTask:false,...overrides
});
const propose=(g,o=policy())=>planVerifiedNativeReadback(g,OWNER,o);

test("one exact audited predecessor yields a dependency-bound, non-executed readback",()=>{
 const g=graph();
 assert.deepEqual(decideNativeContinuation(g).next,
   {step_id:"window",worker:"windows",tool:"ui_windows"});
 const next=propose(g);
 assert.equal(next.tool,"ui_windows");
 assert.equal(next.task_step_id,"window");
 assert.deepEqual(next.arguments,{});
 assert.equal(next.task_graph,undefined,"no model-owned graph forged");
 assert.match(next.reason,/Rust preparation, approval\/grant/);
});
test("mock-native two-step readback requires distinct owner approvals and UUID receipts",()=>{
 const g=graph();
 const native={
   pending:new Map(),audits:[],executed:0,approvalCount:0,providerRequests:0,
   prepare(proposal,id){
     assert.equal(proposal.tool,g.steps.find(s=>s.step_id===proposal.task_step_id).expected_tool);
     this.pending.set(id,proposal);
     return {id,kind:proposal.tool,risk:"low"};
   },
   approve(id){
     const p=this.pending.get(id);assert.ok(p,"a fresh prepared action is mandatory");
     this.pending.delete(id);this.approvalCount++;this.executed++;
     this.audits.push({action_id:id,tool:p.tool,event:"executed",success:true});
     return p;
   }
 };
 const one=propose(g);
 native.prepare(one,B);
 assert.equal(native.executed,0,"planning/staging never executes");
 assert.equal(native.providerRequests,0,"deterministic readback does not invoke provider");
 const grantedOne=native.approve(B);
 g.steps[1]={...g.steps[1],status:"completed",
   evidence:[validReceipt("window",grantedOne.tool,B,2)]};
 g.steps[2]={...g.steps[2],status:"ready"};
 const two=propose(g);
 assert.equal(two.tool,"list_processes");
 assert.equal(two.task_step_id,"process");
 native.prepare(two,C);
 assert.equal(native.executed,1,"a second read requires a second permission");
 assert.equal(native.approvalCount,1);
 native.approve(C);
 g.steps[2]={...g.steps[2],status:"completed",
   evidence:[validReceipt("process","list_processes",C,3)]};
 assert.equal(propose(g),null,"finished graph must not rerun");
 assert.equal(decideNativeContinuation(g).mode,"complete");
 assert.equal(native.audits.length,2);
 assert.equal(native.providerRequests,0);
 assert.equal(native.pending.size,0);
});
test("failed, denied, unknown and wrong UUID receipt never unlock a second read",()=>{
 for(const mutate of [
   g=>g.steps[0].evidence=[],
   g=>g.steps[0].evidence[0].action_id="not-a-uuid",
   g=>g.steps[0].evidence[0].audit_event="failed",
   g=>g.steps[0].evidence[0].tool="blender_inspect",
   g=>g.steps[0].evidence[0].source="model_claim",
   g=>g.steps[0].evidence[0].outcome="denied",
   g=>g.steps[0].evidence[0].success=false,
   g=>g.steps[0].status="failed",
   g=>g.steps[0].status="running"
 ]){
   const g=graph();mutate(g);
   assert.equal(propose(g),null,"unverified dependency must pause");
 }
});
test("concurrent native lease, stale owner request, out-of-scope app and unknown tool pause",()=>{
 const busy=graph();busy.steps[0].running={action_id:A};
 assert.equal(propose(busy),null);
 const foreign=graph();foreign.objective="Blender kholo";
 assert.equal(propose(foreign),null);
 const broken=graph();broken.steps[1].expected_tool="blender_run_plan";
 assert.equal(propose(broken),null);
 const unknown=graph();unknown.steps[1].expected_tool="unlisted_tool";
 assert.equal(propose(unknown),null);
});
test("readback cannot elide missing dependencies or replay already completed steps",()=>{
 const missing=graph();missing.steps[1].depends_on=["launch","missing_step"];
 assert.equal(propose(missing),null);
 const noParent=graph();noParent.steps[1].depends_on=[];
 assert.equal(propose(noParent),null);
 const replay=graph();replay.steps[1].status="completed";
 assert.equal(propose(replay),null);
});
test("writes, edits, exports and pointer mutations stay in explicit model + owner path",()=>{
 const disallowed=[
   "write_file","premiere_insert_media","premiere_export",
   "after_effects_run","blender_run_plan","ui_click","pointer_drag",
   "git_push","run_project_task","premiere_timeline"
 ];
 for(const tool of disallowed){
   const g=graph();g.steps[1].expected_tool=tool;
   assert.equal(propose(g),null,tool);
 }
});
test("stop, interrupted recovery, failure and remote task never inherit readback",()=>{
 for(const options of [
  {lastOutcome:"failure"},{lastOutcome:"denied"},{lastOutcome:null},
  {recoveryMode:"stopped"},{recoveryMode:"replan_required"},
  {cancelRequested:true},{remoteTask:true}
 ])assert.equal(propose(graph(),policy(options)),null);
});
test("a second writer cannot steal an already-audited native UUID",()=>{
 const g=graph();
 g.steps[1].status="completed";
 g.steps[1].evidence=[validReceipt("window","ui_windows",A,2)];
 g.steps[2].status="ready";
 assert.equal(propose(g),null,"duplicate UUID across worker steps quarantined");
});
test("Desktop stages only audit-backed readback through original Rust scheduler/approval path",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const driver=src.slice(src.indexOf("async function continueAfterOutcome()"),
  src.indexOf("async function stageProposal("));
 const plan=driver.indexOf("planVerifiedNativeReadback(");
 const host=driver.indexOf('invoke<NativeWorkerStatus>("native_worker_status")',plan);
 const status=driver.indexOf('invoke<NativeSchedule|null>("native_scheduler_status")',plan);
 const admission=driver.indexOf("assessMasterSchedulerAdmission(native,orchestration.task_graph)",plan);
 const stage=driver.indexOf("await stageProposal(safeReadback,route)",plan);
 const paid=driver.indexOf("await runAgentStep()",plan);
 assert.ok(plan>=0&&host>plan&&status>host&&admission>status&&stage>admission&&paid>stage);
 assert.match(driver,/host.state!=="idle"\|\|host.requiresOwnerReview\|\|host.durableJobPhase==="running"/);
 assert.match(src,/if\s*\(\s*!remoteTask\s*&&[\s\S]{0,400}allowsTaskRead\(activePermissionScope,activeReadGrant/);
 assert.match(src,/const bound = bindPreparedAction/);
 assert.match(src,/await invoke<PendingAction>\("prepare_tool"/);
 assert.match(src,/await invoke<ActionResult>\("execute_action"/);
 assert.match(src,/const receiptMatches = verifiedNativeActionResult/);
});
