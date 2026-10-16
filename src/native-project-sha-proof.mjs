// Shuvi 37 — validate separately computed *Rust* SHA-256 file bytes
// against an already accepted Team 40 host/FNV creation candidate.
// This file proof is NOT native project reopen, edit or export acceptance.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const FNV=/^[0-9a-f]{16}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

export function bindNativePremiereShaProof(candidate,native,activeTaskId){
 if(!obj(candidate)||candidate.taskId!==activeTaskId||!UUID.test(activeTaskId)||
    !UUID.test(candidate.actionId)||
    !obj(native)||native.actionId!==candidate.actionId||
    native.projectPath!==candidate.projectPath||
    native.bytes!==candidate.sizeBytes||
    native.fnv1a64!==candidate.fnv1a64||
    !FNV.test(native.fnv1a64)||!HASH.test(native.sha256)||
    native.verifiedFileBytes!==true||
    native.reopenVerified!==false||native.originalGoalVerified!==false||
    candidate.sha256Attested!==false||
    candidate.reopenVerified!==false||candidate.originalGoalVerified!==false||
    candidate.hostIdentityObserved!==true||candidate.diskBytesObserved!==true)
  return null;
 return Object.freeze({
  taskId:activeTaskId,actionId:candidate.actionId,
  projectGuid:candidate.projectGuid,projectPath:candidate.projectPath,
  bytes:native.bytes,fnv1a64:native.fnv1a64,sha256:native.sha256,
  hashAlgorithm:"sha256",fileBytesVerified:true,
  projectReopenVerified:false,originalGoalVerified:false
 });
}
export function nativePremiereShaProgress(proof,activeTaskId){
 if(!obj(proof)||proof.taskId!==activeTaskId||!UUID.test(activeTaskId)||
   !UUID.test(proof.actionId)||proof.hashAlgorithm!=="sha256"||
   proof.fileBytesVerified!==true||
   proof.projectReopenVerified!==false||
   proof.originalGoalVerified!==false||
   !HASH.test(proof.sha256)||!FNV.test(proof.fnv1a64))
  return "Independent project file SHA-256 attestation unavailable.";
 return "Native Rust SHA-256 readback MATCHED the approved Premiere project file "+
  "("+proof.bytes+" bytes), project GUID recorded. "+
  "File bytes are verified at inspection time only; a separately reopened "+
  "Adobe project and complete native task delivery are NOT verified. "+
  "ORIGINAL PROJECT GOAL UNVERIFIED.";
}
