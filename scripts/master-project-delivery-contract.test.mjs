import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPremiereProjectDeliveryContract as assess} from "../src/master-project-delivery-contract.mjs";
import {assessMasterFinalOutcome} from "../src/master-final-outcome.mjs";
import {captureNativeProjectProofFence,isNativeProjectProofFenceCurrent} from "../src/master-project-proof-fence.mjs";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const CREATE="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OPEN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const OTHER="6edb58c0-13b4-49d3-9463-56e255ba8c84";
const OWNER="Premiere me naya project banao";
const PATH="C:\\Projects\\Shuvi Test.prproj";
const HEX="a".repeat(64),FNV="0123456789abcdef";
const mkstep=(id,tool,action,n,depends_on=[])=>({
 step_id:id,expected_tool:tool,depends_on,status:"completed",running:null,
 evidence:[{step_id:id,tool,action_id:action,orchestration_step:n,
  fingerprint:"native:"+action,source:"typed_result",
  audit_event:"executed",outcome:"success",success:true}]
});
function fixture(){
 const graph={objective:OWNER,revision:1,steps:[
  mkstep("create_project","premiere_create_project",CREATE,1),
  mkstep("open_project","premiere_open_project",OPEN,2,["create_project"])]};
 const schedule={version:1,objective:OWNER,revision:1,jobs:[
  {stepId:"create_project",tool:"premiere_create_project",phase:"audited",actionId:CREATE,dependsOn:[]},
  {stepId:"open_project",tool:"premiere_open_project",phase:"audited",actionId:OPEN,dependsOn:["create_project"]}]};
 const created={taskId:TASK,actionId:CREATE,stepId:"create_project",
  projectGuid:"adobe-guid",projectPath:PATH,sizeBytes:8192,fnv1a64:FNV,
  hostIdentityObserved:true,diskBytesObserved:true,
  sha256Attested:false,reopenVerified:false,originalGoalVerified:false};
 const sha={taskId:TASK,actionId:CREATE,projectGuid:"adobe-guid",
  projectPath:PATH,bytes:8192,fnv1a64:FNV,sha256:HEX,
  hashAlgorithm:"sha256",fileBytesVerified:true,
  projectReopenVerified:false,originalGoalVerified:false};
 const reopened={taskId:TASK,createActionId:CREATE,reopenActionId:OPEN,
  projectGuid:"adobe-guid",projectPath:PATH,sha256BeforeReopen:HEX,
  fileBytesVerifiedBeforeReopen:true,hostProjectReopenObserved:true,
  diskFingerprintUnchanged:true,sha256AfterReopenVerified:true,
  projectReopenEvidenceVerified:true,originalGoalVerified:false};
 const delivery={version:1,objective:OWNER,revision:1,recordedAtMs:9999,steps:[
  {stepId:"create_project",tool:"premiere_create_project",actionId:CREATE,
   artifact:{kind:"premiere_project",path:PATH,sha256:HEX,bytes:8192}},
  {stepId:"open_project",tool:"premiere_open_project",actionId:OPEN,artifact:null}]};
 return {owner:OWNER,graph,schedule,delivery,taskId:TASK,created,sha,reopened};
}
const run=x=>assess(x.owner,x.graph,x.schedule,x.delivery,x.taskId,x.created,x.sha,x.reopened);
test("source/mock create > native SHA > separately audited reopen > proposed delivery does NOT complete goal",()=>{
 const x=fixture(),p=run(x);
 assert.equal(p.stage,"native_delivery_contract_aligned");
 assert.equal(p.deliveryContractAligned,true);
 assert.equal(p.originalGoalVerified,false);
 assert.equal(p.windowsLiveVerified,false);
 assert.equal(assessMasterFinalOutcome(OWNER,x.graph,x.schedule,x.delivery,null,TASK).verified,false);
});
test("native Rust SHA project delivery is cryptographic only; creative goal still unverified",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
 assert.match(rust,/"premiere_create_project"\s*=>\s*"premiere_project"/);
 assert.match(rust,/SHA-256 changed/);
 assert.match(rust,/premiere_project_proof_requires_create_action_and_correct_artifact_kind/);
 const x=fixture();x.delivery.steps[0].artifact=null;
 assert.equal(run(x).stage,"rust_project_delivery_missing");
});
test("wrong SHA, path, size, type or synthetic export cannot replace .prproj native proof",()=>{
 for(const change of [
  a=>a.sha256="f".repeat(64),a=>a.sha256="fake",
  a=>a.path="C:\\Other\\wrong.prproj",a=>a.bytes=8193,
  a=>a.kind="accepted_remotion"
 ]){const x=fixture();change(x.delivery.steps[0].artifact);
  assert.equal(run(x).deliveryContractAligned,false);}
});
test("foreign owner scope, compound goal or task cannot gain project acceptance",()=>{
 for(const owner of ["Premiere kholo","Premiere me video edit karo",
  "Premiere me video export karo","Open Blender and create project",
  "Premiere me naya project banao aur export karo"]){
  const x=fixture();x.owner=owner;
  assert.equal(run(x).deliveryContractAligned,false,owner);
 }
 for(const change of [
  x=>x.taskId=OTHER,x=>x.created.taskId=OTHER,x=>x.sha.actionId=OTHER,
  x=>x.reopened.reopenActionId=CREATE
 ]){const x=fixture();change(x);
  assert.equal(run(x).deliveryContractAligned,false);}
});
test("invalid scheduler/receipt/replay, unknown native outcome or reordered jobs fail closed",()=>{
 const changes=[
  x=>x.schedule.jobs[0].actionId=OTHER,
  x=>x.schedule.jobs[1].phase="outcome_unknown",
  x=>x.schedule.objective="new goal",
  x=>x.schedule.jobs[1].dependsOn=[],
  x=>x.delivery.steps.reverse(),
  x=>x.delivery.steps[1].actionId=CREATE,
  x=>x.delivery.steps[1].artifact={...x.delivery.steps[0].artifact},
  x=>x.delivery.steps[0].tool="premiere_open_project",
  x=>x.graph.steps[1].evidence[0].audit_event="failed",
  x=>x.graph.steps[1].status="failed"
 ];
 for(const change of changes){const x=fixture();change(x);
  assert.equal(run(x).deliveryContractAligned,false);}
});
test("changed reopen hash, foreign project, missing dependency or stale evidence fail closed",()=>{
 const changes=[
  x=>x.graph.steps[1].depends_on=[],
  x=>x.graph.steps[1].evidence[0].orchestration_step=1,
  x=>x.reopened.sha256BeforeReopen="f".repeat(64),
  x=>x.sha.sha256="f".repeat(64),
  x=>x.created.projectPath="C:\\Wrong\\other.prproj",
  x=>x.created.projectPath="C:\\Projects\\..\\other.prproj",
  x=>x.reopened.projectGuid="foreign-guid",
  x=>x.reopened.projectReopenEvidenceVerified=false
 ];
 for(const change of changes){const x=fixture();change(x);
  assert.equal(run(x).deliveryContractAligned,false);}
});
test("Stop/revocation/crash-restore invalidates async work before native delivery",()=>{
 const x=fixture(),scope={taskId:TASK,revoked:false};
 const fence=captureNativeProjectProofFence(scope,x.graph,OWNER,CREATE);
 const now={scope,graph:x.graph,ownerRequest:OWNER,actionId:CREATE,
  cancelRequested:false,recoveryMode:"normal"};
 assert.equal(isNativeProjectProofFenceCurrent(fence,now),true);
 for(const next of [
  {...now,cancelRequested:true},{...now,recoveryMode:"recovery"},
  {...now,scope:{...scope}},{...now,graph:{...x.graph}},
  {...now,actionId:OTHER}
 ])assert.equal(isNativeProjectProofFenceCurrent(fence,next),false);
 scope.revoked=true;assert.equal(isNativeProjectProofFenceCurrent(fence,now),false);
});
test("Desktop never upgrades project delivery mock to successful original goal",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(ui,/assessPremiereProjectDeliveryContract\(/);
 assert.match(ui,/projectDelivery\.reason/);
 assert.match(ui,/if\(protectProjectProof&&!proofFenceCurrent\(postAuditProofFence\)\)return;/);
 assert.match(ui,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
 const source=readFileSync(new URL("../src/master-project-delivery-contract.mjs",import.meta.url),"utf8");
 assert.match(source,/originalGoalVerified:false/);
 assert.doesNotMatch(source,/invoke\(|execute_action\(|prepare_tool\(/);
});
