import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureMasterOpeningObservation,verifyMasterOpeningDelivery} from "../src/master-goal-window-acceptance.mjs";
import {assessMasterGoalDelivery} from "../src/master-autonomy-graph.mjs";

const OWNER="Premiere kholo";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const OTHER="12b0d05f-1b0a-4bf7-880e-f60d6a1c9cee";
const LAUNCH="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const READ="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const receipt=(step_id,tool,action_id,n)=>({
 step_id,tool,action_id,orchestration_step:n,fingerprint:"typed:"+tool+":"+n,
 success:true,source:"typed_result",audit_event:"executed",outcome:"success"
});
const step=(id,tool,deps=[],idAction=LAUNCH,n=1)=>({
 step_id:id,title:id,purpose:id,success_criteria:"distinct verified Rust result",
 expected_tool:tool,depends_on:deps,status:"completed",running:null,
 evidence:[receipt(id,tool,idAction,n)]
});
const graph=()=>({objective:OWNER,revision:1,steps:[
 step("open","premiere_launch",[],LAUNCH,1),
 step("observe","ui_windows",["open"],READ,2)
]});
const schedule=()=>({version:1,objective:OWNER,revision:1,jobs:[
 {stepId:"open",tool:"premiere_launch",dependsOn:[],phase:"audited",actionId:LAUNCH},
 {stepId:"observe",tool:"ui_windows",dependsOn:["open"],phase:"audited",actionId:READ}
]});
const delivery=()=>({version:1,objective:OWNER,revision:1,recordedAtMs:12345678,steps:[
 {stepId:"open",tool:"premiere_launch",actionId:LAUNCH,artifact:null},
 {stepId:"observe",tool:"ui_windows",actionId:READ,artifact:null}
]});
const observedResult=(rows=[
 {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:400,NativeWindowHandle:567}
])=>({tool:"ui_windows",success:true,exit_code:0,stderr:"",stdout:JSON.stringify(rows)});
const proposed={tool:"ui_windows",arguments:{},task_step_id:"observe"};
const evidence=(g=graph(),result=observedResult(),owner=OWNER)=>
 captureMasterOpeningObservation(owner,g,proposed,result,READ,TASK,true);

