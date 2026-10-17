import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectPremiereProjectCreateCandidate,projectCandidateStatus}
 from "../src/premiere-project-evidence-candidate.mjs";
import {assessMasterFinalOutcome} from "../src/master-final-outcome.mjs";

const OWNER="Premiere me naya project banao";
const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const PATH="C:\\Projects\\Shuvi Test.prproj";
const PROPOSAL={tool:"premiere_create_project",arguments:{path:PATH},task_step_id:"create_project"};
const graph=()=>({objective:OWNER,revision:1,steps:[{
 step_id:"create_project",expected_tool:"premiere_create_project",
 depends_on:[],status:"completed",running:null,evidence:[{
  step_id:"create_project",tool:"premiere_create_project",
  action_id:ACTION,orchestration_step:1,fingerprint:"native-action-uuid",
  source:"typed_result",audit_event:"executed",outcome:"success",success:true
 }]}]});
const payload=()=>({
 host:{
  operation:"create",hostAccepted:true,projectGuid:"project-guid-1",
  activeGuid:"project-guid-1",projectIdentityVerified:true,
  projectPath:PATH,activePath:PATH,
  initialSaveAccepted:true,verificationStatus:"verified_host_identity",
  persistenceVerified:false,reopenVerified:false,uncertain:false,retrySafe:false
 },
 project_evidence:{
  operation:"create",host_identity_verified:true,
  disk_persistence_verified:true,project_verified:true,
  disk_fingerprint:{path:PATH,size_bytes:8192,modified_ms:1700000000,fnv1a64:"0123456789abcdef"},
  disk_error:null,edit_semantics_verified:false,reopen_verified:false,retry_safe:false
 },
 post_state_verified:true,retry_safe:false
});
const result=(data=payload())=>({
 tool:"premiere_create_project",success:true,exit_code:0,stderr:"",stdout:JSON.stringify(data)
});
const evaluate=(g=graph(),p=PROPOSAL,r=result(),owner=OWNER,actionId=ACTION,taskId=TASK,audited=true)=>
 inspectPremiereProjectCreateCandidate(owner,g,p,r,actionId,taskId,audited);

test("real Team 40 host/Rust payload is accepted as candidate only, not an original task completion",()=>{
 const candidate=evaluate();
 assert.ok(candidate);
 assert.equal(candidate.taskId,TASK);
 assert.equal(candidate.actionId,ACTION);
 assert.equal(candidate.projectPath,PATH);
 assert.equal(candidate.projectGuid,"project-guid-1");
 assert.equal(candidate.sizeBytes,8192);
 assert.equal(candidate.fingerprintAlgorithm,"fnv1a64_noncryptographic_change_detector");
 assert.equal(candidate.fnv1a64,"0123456789abcdef");
 assert.equal(candidate.sha256Attested,false);
 assert.equal(candidate.reopenVerified,false);
 assert.equal(candidate.originalGoalVerified,false);
 assert.match(projectCandidateStatus(candidate,TASK),/No Rust SHA-256 delivery attestation/);
 assert.match(projectCandidateStatus(candidate,TASK),/ORIGINAL PROJECT GOAL UNVERIFIED/);
 assert.equal(assessMasterFinalOutcome(OWNER,graph(),null,null,null,TASK).verified,false);
 assert.equal(projectCandidateStatus(candidate,"0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172"),
  "No task-bound Premiere project creation proof candidate.");
});

