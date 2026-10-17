// Shuvi37 — task-local, evidence-only Premiere project progress.
// A progress stage is NOT a completed original-goal or creative acceptance.
// This never authorizes native actions, untrusted model output or disk access.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const HEX16=/^[0-9a-f]{16}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

export function assessPremiereProjectProofProgress(taskId,created,sha,reopened){
 const empty={
  stage:"unverified",verifiedStages:0,
  label:"Premiere project proof: no task-bound creation evidence",
  remaining:"Requires a successful owner-approved project create, Rust SHA-256 file readback, separate owner-approved project reopen, and final Rust task delivery.",
  originalGoalVerified:false
 };
 if(!UUID.test(taskId)||!obj(created)||created.taskId!==taskId||
    !UUID.test(created.actionId)||typeof created.projectGuid!=="string"||
    !created.projectGuid||typeof created.projectPath!=="string"||
    !created.projectPath.toLowerCase().endsWith(".prproj")||
    !Number.isSafeInteger(created.sizeBytes)||created.sizeBytes<=0||
    !HEX16.test(created.fnv1a64)||
    created.hostIdentityObserved!==true||created.diskBytesObserved!==true||
    created.sha256Attested!==false||created.reopenVerified!==false||
    created.originalGoalVerified!==false)return empty;
 const createdStage={
  stage:"create_audited",verifiedStages:1,
  label:"Premiere project proof: audited Adobe create + disk FNV observed",
  remaining:"Independent Rust SHA-256 and separate approved reopen are not yet verified. Final goal unverified.",
  originalGoalVerified:false
 };
 if(!obj(sha)||sha.taskId!==taskId||
    sha.actionId!==created.actionId||sha.projectGuid!==created.projectGuid||
    sha.projectPath!==created.projectPath||
    sha.bytes!==created.sizeBytes||sha.fnv1a64!==created.fnv1a64||
    !HEX64.test(sha.sha256)||sha.hashAlgorithm!=="sha256"||
    sha.fileBytesVerified!==true||sha.projectReopenVerified!==false||
    sha.originalGoalVerified!==false)return createdStage;
 const shaStage={
  stage:"file_sha256_verified",verifiedStages:2,
  label:"Premiere project proof: audited create + independent file SHA-256",
  remaining:"Separately approved Adobe project reopen and independent post-reopen SHA-256 still required. Final goal unverified.",
  originalGoalVerified:false
 };
 if(!obj(reopened)||reopened.taskId!==taskId||
    reopened.createActionId!==created.actionId||
    !UUID.test(reopened.reopenActionId)||
    reopened.reopenActionId===created.actionId||
    reopened.projectGuid!==created.projectGuid||
    reopened.projectPath!==created.projectPath||
    reopened.sha256BeforeReopen!==sha.sha256||
    reopened.hostProjectReopenObserved!==true||
    reopened.diskFingerprintUnchanged!==true||
    reopened.fileBytesVerifiedBeforeReopen!==true||
    reopened.sha256AfterReopenVerified!==true||
    reopened.projectReopenEvidenceVerified!==true||
    reopened.originalGoalVerified!==false)return shaStage;
 return {
  stage:"reopen_audited",verifiedStages:3,
  label:"Premiere project proof: creation, SHA-256 and separately audited reopen observed",
  remaining:"Native final delivery and Windows Adobe acceptance are not verified. The original creative goal remains UNVERIFIED.",
  originalGoalVerified:false
 };
}
