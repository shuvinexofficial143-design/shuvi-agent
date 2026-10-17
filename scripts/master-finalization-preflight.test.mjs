import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nativeTaskDeliveryClaims} from "../src/native-delivery-claims.mjs";
import {assessNativeFinalizationPreflight as preflight} from "../src/master-finalization-preflight.mjs";
import {assessMasterFinalOutcome} from "../src/master-final-outcome.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const CREATE="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OPEN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const OWNER="Premiere me naya project banao";
const PATH="C:\\Projects\\Shuvi Test.prproj",SHA="a".repeat(64);
const task=(tool,id,action,n,deps=[])=>({step_id:id,expected_tool:tool,
 depends_on:deps,status:"completed",running:null,evidence:[{
 step_id:id,tool,action_id:action,orchestration_step:n,
 fingerprint:"native:"+action,source:"typed_result",
 audit_event:"executed",outcome:"success",success:true}]});
function fixture(){
 const graph={objective:OWNER,revision:1,steps:[
  task("premiere_create_project","create",CREATE,1),
  task("premiere_open_project","reopen",OPEN,2,["create"])]};
 const schedule={version:1,objective:OWNER,revision:1,jobs:[
  {stepId:"create",tool:"premiere_create_project",phase:"audited",actionId:CREATE,dependsOn:[]},
  {stepId:"reopen",tool:"premiere_open_project",phase:"audited",actionId:OPEN,dependsOn:["create"]}]};
 const created={taskId:TASK,actionId:CREATE,stepId:"create",projectGuid:"guid-1",
  projectPath:PATH,sizeBytes:8192,fnv1a64:"0123456789abcdef",
  hostIdentityObserved:true,diskBytesObserved:true,
  sha256Attested:false,reopenVerified:false,originalGoalVerified:false};
 const sha={taskId:TASK,actionId:CREATE,projectGuid:"guid-1",projectPath:PATH,
  bytes:8192,fnv1a64:"0123456789abcdef",sha256:SHA,
  hashAlgorithm:"sha256",fileBytesVerified:true,
  projectReopenVerified:false,originalGoalVerified:false};
 const reopen={taskId:TASK,createActionId:CREATE,reopenActionId:OPEN,
  projectGuid:"guid-1",projectPath:PATH,sha256BeforeReopen:SHA,
  fileBytesVerifiedBeforeReopen:true,hostProjectReopenObserved:true,
  diskFingerprintUnchanged:true,sha256AfterReopenVerified:true,
  projectReopenEvidenceVerified:true,originalGoalVerified:false};
 return {graph,schedule,created,sha,reopen};
}
function check(f,owner=OWNER,claims=nativeTaskDeliveryClaims(f.graph,f.schedule),taskId=TASK){
 return preflight(owner,f.graph,f.schedule,claims,taskId,f.created,f.sha,f.reopen);
}
test("even a fully Rust-audited Premiere Create/Reopen DAG MUST NOT publish a fake .prproj delivery",()=>{
 const f=fixture(),claims=nativeTaskDeliveryClaims(f.graph,f.schedule);
 assert.ok(claims);assert.equal(claims.length,2);
 assert.equal(claims[0].artifact,null);
 const result=check(f);
 assert.equal(result.allowed,false);
 assert.equal(result.stage,"premiere_project_delivery_unavailable");
 assert.equal(result.projectProofStage,"reopen_audited");
 assert.equal(result.originalGoalVerified,false);
 assert.match(result.reason,/Rust delivery cannot independently rehash/);
 assert.equal(assessMasterFinalOutcome(OWNER,f.graph,f.schedule,
  {version:1,objective:OWNER,revision:1,recordedAtMs:1,steps:claims},null,TASK).verified,false);
});
test("missing SHA/reopen, another task and unverified project all remain blocked",()=>{
 const f=fixture();
 for(const mutate of [
  x=>x.sha=null,x=>x.reopen=null,
  x=>x.created.taskId=OPEN,
  x=>x.reopen.reopenActionId=CREATE
 ]){
  const copy=structuredClone(f);mutate(copy);
  const q=check(copy);assert.equal(q.allowed,false);
  assert.notEqual(q.projectProofStage,"reopen_audited");
 }
 assert.equal(check(f,OWNER,nativeTaskDeliveryClaims(f.graph,f.schedule),OPEN).allowed,false);
});
test("claim injection, forged .prproj artifact and swapped audited action fail closed",()=>{
 const f=fixture(),original=nativeTaskDeliveryClaims(f.graph,f.schedule);
 assert.ok(original);
 const injected=structuredClone(original);
 injected[0].artifact={kind:"premiere_project",path:PATH,sha256:SHA,bytes:8192};
 assert.equal(check(f,OWNER,injected).allowed,false);
 const swapped=structuredClone(original);
 swapped[1].actionId=CREATE;
 assert.equal(check(f,OWNER,swapped).stage,"unreconciled_native_claims");
 const missing=structuredClone(original);
 missing.pop();
 assert.equal(check(f,OWNER,missing).allowed,false);
 f.schedule.jobs[1].phase="outcome_unknown";
 assert.equal(check(f,OWNER,original).allowed,false);
});
test("a model cannot sidestep the project gate by rewriting owner brief",()=>{
 const f=fixture();
 for(const owner of ["Premiere kholo","Open Blender","Build website","Premiere me video export karo"]){
  assert.equal(check(f,owner).allowed,false,owner);
 }
});
test("ordinary source-audited Premiere OPEN WINDOW without project creation can still finalize",()=>{
 const f=fixture();
 const graph={objective:"Premiere kholo",revision:1,steps:[
  task("premiere_launch","launch",CREATE,1),
  task("ui_windows","windows",OPEN,2,["launch"])]};
 const schedule={version:1,objective:"Premiere kholo",revision:1,jobs:[
  {stepId:"launch",tool:"premiere_launch",phase:"audited",actionId:CREATE,dependsOn:[]},
  {stepId:"windows",tool:"ui_windows",phase:"audited",actionId:OPEN,dependsOn:["launch"]}]};
 const claims=nativeTaskDeliveryClaims(graph,schedule);
 assert.ok(claims);
 const ok=preflight("Premiere kholo",graph,schedule,claims,TASK,null,null,null);
 assert.equal(ok.allowed,true);
 assert.equal(ok.stage,"standard_native_audited_delivery");
 assert.equal(ok.originalGoalVerified,false);
});
test("standard harmless inspected read work remains eligible, but outcome acceptance stays separate",()=>{
 const graph={objective:"Inspect workspace",revision:1,steps:[
  task("git_status","status",CREATE,1)]};
 const schedule={version:1,objective:"Inspect workspace",revision:1,jobs:[
  {stepId:"status",tool:"git_status",phase:"audited",actionId:CREATE,dependsOn:[]}]};
 const claims=nativeTaskDeliveryClaims(graph,schedule);assert.ok(claims);
 assert.equal(preflight("Inspect workspace",graph,schedule,claims,TASK,null,null,null).allowed,true);
});
test("Desktop runs preflight strictly BEFORE native finalizer and retains independent creative acceptance",()=>{
 const desktop=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=desktop.indexOf("const preflight=assessNativeFinalizationPreflight(");
 const stop=desktop.indexOf('if(!preflight.allowed){',start);
 const native=desktop.indexOf('"finalize_native_task_delivery"',start);
 const goal=desktop.indexOf("const finalOutcome=assessMasterFinalOutcome(",native);
 assert.ok(start>0&&stop>start&&native>stop&&goal>native);
 assert.match(desktop,/await stopAgentForSafety\("Final native delivery withheld: "/);
 assert.match(desktop,/if\(!continuationCurrent\(\)\)return;/);
});
test("late failed checkpoint / native scheduler / delivery may not stop a rotated task",()=>{
 const desktop=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(desktop,/if\(!stillCurrent\(\)\)return false;/);
 assert.match(desktop,/persistRequiredContinuationCheckpoint\(continuationCurrent\)/);
 assert.match(desktop,/if\(activePermissionScope!==stoppedScope\)return;/);
 assert.match(desktop,/if\(!continuationCurrent\(\)\)return;\s*await stopAgentForSafety\("Cannot verify terminal Rust task schedule/);
 assert.match(desktop,/if\(!continuationCurrent\(\)\)return;\s*await stopAgentForSafety\("Native delivery verification failed/);
});
