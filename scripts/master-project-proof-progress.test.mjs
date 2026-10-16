import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPremiereProjectProofProgress}
 from "../src/master-project-proof-progress.mjs";

const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const CREATE="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const OPEN="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const path="C:\\Projects\\Shuvi Test.prproj";
const created=()=>({
 taskId:TASK,actionId:CREATE,projectGuid:"project-guid-1",
 projectPath:path,sizeBytes:8192,fnv1a64:"0123456789abcdef",
 hostIdentityObserved:true,diskBytesObserved:true,sha256Attested:false,
 reopenVerified:false,originalGoalVerified:false
});
const sha=()=>({
 taskId:TASK,actionId:CREATE,projectGuid:"project-guid-1",
 projectPath:path,bytes:8192,fnv1a64:"0123456789abcdef",
 sha256:"a".repeat(64),hashAlgorithm:"sha256",
 fileBytesVerified:true,projectReopenVerified:false,originalGoalVerified:false
});
const reopen=()=>({
 taskId:TASK,createActionId:CREATE,reopenActionId:OPEN,
 projectGuid:"project-guid-1",projectPath:path,
 sha256BeforeReopen:"a".repeat(64),
 hostProjectReopenObserved:true,diskFingerprintUnchanged:true,
 fileBytesVerifiedBeforeReopen:true,sha256AfterReopenVerified:true,
 projectReopenEvidenceVerified:true,originalGoalVerified:false
});
const result=(c=created(),h=sha(),o=reopen(),id=TASK)=>
 assessPremiereProjectProofProgress(id,c,h,o);

test("Premiere project milestones progress only as independent evidence arrives",()=>{
 const empty=result(null,null,null);
 assert.equal(empty.stage,"unverified");
 assert.equal(empty.verifiedStages,0);
 assert.equal(empty.originalGoalVerified,false);
 const one=result(created(),null,null);
 assert.equal(one.stage,"create_audited");
 assert.equal(one.verifiedStages,1);
 const two=result(created(),sha(),null);
 assert.equal(two.stage,"file_sha256_verified");
 assert.equal(two.verifiedStages,2);
 const three=result();
 assert.equal(three.stage,"reopen_audited");
 assert.equal(three.verifiedStages,3);
 assert.match(three.remaining,/original creative goal remains UNVERIFIED/);
 assert.equal(three.originalGoalVerified,false);
});

test("missing, foreign or ambiguous owner task loses all project proof",()=>{
 assert.equal(result(created(),sha(),reopen(),OPEN).stage,"unverified");
 assert.equal(result({...created(),taskId:OPEN},sha(),reopen()).stage,"unverified");
 assert.equal(result({...created(),originalGoalVerified:true},sha(),reopen()).stage,"unverified");
 assert.equal(result({...created(),sha256Attested:true},sha(),reopen()).stage,"unverified");
 assert.equal(result({...created(),projectPath:"C:\\Wrong\\project.mp4"},sha(),reopen()).stage,"unverified");
 assert.equal(result({...created(),actionId:"bad-uuid"},sha(),reopen()).stage,"unverified");
});

test("forged SHA cannot upgrade a verified create stage",()=>{
 for(const override of [
  {actionId:OPEN},{taskId:OPEN},{bytes:100},{fnv1a64:"f".repeat(16)},
  {sha256:"x".repeat(64)},{sha256:"a".repeat(16)},
  {hashAlgorithm:"fnv1a64"},{fileBytesVerified:false},
  {projectReopenVerified:true},{originalGoalVerified:true},
  {projectPath:"C:\\Wrong\\changed.prproj"},
  {projectGuid:"foreign-project"}
 ]){
  assert.equal(result(created(),{...sha(),...override},reopen()).stage,"create_audited");
 }
});

test("even matching create+SHA cannot accept another project's reopen",()=>{
 for(const override of [
  {taskId:OPEN},{createActionId:OPEN},{reopenActionId:CREATE},
  {projectPath:"C:\\Wrong\\changed.prproj"},
  {projectGuid:"not-ours"},{sha256BeforeReopen:"f".repeat(64)},
  {hostProjectReopenObserved:false},{diskFingerprintUnchanged:false},
  {fileBytesVerifiedBeforeReopen:false},
  {sha256AfterReopenVerified:false},
  {projectReopenEvidenceVerified:false},{originalGoalVerified:true}
 ]){
  assert.equal(result(created(),sha(),{...reopen(),...override}).stage,"file_sha256_verified");
 }
});

test("Desktop proof UI only presents text and never becomes a permission or task-completion shortcut",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(src,/id="premiereProjectProofStatus"/);
 assert.match(src,/function renderPremiereProjectProofProgress\(\):void/);
 assert.match(src,/target\.textContent=progress\.label\+"\. "\+progress\.remaining/);
 assert.doesNotMatch(src,/target\.innerHTML=progress/);
 assert.match(src,/renderPremiereProjectProofProgress\(\);\s*executingActionId = actionId/);
 assert.match(src,/projectShaFileProof=null;\s*projectReopenEvidence=null;\s*renderPremiereProjectProofProgress\(\)/);
 assert.match(src,/if\(!projectCreationEvidence\|\|!projectShaFileProof\|\|[\s\S]{0,110}proposal\.arguments\.path!==projectCreationEvidence\.projectPath\)/);
 assert.match(src,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
 assert.doesNotMatch(src,/if\(projectReopenEvidence\?.sha256AfterReopenVerified===true\)\s*return success/);
});
