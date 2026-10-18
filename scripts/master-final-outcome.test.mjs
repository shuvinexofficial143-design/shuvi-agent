import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessMasterFinalOutcome,summarizeMasterMissingProof,masterGoalEvidenceContext} from "../src/master-final-outcome.mjs";

const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const owner="Premiere kholo";
const st=(step_id,expected_tool,action_id,orchestration_step,depends_on=[])=>({
 step_id,expected_tool,depends_on,status:"completed",running:null,
 evidence:[{step_id,tool:expected_tool,action_id,orchestration_step,
  fingerprint:"mock:"+action_id,source:"typed_result",
  audit_event:"executed",outcome:"success",success:true}]
});
const graph=()=>({objective:owner,revision:1,steps:[
 st("launch","premiere_launch",A,1),
 st("observe","ui_windows",B,2,["launch"])
]});
const schedule=()=>({version:1,objective:owner,revision:1,jobs:[
 {stepId:"launch",tool:"premiere_launch",actionId:A,phase:"audited",dependsOn:[]},
 {stepId:"observe",tool:"ui_windows",actionId:B,phase:"audited",dependsOn:["launch"]}
]});
const delivery=()=>({version:1,objective:owner,revision:1,recordedAtMs:9999,steps:[
 {stepId:"launch",tool:"premiere_launch",actionId:A,artifact:null},
 {stepId:"observe",tool:"ui_windows",actionId:B,artifact:null}
]});
const proof=()=>({taskId:TASK,objective:owner,actionId:B,stepId:"observe",
 window:{app:"premiere",title:"Adobe Premiere Pro 2026",pid:812,hwnd:1355}});
const outcome=(request,g=graph(),d=delivery(),s=schedule(),p=proof(),taskId=TASK)=>
 assessMasterFinalOutcome(request,g,s,d,p,taskId);

test("only independently corroborated Premiere opening can be reported as verified",()=>{
 const accepted=outcome(owner);
 assert.equal(accepted.verified,true);
 assert.equal(accepted.scope,"premiere_window");
 assert.equal(accepted.completedNativeSteps,2);
 assert.deepEqual(accepted.missing,[]);
 assert.equal(accepted.actionId,B);
});

test("all-successful native graph with no original app verifier MUST NOT finish the task",()=>{
 for(const request of [
  "Run tests and push the code","Install a program",
  "Create a document","Open WhatsApp","Open Blender",
  "Open After Effects","Open Photoshop"
 ]){
  const result=outcome(request);
  assert.equal(result.verified,false,request);
  assert.match(summarizeMasterMissingProof(result),/ORIGINAL TASK UNVERIFIED/);
 }
});

test("a project save needs BOTH native application identity and independently hashed .prproj",()=>{
 for(const request of [
  "Premiere me naya project banao",
  "Open Premiere and make new project",
  "प्रीमियर में नया प्रोजेक्ट बनाओ"
 ]){
  const result=outcome(request);
  assert.equal(result.verified,false,request);
  assert.equal(result.scope,"unverified");
  assert.ok(result.missing.some(x=>x.id==="new_project_identity"),request);
  assert.ok(result.missing.some(x=>x.id==="saved_project_location"),request);
  const message=summarizeMasterMissingProof(result);
  assert.match(message,/\.prproj/);
  assert.match(message,/Rust SHA-256/);
  assert.doesNotMatch(message,/COMPLETED/);
 }
});

test("a video edit or export is not proven by another tool's verified artifact",()=>{
 const g=graph(),d=delivery();
 d.steps[0].artifact={kind:"accepted_remotion",path:"C:/out.mp4",
  sha256:"a".repeat(64),bytes:300};
 for(const goal of ["Edit this video in Premiere","Premiere me video export karo",
  "Open Premiere and edit, then export final video"]){
  const result=outcome(goal,g,d);
  assert.equal(result.verified,false);
  assert.match(result.reason,/not independently verified/);
  assert.ok(result.missing.some(x=>["observed_edit_effect","persisted_export_artifact"].includes(x.id)));
 }
});

test("an ambiguous or mismatched Rust/native delivery must not be considered complete",()=>{
 assert.equal(outcome(owner,graph(),delivery(),schedule(),null).verified,false);
 assert.equal(outcome(owner,graph(),delivery(),schedule(),proof(),A).verified,false);
 const invalid=delivery();invalid.steps[1].actionId=A;
 assert.equal(outcome(owner,graph(),invalid).verified,false);
 const invalidSchedule=schedule();invalidSchedule.jobs[1].phase="queued";
 assert.equal(outcome(owner,graph(),delivery(),invalidSchedule).verified,false);
});

test("partial audits do not imply creative proof and unrecognized results fail closed",()=>{
 const g=graph();g.steps[1].status="failed";
 assert.equal(outcome(owner,g).verified,false);
 const generic=outcome("Build a website",g);
 assert.equal(generic.verified,false);
 assert.ok(generic.missing.some(x=>x.id==="task_specific_result"));
 assert.match(summarizeMasterMissingProof(generic),/model-neutral|independent/);
 assert.equal(assessMasterFinalOutcome(null,g,null,null,null,TASK).verified,false);
});

test("native desktop finalization refuses ANY unsupported original goal before success and remote receipt",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=ui.indexOf("const finalOutcome=assessMasterFinalOutcome(");
 const guard=ui.indexOf("if(!finalOutcome.verified){",start);
 const finish=ui.indexOf("const completed=taskGraphProgress(orchestration.task_graph)",guard);
 const remote=ui.indexOf('if(!(await closeRemoteTask(terminalStatus)))return;',finish);
 assert.ok(start>0&&guard>start&&finish>guard&&remote>finish);
 assert.match(ui,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
 assert.match(ui,/if\(goalAcceptance.requiresIndependentAcceptance&&!openingAcceptance.verified\)/);
});

test("Master gets independent proof requirements BEFORE any paid model proposal",()=>{
 const plan=masterGoalEvidenceContext("Premiere me naya project banao aur export karo");
 assert.match(plan,/new_project_identity/);
 assert.match(plan,/saved_project_location/);
 assert.match(plan,/persisted_export_artifact/);
 assert.match(plan,/\.prproj/);
 assert.match(plan,/FNV-1a64 is not cryptographic/);
 assert.match(plan,/not yet installed/);
 assert.match(plan,/Never invent/);
 assert.ok(plan.length<1900,"model context must remain bounded");
 const opening=masterGoalEvidenceContext("Premiere kholo");
 assert.match(opening,/Premiere launcher/);
 assert.match(opening,/opening only/);
 assert.doesNotMatch(opening,/project path.*verified/);
 const bad=masterGoalEvidenceContext(null);
 assert.match(bad,/do not stage native work/);
 const desktop=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(desktop,/orchestration_context: workerContext\+"\\n"\+masterGoalEvidenceContext\(orchestration.owner_request\)/);
 const evidenceAt=desktop.indexOf('orchestration_context: workerContext+"\\n"+masterGoalEvidenceContext(orchestration.owner_request)');
 const modelCall=desktop.indexOf('const response = await invoke<ChatResponse>("chat"');
 assert.ok(evidenceAt>modelCall,"proof guidance must be included in the actual native model dispatch");
});
