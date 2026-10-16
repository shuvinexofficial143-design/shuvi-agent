import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bindNativePremiereShaProof,nativePremiereShaProgress}
 from "../src/native-project-sha-proof.mjs";

const TASK="a64df912-9eb2-4d42-a46d-898327992516";
const ACTION="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const PATH="C:\\Projects\\Shuvi Test.prproj";
const candidate=()=>({
 taskId:TASK,actionId:ACTION,stepId:"create_project",projectGuid:"host-guid",
 projectPath:PATH,sizeBytes:8192,fnv1a64:"0123456789abcdef",
 fingerprintAlgorithm:"fnv1a64_noncryptographic_change_detector",
 hostIdentityObserved:true,diskBytesObserved:true,
 sha256Attested:false,reopenVerified:false,originalGoalVerified:false
});
const native=()=>({
 actionId:ACTION,projectPath:PATH,bytes:8192,sha256:"a".repeat(64),
 fnv1a64:"0123456789abcdef",verifiedFileBytes:true,
 reopenVerified:false,originalGoalVerified:false
});

test("independent SHA-256 is bound to the same approved project path, bytes, FNV and UUID",()=>{
 const result=bindNativePremiereShaProof(candidate(),native(),TASK);
 assert.ok(result);
 assert.equal(result.sha256,"a".repeat(64));
 assert.equal(result.projectPath,PATH);
 assert.equal(result.hashAlgorithm,"sha256");
 assert.equal(result.projectReopenVerified,false);
 assert.equal(result.originalGoalVerified,false);
 assert.match(nativePremiereShaProgress(result,TASK),/ORIGINAL PROJECT GOAL UNVERIFIED/);
 assert.match(nativePremiereShaProgress(result,TASK),/separately reopened/);
});
test("cannot associate a project SHA proof with another task or foreign action",()=>{
 assert.equal(bindNativePremiereShaProof(candidate(),native(),
  "0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172"),null);
 assert.equal(bindNativePremiereShaProof(candidate(),
  {...native(),actionId:"0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172"},TASK),null);
 assert.match(nativePremiereShaProgress(
  bindNativePremiereShaProof(candidate(),native(),TASK),
  "0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172"),/unavailable/);
});
test("reject spoofed disk bytes or FNV, fabricated SHA, or nonnative file proof",()=>{
 for(const mutate of [
  r=>{r.projectPath="C:\\Other\\Fake.prproj";},
  r=>{r.bytes=8193;},r=>{r.fnv1a64="f".repeat(16);},
  r=>{r.sha256="f".repeat(16);},r=>{r.sha256="x".repeat(64);},
  r=>{r.verifiedFileBytes=false;},
  r=>{r.reopenVerified=true;},r=>{r.originalGoalVerified=true;}
 ]){
  const r=native();mutate(r);
  assert.equal(bindNativePremiereShaProof(candidate(),r,TASK),null);
 }
});
test("a source candidate that prematurely claims SHA, reopen or goal success is never trusted",()=>{
 for(const key of ["sha256Attested","reopenVerified","originalGoalVerified"]){
  const c=candidate();c[key]=true;
  assert.equal(bindNativePremiereShaProof(c,native(),TASK),null,key);
 }
 for(const key of ["hostIdentityObserved","diskBytesObserved"]){
  const c=candidate();c[key]=false;
  assert.equal(bindNativePremiereShaProof(c,native(),TASK),null,key);
 }
});
test("Rust file attestation requires successful exact high-risk audited create, not arbitrary file hash",()=>{
 const nativeRust=readFileSync(new URL("../src-tauri/src/native_premiere_project_sha.rs",import.meta.url),"utf8");
 const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.match(nativeRust,/fn confirmed_create_audit\(/);
 assert.match(nativeRust,/tool!="premiere_create_project"\|\|event!="executed"\|\|!success/);
 assert.match(nativeRust,/if detail!=expected/);
 assert.match(nativeRust,/read_action_audit_receipt\(app,action_id\)/);
 assert.match(nativeRust,/native_scheduler::verified_status\(app\)/);
 assert.match(nativeRust,/j.phase=="audited"/);
 assert.match(nativeRust,/sha\.update\(&buffer\[\.\.n\]\)/);
 assert.match(nativeRust,/fnv=fnv\.wrapping_mul/);
 assert.match(nativeRust,/if bytes!=expected_size_bytes\|\|fnv1a64!=expected_fnv1a64/);
 assert.match(nativeRust,/sha256,fnv1a64/);
 assert.match(nativeRust,/reopen_verified:false,original_goal_verified:false/);
 assert.match(lib,/mod native_premiere_project_sha;/);
 const ipc=lib.indexOf("fn verify_premiere_project_sha256(");
 const lease=lib.indexOf("claim_monitored_native_execution(state.inner(),&app)",ipc);
 const invoke=lib.indexOf("native_premiere_project_sha::verify(",lease);
 assert.ok(ipc>=0&&lease>ipc&&invoke>lease);
 assert.match(lib,/verify_premiere_project_sha256,\s*finalize_native_task_delivery/);
});
test("Desktop SHA proof is only requested after native result and audit, with task freshness checks",()=>{
 const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const start=src.indexOf('if(proposal.tool==="premiere_create_project"&&result.success&&receiptMatches');
 const inspect=src.indexOf("projectCreationEvidence=inspectPremiereProjectCreateCandidate",start);
 const invoke=src.indexOf('"verify_premiere_project_sha256"',inspect);
 const guarded=src.indexOf("activePermissionScope.taskId===permissionTaskId",invoke);
 const bound=src.indexOf("projectShaFileProof=bindNativePremiereShaProof(",guarded);
 assert.ok(start>=0&&inspect>start&&invoke>inspect&&guarded>invoke&&bound>guarded);
 assert.match(src,/projectShaFileProof:BoundPremiereProjectShaProof\|null=null/);
 assert.match(src,/projectShaFileProof=null;\s*projectReopenEvidence=null;\s*revokeTaskScope\(activePermissionScope\)/);
 assert.match(src,/catch\{\s*\/\/ A failed verification/);
 assert.match(src,/projectShaFileProof[\s\S]{0,150}nativePremiereShaProgress/);
 assert.match(src,/await stopAgentForSafety\(summarizeMasterMissingProof\(finalOutcome\)\)/);
});
