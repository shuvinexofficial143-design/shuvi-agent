import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectPremiereProjectReopenCandidate,bindPremiereReopenShaAfterReadback}
 from "../src/premiere-project-reopen-evidence.mjs";

const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const CREATE="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OPEN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const PATH="C:\\Projects\\Shuvi Test.prproj";
const created=()=>({
 taskId:TASK,actionId:CREATE,stepId:"create_project",
 projectGuid:"project-guid-1",projectPath:PATH,sizeBytes:8192,
 fnv1a64:"0123456789abcdef",sha256Attested:false,
 reopenVerified:false,originalGoalVerified:false,
 hostIdentityObserved:true,diskBytesObserved:true
});
const sha=()=>({
 taskId:TASK,actionId:CREATE,hashAlgorithm:"sha256",
 projectPath:PATH,bytes:8192,fnv1a64:"0123456789abcdef",
 sha256:"a".repeat(64),fileBytesVerified:true,
 projectReopenVerified:false,originalGoalVerified:false
});
const step=(id,tool,action,n,deps=[])=>({
 step_id:id,expected_tool:tool,depends_on:deps,status:"completed",
 evidence:[{step_id:id,tool,action_id:action,orchestration_step:n,
  fingerprint:"native:"+action,audit_event:"executed",outcome:"success",
  source:"typed_result",success:true}]
});
const graph=()=>({objective:"Premiere me naya project banao",revision:1,steps:[
 step("create_project","premiere_create_project",CREATE,1),
 step("open_project","premiere_open_project",OPEN,2,["create_project"])
]});
const proposal={tool:"premiere_open_project",arguments:{path:PATH},task_step_id:"open_project"};
const payload=()=>({
 host:{
  operation:"open",hostAccepted:true,projectGuid:"project-guid-1",
  activeGuid:"project-guid-1",projectPath:PATH,activePath:PATH,
  projectIdentityVerified:true,uncertain:false,retrySafe:false,
  verificationStatus:"verified_host_identity",reopenVerified:false
 },
 project_evidence:{
  operation:"open",host_identity_verified:true,
  disk_unchanged_during_open:true,project_verified:true,
  disk_fingerprint:{path:PATH,size_bytes:8192,
    fnv1a64:"0123456789abcdef",modified_ms:1700000000},
  disk_error:null,edit_semantics_verified:false,retry_safe:false
 },
 post_state_verified:true,retry_safe:false
});
const result=(p=payload())=>({success:true,tool:"premiere_open_project",
 exit_code:0,stdout:JSON.stringify(p)});
const inspect=(g=graph(),p=proposal,r=result(),c=created(),h=sha(),id=OPEN,taskId=TASK,audit=true)=>
 inspectPremiereProjectReopenCandidate(taskId,c,h,g,p,r,id,audit);