test("independent Premiere window acceptance requires native audit + exact final delivery",()=>{
 const g=graph(),s=schedule(),d=delivery(),proof=evidence(g);
 assert.deepEqual(proof?.window,{app:"premiere",title:"Adobe Premiere Pro 2026",pid:400,hwnd:567});
 const accepted=verifyMasterOpeningDelivery(OWNER,g,s,d,proof,TASK);
 assert.equal(accepted.verified,true);
 assert.equal(accepted.scope,"premiere_window");
 assert.equal(accepted.actionId,READ);
 assert.equal(assessMasterGoalDelivery(OWNER,g).requiresIndependentAcceptance,true);
});
test("never accepts project, editing, Blender or an unspecific task from an observed Premiere title",()=>{
 for(const userRequest of ["Premiere me naya project banao",
  "Edit this video in Premiere","Premiere export karo","Blender kholo","Open editor"]){
  const g=graph();
  g.objective=userRequest;
  const result=captureMasterOpeningObservation(userRequest,g,proposed,observedResult(),READ,TASK,true);
  assert.equal(result,null,userRequest);
  assert.equal(verifyMasterOpeningDelivery(userRequest,g,schedule(),delivery(),result,TASK).verified,false);
 }
});
test("window title without matching native process identity cannot prove an opening goal",()=>{
 for(const rows of [
  [{Name:"Adobe Premiere Pro 2026",ProcessName:"Notepad",ProcessId:400,NativeWindowHandle:567}],
  [{Name:"Adobe Premiere Pro 2026",ProcessName:"",ProcessId:400,NativeWindowHandle:567}],
  [{Name:"Adobe Premiere Pro 2026",ProcessId:400,NativeWindowHandle:567}],
  [{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:400,NativeWindowHandle:567},
   {Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:401,NativeWindowHandle:568}],
  [{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:400,NativeWindowHandle:567},
   {Name:"Another app",ProcessName:"Notepad",ProcessId:401,NativeWindowHandle:567}],
  [{Name:"Adobe Photoshop Premiere",ProcessName:"Adobe Premiere Pro",ProcessId:400,NativeWindowHandle:567}],
  []
 ])assert.equal(evidence(graph(),observedResult(rows)),null,JSON.stringify(rows));
});
test("malformed, oversized and failed UI tool observations do not create window proof",()=>{
 const good=observedResult();
 for(const value of [
  {...good,success:false}, {...good,exit_code:1},{...good,stdout:"not json"},
  {...good,stdout:"x".repeat(250001)}, {...good,tool:"premiere_launch"}
 ])assert.equal(evidence(graph(),value),null);
 assert.equal(captureMasterOpeningObservation(OWNER,graph(),proposed,good,READ,TASK,false),null);
 assert.equal(captureMasterOpeningObservation(OWNER,graph(),proposed,good,LAUNCH,TASK,true),null);
});
test("task-scoped window evidence never migrates to new owner task or changed brief",()=>{
 const captured=evidence(),g=graph(),s=schedule(),d=delivery();
 assert.equal(verifyMasterOpeningDelivery(OWNER,g,s,d,captured,OTHER).verified,false);
 assert.equal(verifyMasterOpeningDelivery("Open Blender",g,s,d,captured,TASK).verified,false);
 assert.equal(verifyMasterOpeningDelivery(OWNER,{...g,objective:"Open Blender"},s,d,captured,TASK).verified,false);
 assert.equal(verifyMasterOpeningDelivery(OWNER,g,s,d,{...captured,actionId:LAUNCH},TASK).verified,false);
});
test("one audited UI read cannot stand in for a distinct dependency-bound launcher",()=>{
 const good=evidence(),s=schedule(),d=delivery();
 for(const mutate of [
  g=>g.steps[0].evidence=[],
  g=>g.steps[0].evidence[0].action_id=READ,
  g=>g.steps[0].evidence[0].orchestration_step=2,
  g=>g.steps[1].depends_on=[],
  g=>g.steps[1].status="running",
  g=>g.steps[1].evidence[0].source="model_claim",
  g=>g.steps[1].evidence[0].action_id=LAUNCH,
  g=>g.steps[1].evidence.push({...g.steps[1].evidence[0]}),
  g=>g.steps[0].expected_tool="premiere_context"
 ]){
  const g=graph();mutate(g);
  assert.equal(verifyMasterOpeningDelivery(OWNER,g,s,d,good,TASK).verified,false);
 }
});
test("independent Rust scheduler and final delivery must match every declared action",()=>{
 const proof=evidence();
 for(const mutate of [
   s=>s.jobs[1].phase="queued",
   s=>s.jobs[1].actionId=LAUNCH,
   s=>s.jobs[0].phase="running",
   s=>s.objective="another owner task",
   s=>s.jobs.pop()
 ]){
  const s=schedule();mutate(s);
  assert.equal(verifyMasterOpeningDelivery(OWNER,graph(),s,delivery(),proof,TASK).verified,false);
 }
 for(const mutate of [
  d=>d.steps[1].actionId=LAUNCH,
  d=>d.steps[1].stepId="open",
  d=>d.steps[1].tool="blender_inspect",
  d=>d.steps.pop(),
  d=>d.objective="someone else",
  d=>d.revision=2,
  d=>d.version=2
 ]){
  const d=delivery();mutate(d);
  assert.equal(verifyMasterOpeningDelivery(OWNER,graph(),schedule(),d,proof,TASK).verified,false);
 }
});
test("desktop captures volatile proof only after executed Rust audit and never restores it",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(src,/let openingWindowObservation:AuditedOpeningObservation\|null=null/);
 assert.match(src,/function rotatePermissionScope\(\):void\{\s*const oldId=.*\s*openingWindowObservation=null/);
 assert.match(src,/proposal.tool==="ui_windows"&&receiptMatches&&!cancelledByUser/);
 assert.match(src,/activePermissionScope.taskId===permissionTaskId/);
 assert.match(src,/openingWindowObservation=captureMasterOpeningObservation\(/);
 assert.match(src,/verifyMasterOpeningDelivery\(\s*orchestration.owner_request,orchestration.task_graph,schedule,nativeDelivery,/);
 assert.match(src,/if\(goalAcceptance.requiresIndependentAcceptance&&!openingAcceptance.verified\)/);
 assert.match(src,/await stopAgentForSafety\("All native worker steps have successful Rust receipts, but ORIGINAL TASK UNVERIFIED/);
 assert.doesNotMatch(src.slice(src.indexOf("function currentCheckpoint(): SessionCheckpoint"),
  src.indexOf("function nativeWorkerDisplay(): string")),/openingWindowObservation/);
});
