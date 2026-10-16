// Shuvi 37: call REAL source-level validators across the entire mock-native
// owner → audited create → Rust SHA → separately audited reopen → delivery chain.
// Native tool execution, Rust consent and Adobe host are deliberately mocked.
import test from "node:test";
import assert from "node:assert/strict";
import {inspectPremiereProjectCreateCandidate}
 from "../src/premiere-project-evidence-candidate.mjs";
import {bindNativePremiereShaProof} from "../src/native-project-sha-proof.mjs";
import {inspectPremiereProjectReopenCandidate,bindPremiereReopenShaAfterReadback}
 from "../src/premiere-project-reopen-evidence.mjs";
import {assessPremiereProjectDeliveryContract}
 from "../src/master-project-delivery-contract.mjs";
import {nativeTaskDeliveryClaims} from "../src/native-delivery-claims.mjs";
import {assessMasterFinalOutcome} from "../src/master-final-outcome.mjs";

const OWNER="Premiere me naya project banao";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const CREATE="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OPEN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const PATH="C:\\Projects\\Shuvi Test.prproj";
const SHA="a".repeat(64),FNV="0123456789abcdef";
function step(id,tool,uuid,index,deps=[]){
 return {step_id:id,expected_tool:tool,depends_on:deps,status:"completed",
  running:null,evidence:[{step_id:id,tool,action_id:uuid,orchestration_step:index,
  fingerprint:"native:"+uuid,source:"typed_result",audit_event:"executed",
  outcome:"success",success:true}]};
}
function fixture(){
 const graph={objective:OWNER,revision:1,steps:[
  step("create_project","premiere_create_project",CREATE,1),
  step("open_project","premiere_open_project",OPEN,2,["create_project"])]};
 const schedule={version:1,objective:OWNER,revision:1,jobs:[
  {stepId:"create_project",tool:"premiere_create_project",actionId:CREATE,phase:"audited",dependsOn:[]},
  {stepId:"open_project",tool:"premiere_open_project",actionId:OPEN,phase:"audited",dependsOn:["create_project"]}]};
 const createProposal={tool:"premiere_create_project",task_step_id:"create_project",arguments:{path:PATH}};
 const createPayload={host:{
   operation:"create",hostAccepted:true,projectGuid:"project-guid-1",activeGuid:"project-guid-1",
   projectIdentityVerified:true,projectPath:PATH,activePath:PATH,
   initialSaveAccepted:true,verificationStatus:"verified_host_identity",
   persistenceVerified:false,reopenVerified:false,uncertain:false,retrySafe:false
  },project_evidence:{
   operation:"create",host_identity_verified:true,disk_persistence_verified:true,
   project_verified:true,disk_fingerprint:{path:PATH,size_bytes:8192,
    modified_ms:1700000000,fnv1a64:FNV},disk_error:null,
   edit_semantics_verified:false,reopen_verified:false,retry_safe:false
  },post_state_verified:true,retry_safe:false};
 const createResult={tool:"premiere_create_project",success:true,exit_code:0,
  stdout:JSON.stringify(createPayload)};
 const openProposal={tool:"premiere_open_project",task_step_id:"open_project",arguments:{path:PATH}};
 const openPayload={host:{
  operation:"open",hostAccepted:true,projectGuid:"project-guid-1",activeGuid:"project-guid-1",
  projectPath:PATH,activePath:PATH,projectIdentityVerified:true,uncertain:false,
  retrySafe:false,verificationStatus:"verified_host_identity",reopenVerified:false
 },project_evidence:{
  operation:"open",host_identity_verified:true,disk_unchanged_during_open:true,
  project_verified:true,disk_fingerprint:{path:PATH,size_bytes:8192,
   fnv1a64:FNV,modified_ms:1700000000},disk_error:null,
  edit_semantics_verified:false,retry_safe:false
 },post_state_verified:true,retry_safe:false};
 const openResult={tool:"premiere_open_project",success:true,exit_code:0,
  stdout:JSON.stringify(openPayload)};
 const rustFileProof={actionId:CREATE,projectPath:PATH,bytes:8192,
  sha256:SHA,fnv1a64:FNV,verifiedFileBytes:true,
  reopenVerified:false,originalGoalVerified:false};
 return {graph,schedule,createProposal,createPayload,createResult,openProposal,
  openPayload,openResult,rustFileProof};
}
function verifyChain(f){
 const created=inspectPremiereProjectCreateCandidate(OWNER,f.graph,f.createProposal,
  f.createResult,CREATE,TASK,true);
 if(!created)return null;
 const sha=bindNativePremiereShaProof(created,f.rustFileProof,TASK);
 if(!sha)return null;
 const reopen=inspectPremiereProjectReopenCandidate(TASK,created,sha,f.graph,
  f.openProposal,f.openResult,OPEN,true);
 if(!reopen)return null;
 const reopened=bindPremiereReopenShaAfterReadback(reopen,sha,TASK);
 if(!reopened)return null;
 return {created,sha,reopened};
}
test("REAL validators carry exact Task/UUID/path across simulated native create, SHA and approved reopen",()=>{
 const f=fixture(),verified=verifyChain(f);
 assert.ok(verified);
 assert.equal(verified.created.originalGoalVerified,false);
 assert.equal(verified.sha.fileBytesVerified,true);
 assert.equal(verified.reopened.projectReopenEvidenceVerified,true);
 assert.equal(verified.reopened.originalGoalVerified,false);
 // This is how current native delivery claims appear WITHOUT .prproj support.
 const claims=nativeTaskDeliveryClaims(f.graph,f.schedule);
 assert.ok(claims);
 assert.equal(claims.length,2);
 assert.equal(claims[0].artifact,null);
 const nativeDelivery={version:1,objective:OWNER,revision:1,recordedAtMs:9999,steps:claims};
 const current=assessPremiereProjectDeliveryContract(OWNER,f.graph,f.schedule,nativeDelivery,
  TASK,verified.created,verified.sha,verified.reopened);
 assert.equal(current.deliveryContractAligned,false);
 assert.equal(current.stage,"rust_project_delivery_missing");
 assert.equal(assessMasterFinalOutcome(OWNER,f.graph,f.schedule,nativeDelivery,null,TASK).verified,false);
 // ONLY a hypothetical designated Rust extension can provide this artifact.
 nativeDelivery.steps[0].artifact={kind:"premiere_project",path:PATH,sha256:SHA,bytes:8192};
 const future=assessPremiereProjectDeliveryContract(OWNER,f.graph,f.schedule,nativeDelivery,
  TASK,verified.created,verified.sha,verified.reopened);
 assert.equal(future.deliveryContractAligned,true);
 assert.equal(future.originalGoalVerified,false);
 assert.equal(future.windowsLiveVerified,false);
});
test("owner denial, unverified initial save and foreign project cannot establish create evidence",()=>{
 for(const change of [
  f=>f.createPayload.host.initialSaveAccepted=false,
  f=>f.createPayload.host.activeGuid="foreign",
  f=>f.createPayload.project_evidence.disk_persistence_verified=false,
  f=>f.createProposal.arguments.path="C:\\Other\\foreign.prproj"
 ]){
  const f=fixture();change(f);
  f.createResult.stdout=JSON.stringify(f.createPayload);
  assert.equal(verifyChain(f),null);
 }
 const f=fixture();
 assert.equal(inspectPremiereProjectCreateCandidate(OWNER,f.graph,f.createProposal,
  f.createResult,CREATE,TASK,false),null);
});
test("denied, unknown, changed GUID/bytes or nondependency reopen cannot pass real validators",()=>{
 for(const change of [
  f=>f.graph.steps[1].status="failed",
  f=>f.graph.steps[1].evidence[0].audit_event="denied",
  f=>f.graph.steps[1].depends_on=[],
  f=>f.openPayload.host.activeGuid="foreign-project",
  f=>f.openPayload.project_evidence.disk_fingerprint.fnv1a64="f".repeat(16),
  f=>f.openPayload.project_evidence.disk_unchanged_during_open=false
 ]){
  const f=fixture();change(f);
  f.openResult.stdout=JSON.stringify(f.openPayload);
  assert.equal(verifyChain(f),null);
 }
});
test("post-reopen independent SHA must match original created bytes; no automatic mutation retry",()=>{
 const f=fixture(),created=inspectPremiereProjectCreateCandidate(OWNER,
  f.graph,f.createProposal,f.createResult,CREATE,TASK,true);
 const sha=bindNativePremiereShaProof(created,f.rustFileProof,TASK);
 const reopen=inspectPremiereProjectReopenCandidate(TASK,created,sha,f.graph,
  f.openProposal,f.openResult,OPEN,true);
 assert.ok(reopen);
 const changed=bindNativePremiereShaProof(created,
  {...f.rustFileProof,sha256:"f".repeat(64)},TASK);
 assert.ok(changed);
 assert.equal(bindPremiereReopenShaAfterReadback(reopen,changed,TASK),null);
 assert.equal(bindPremiereReopenShaAfterReadback(reopen,sha,
  "6edb58c0-13b4-49d3-9463-56e255ba8c84"),null);
 assert.equal(reopen.originalGoalVerified,false);
});
