// Shuvi37: a SEPARATELY owner-approved open + independent Rust action audit
// may corroborate an earlier create and SHA-256 project-file observation.
// This is an observation, NOT permission to open, save, overwrite or retry.
// Creative goal stays UNVERIFIED pending final Rust task delivery.
import {evidenceForStep} from "./master-worker-queue.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const FNV=/^[0-9a-f]{16}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const samePath=(a,b)=>typeof a==="string"&&typeof b==="string"&&
 a.replaceAll("/","\\").toLowerCase()===b.replaceAll("/","\\").toLowerCase();

export function inspectPremiereProjectReopenCandidate(
 originalTaskId,created,shaProof,graph,proposal,result,actionId,audited
){
 if(!UUID.test(originalTaskId)||!obj(created)||!obj(shaProof)||
    created.taskId!==originalTaskId||shaProof.taskId!==originalTaskId||
    !UUID.test(created.actionId)||shaProof.actionId!==created.actionId||
    !HASH.test(shaProof.sha256)||shaProof.hashAlgorithm!=="sha256"||
    shaProof.fileBytesVerified!==true||
    shaProof.projectReopenVerified!==false||
    shaProof.originalGoalVerified!==false||
    !samePath(shaProof.projectPath,created.projectPath)||
    shaProof.fnv1a64!==created.fnv1a64||
    shaProof.bytes!==created.sizeBytes||
    !obj(graph)||!Array.isArray(graph.steps)||!obj(proposal)||
    proposal.tool!=="premiere_open_project"||
    !obj(proposal.arguments)||
    !samePath(proposal.arguments.path,created.projectPath)||
    !UUID.test(actionId)||actionId===created.actionId||
    audited!==true||!obj(result)||result.tool!=="premiere_open_project"||
    result.success!==true||result.exit_code!==0||
    typeof result.stdout!=="string"||result.stdout.length>32768)return null;
 const step=graph.steps.find(s=>s.step_id===proposal.task_step_id);
 const openReceipt=evidenceForStep(step);
 const createStep=graph.steps.find(s=>s.step_id===created.stepId);
 const createReceipt=evidenceForStep(createStep);
 if(!openReceipt||!createReceipt||step.expected_tool!=="premiere_open_project"||
    openReceipt.action_id!==actionId||openReceipt.tool!==result.tool||
    createReceipt.action_id!==created.actionId||
    createReceipt.tool!=="premiere_create_project"||
    !Number.isSafeInteger(openReceipt.orchestration_step)||
    openReceipt.orchestration_step<=createReceipt.orchestration_step||
    !step.depends_on?.includes(createStep.step_id))return null;
 let payload;
 try{payload=JSON.parse(result.stdout);}catch{return null;}
 if(!obj(payload)||payload.post_state_verified!==true||
    payload.retry_safe!==false||!obj(payload.host)||
    !obj(payload.project_evidence))return null;
 const h=payload.host,p=payload.project_evidence,d=p.disk_fingerprint;
 if(h.operation!=="open"||h.hostAccepted!==true||
    h.projectIdentityVerified!==true||h.uncertain!==false||
    h.retrySafe!==false||h.verificationStatus!=="verified_host_identity"||
    h.projectGuid!==created.projectGuid||h.activeGuid!==created.projectGuid||
    !samePath(h.projectPath,created.projectPath)||
    !samePath(h.activePath,created.projectPath)||
    p.operation!=="open"||p.host_identity_verified!==true||
    p.disk_unchanged_during_open!==true||
    p.project_verified!==true||p.disk_error!==null||
    p.edit_semantics_verified!==false||p.retry_safe!==false||
    !obj(d)||!samePath(d.path,created.projectPath)||
    d.size_bytes!==created.sizeBytes||!FNV.test(d.fnv1a64)||
    d.fnv1a64!==created.fnv1a64)return null;
 return Object.freeze({
   taskId:originalTaskId,createActionId:created.actionId,
   reopenActionId:actionId,projectGuid:created.projectGuid,
   projectPath:created.projectPath,sha256BeforeReopen:shaProof.sha256,
   fileBytesVerifiedBeforeReopen:true,
   hostProjectReopenObserved:true,
   diskFingerprintUnchanged:true,
   sha256AfterReopenVerified:false,
   originalGoalVerified:false
 });
}

export function bindPremiereReopenShaAfterReadback(reopen,shaAgain,taskId){
 if(!obj(reopen)||reopen.taskId!==taskId||!UUID.test(taskId)||
    !obj(shaAgain)||shaAgain.taskId!==taskId||
    shaAgain.actionId!==reopen.createActionId||
    shaAgain.hashAlgorithm!=="sha256"||shaAgain.fileBytesVerified!==true||
    shaAgain.projectReopenVerified!==false||
    shaAgain.originalGoalVerified!==false||
    shaAgain.sha256!==reopen.sha256BeforeReopen||
    !samePath(shaAgain.projectPath,reopen.projectPath))return null;
 return Object.freeze({
  ...reopen,sha256AfterReopenVerified:true,
  projectReopenEvidenceVerified:true,originalGoalVerified:false
 });
}