test("project creation only: editing/export, foreign application or missing task name does not inherit proof",()=>{
 for(const owner of ["Premiere kholo","Blender me naya project banao",
  "Open After Effects and create a project","Open Photoshop",
  "Build a website","Create a document"])
  assert.equal(evaluate(graph(),PROPOSAL,result(),owner),null,owner);
});
test("native action must carry an exact, separately audited same-graph UUID",()=>{
 const base=graph();
 for(const mutate of [
  g=>g.steps[0].status="running",
  g=>g.steps[0].evidence=[],
  g=>g.steps[0].evidence[0].success=false,
  g=>g.steps[0].evidence[0].audit_event="failed",
  g=>g.steps[0].evidence[0].action_id="not-uuid",
  g=>g.steps[0].evidence[0].tool="premiere_open_project",
  g=>g.steps[0].evidence[0].source="model_claim",
  g=>g.steps[0].evidence.push({...g.steps[0].evidence[0]})
 ]){
  const g=structuredClone(base);mutate(g);
  assert.equal(evaluate(g),null);
 }
 assert.equal(evaluate(graph(),PROPOSAL,result(),OWNER,ACTION,TASK,false),null);
 assert.equal(evaluate(graph(),PROPOSAL,result(),OWNER,"not-a-uuid",TASK,true),null);
 assert.equal(evaluate(graph(),PROPOSAL,result(),OWNER,
   "0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172",TASK,true),null);
 assert.equal(evaluate(graph(),PROPOSAL,result(),ACTION,"fake-task",true),null);
 assert.equal(evaluate(graph(),{...PROPOSAL,task_step_id:"other"},result()),null);
});
test("cannot reinterpret a failed, wrong-tool or unverified native response as project creation",()=>{
 const good=result();
 for(const override of [
  {success:false},{exit_code:1},{tool:"premiere_open_project"},
  {stdout:"not json"},{stdout:"X".repeat(32769)}
 ])assert.equal(evaluate(graph(),PROPOSAL,{...good,...override}),null);
});
test("host identity, actual initial save and paths must agree with owner-approved destination",()=>{
 for(const mutate of [
  p=>p.host.projectIdentityVerified=false,
  p=>p.host.hostAccepted=false,
  p=>p.host.initialSaveAccepted=false,
  p=>p.host.activeGuid="different-guid",
  p=>p.host.projectGuid="",
  p=>p.host.projectPath="C:\\Other\\wrong.prproj",
  p=>p.host.activePath="C:\\Other\\wrong.prproj",
  p=>p.host.uncertain=true,
  p=>p.host.retrySafe=true,
  p=>p.host.verificationStatus="accepted_unverified",
  p=>p.host.persistenceVerified=true,
  p=>p.host.reopenVerified=true,
  p=>p.post_state_verified=false,
  p=>p.retry_safe=true,
  p=>p.project_evidence.operation="open",
  p=>p.project_evidence.host_identity_verified=false,
  p=>p.project_evidence.disk_persistence_verified=false,
  p=>p.project_evidence.project_verified=false,
  p=>p.project_evidence.disk_error="failed to save",
  p=>p.project_evidence.reopen_verified=true,
  p=>p.project_evidence.edit_semantics_verified=true
 ]){
  const obj=payload();mutate(obj);
  assert.equal(evaluate(graph(),PROPOSAL,result(obj)),null);
 }
});
test("path, fingerprint and native bytes cannot be forged, weak FNV never promoted to SHA-256",()=>{
 for(const mutate of [
  p=>p.project_evidence.disk_fingerprint.path="C:\\Other\\changed.prproj",
  p=>p.project_evidence.disk_fingerprint.size_bytes=0,
  p=>p.project_evidence.disk_fingerprint.size_bytes=300*1024*1024,
  p=>p.project_evidence.disk_fingerprint.fnv1a64="0".repeat(64),
  p=>p.project_evidence.disk_fingerprint.fnv1a64="X".repeat(16),
  p=>p.project_evidence.disk_fingerprint.modified_ms=-1,
  p=>p.project_evidence.disk_fingerprint=null
 ]){
  const x=payload();mutate(x);
  assert.equal(evaluate(graph(),PROPOSAL,result(x)),null);
 }
 for(const path of [
  "../file.prproj","./file.prproj","C:\\Projects\\..\\user.prproj",
  "C:\\Projects\\A.mp4","C:\\Projects\\evil.prproj\n","C:\\Projects\\evil.prproj "
 ]){
  const p={...PROPOSAL,arguments:{path}};
  assert.equal(evaluate(graph(),p),null);
 }
});
test("only task-local volatile native result is captured; final gate stays fail-closed",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(src,/projectCreationEvidence:PremiereProjectEvidenceCandidate\|null=null/);
 assert.match(src,/function rotatePermissionScope\(\):void\{[\s\S]{0,170}projectCreationEvidence=null/);
 assert.match(src,/proposal.tool==="premiere_create_project"&&result.success&&receiptMatches/);
 assert.match(src,/activePermissionScope.taskId===permissionTaskId/);
 assert.match(src,/projectCreationEvidence=inspectPremiereProjectCreateCandidate/);
 assert.match(src,/projectCandidateStatus\(projectCreationEvidence,activePermissionScope.taskId\)/);
 assert.match(src,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
 const checkpoint=src.slice(src.indexOf("function currentCheckpoint(): SessionCheckpoint"),
  src.indexOf("function nativeWorkerDisplay(): string"));
 assert.doesNotMatch(checkpoint,/projectCreationEvidence/);
});

test("a forged candidate object cannot be used to advertise successful project evidence",()=>{
 const real=evaluate();assert.ok(real);
 for(const changes of [
  {sha256Attested:true},{originalGoalVerified:true},{reopenVerified:true},
  {hostIdentityObserved:false},{diskBytesObserved:false},
  {sizeBytes:0},{projectPath:"..\\other.prproj"},
  {actionId:"not-native"},{fingerprintAlgorithm:"sha256"},
  {fnv1a64:"a".repeat(64)}
 ]){
  assert.equal(projectCandidateStatus({...real,...changes},TASK),
   "No task-bound Premiere project creation proof candidate.");
 }
});