test("Team40 separately approved open must verify exact host GUID and unchanged prior disk bytes",()=>{
 const accepted=inspect();
 assert.ok(accepted);
 assert.equal(accepted.createActionId,CREATE);
 assert.equal(accepted.reopenActionId,OPEN);
 assert.equal(accepted.projectPath,PATH);
 assert.equal(accepted.hostProjectReopenObserved,true);
 assert.equal(accepted.sha256AfterReopenVerified,false);
 assert.equal(accepted.originalGoalVerified,false);
 const reread=bindPremiereReopenShaAfterReadback(accepted,sha(),TASK);
 assert.equal(reread.projectReopenEvidenceVerified,true);
 assert.equal(reread.sha256AfterReopenVerified,true);
 assert.equal(reread.originalGoalVerified,false,"reopen+hash cannot finish an arbitrary creative goal");
});
test("earlier creation and reopen must have distinct, increasing executed Rust actions",()=>{
 const edits=[
  g=>g.steps[1].depends_on=[],
  g=>g.steps[1].evidence[0].action_id=CREATE,
  g=>g.steps[1].evidence[0].orchestration_step=1,
  g=>g.steps[1].evidence[0].source="model_claim",
  g=>g.steps[0].evidence[0].audit_event="denied",
  g=>g.steps[1].status="running",
  g=>g.steps[0].evidence=[],
  g=>g.steps[0].evidence[0].success=false
 ];
 for(const change of edits){
  const g=graph();
  try{change(g);}catch{continue;}
  assert.equal(inspect(g),null);
 }
 assert.equal(inspect(graph(),proposal,result(),created(),sha(),CREATE),null);
 assert.equal(inspect(graph(),proposal,result(),created(),sha(),OPEN,TASK,false),null);
});
test("changed host GUID, path, native disk fingerprint or operation is not project reopen evidence",()=>{
 const edits=[
  p=>p.host.activeGuid="another-project",
  p=>p.host.projectGuid="another-project",
  p=>p.host.projectPath="C:\\Else\\other.prproj",
  p=>p.host.activePath="C:\\Else\\other.prproj",
  p=>p.host.operation="create",
  p=>p.host.projectIdentityVerified=false,
  p=>p.host.uncertain=true,
  p=>p.host.hostAccepted=false,
  p=>p.host.retrySafe=true,
  p=>p.project_evidence.operation="create",
  p=>p.project_evidence.project_verified=false,
  p=>p.project_evidence.disk_unchanged_during_open=false,
  p=>p.project_evidence.disk_fingerprint.fnv1a64="f".repeat(16),
  p=>p.project_evidence.disk_fingerprint.size_bytes=100,
  p=>p.project_evidence.disk_error="changed file",
  p=>p.post_state_verified=false
 ];
 for(const edit of edits){
  const p=payload();edit(p);
  assert.equal(inspect(graph(),proposal,result(p)),null);
 }
});
test("wrong native action, path, failed tool, task identity and SHA proof are denied",()=>{
 assert.equal(inspect(graph(),{...proposal,arguments:{path:"C:\\Other\\fake.prproj"}}),null);
 assert.equal(inspect(graph(),proposal,{...result(),success:false}),null);
 assert.equal(inspect(graph(),proposal,{...result(),tool:"premiere_create_project"}),null);
 assert.equal(inspect(graph(),proposal,{...result(),stdout:"invalid JSON"}),null);
 assert.equal(inspect(graph(),proposal,result(),{...created(),taskId:OPEN}),null);
 assert.equal(inspect(graph(),proposal,result(),created(),{...sha(),sha256:"fake"}),null);
 assert.equal(inspect(graph(),proposal,result(),created(),sha(),OPEN,CREATE),null);
});
test("post-reopen cryptographic read must match prior SHA and SAME original create UUID",()=>{
 const prior=inspect();assert.ok(prior);
 for(const changes of [
  {sha256:"f".repeat(64)},
  {actionId:OPEN},
  {taskId:OPEN},
  {projectPath:"C:\\Other\\wrong.prproj"},
  {fileBytesVerified:false},
  {projectReopenVerified:true},
  {originalGoalVerified:true}
 ]){
  assert.equal(bindPremiereReopenShaAfterReadback(prior,{...sha(),...changes},TASK),null);
 }
 assert.equal(bindPremiereReopenShaAfterReadback(prior,sha(),OPEN),null);
});
test("Desktop does not auto-open and only calls read-only Rust SHA after exact audited open",()=>{
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const begin=ui.indexOf('if(proposal.tool==="premiere_open_project"&&result.success&&receiptMatches');
 const check=ui.indexOf("inspectPremiereProjectReopenCandidate(",begin);
 const shaCall=ui.indexOf('"verify_premiere_project_sha256"',check);
 const bind=ui.indexOf("bindPremiereReopenShaAfterReadback(",shaCall);
 assert.ok(begin>=0&&check>begin&&shaCall>check&&bind>shaCall);
 assert.match(ui,/projectReopenEvidence=null;\s*\}else if\(proposal.tool==="premiere_create_project"/);
 assert.match(ui,/projectCreationEvidence===candidate&&\s*projectShaFileProof===originalSha/);
 assert.match(ui,/Final native delivery remains UNVERIFIED/);
 assert.match(ui,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
});
