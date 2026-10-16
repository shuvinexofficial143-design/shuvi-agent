// Shuvi 37 — candidate-only interoperability with Team 40's existing
// premiere_create_project Rust + Adobe host result. No action dispatch,
// persisted output attestation or ORIGINAL-GOAL success authority lives here.
// Team 40 currently uses FNV-1a64 (change detector), NOT SHA-256.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{16}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const cleanPath=x=>typeof x==="string"&&x.length>=9&&x.length<=4096&&x===x.trim()&&
 !/[\x00-\x1f\x7f]/.test(x)&&/\.prproj$/i.test(x)&&
 (/^[a-z]:[\\/]/i.test(x)||/^\\\\[^\\]+\\[^\\]+\\/.test(x))&&
 !/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(x);
const samePath=(a,b)=>cleanPath(a)&&cleanPath(b)&&
 a.replaceAll("/","\\").toLowerCase()===b.replaceAll("/","\\").toLowerCase();

export function inspectPremiereProjectCreateCandidate(
 original,graph,proposal,result,actionId,taskId,rustAuditVerified
){
 const goal=deriveMasterGoalContract(original);
 if(!goal||goal.apps.length!==1||goal.apps[0]!=="premiere"||
    !goal.project||rustAuditVerified!==true||
    !UUID.test(actionId)||!UUID.test(taskId)||
    !obj(graph)||!Array.isArray(graph.steps)||!obj(proposal)||
    proposal.tool!=="premiere_create_project"||
    !obj(proposal.arguments)||!cleanPath(proposal.arguments.path)||
    !obj(result)||result.tool!=="premiere_create_project"||
    result.success!==true||result.exit_code!==0||
    typeof result.stdout!=="string"||result.stdout.length>32768)return null;
 // The ToolAction must belong to this EXACT native audited task graph step.
 const step=graph.steps.find(x=>x.step_id===proposal.task_step_id);
 const receipt=evidenceForStep(step);
 if(!receipt||step.expected_tool!=="premiere_create_project"||
    receipt.action_id!==actionId||receipt.tool!==result.tool)return null;
 let payload;
 try{payload=JSON.parse(result.stdout);}catch{return null;}
 if(!obj(payload)||payload.post_state_verified!==true||
    payload.retry_safe!==false||!obj(payload.host)||
    !obj(payload.project_evidence))return null;
 const h=payload.host,p=payload.project_evidence;
 if(h.operation!=="create"||h.hostAccepted!==true||
    h.projectIdentityVerified!==true||h.initialSaveAccepted!==true||
    h.verificationStatus!=="verified_host_identity"||
    h.uncertain!==false||h.retrySafe!==false||
    typeof h.projectGuid!=="string"||!h.projectGuid.trim()||
    h.projectGuid.length>160||h.projectGuid!==h.activeGuid||
    !samePath(proposal.arguments.path,h.projectPath)||
    !samePath(proposal.arguments.path,h.activePath)||
    p.operation!=="create"||p.host_identity_verified!==true||
    p.disk_persistence_verified!==true||p.project_verified!==true||
    p.edit_semantics_verified!==false||p.reopen_verified!==false||
    p.retry_safe!==false||!obj(p.disk_fingerprint))return null;
 const d=p.disk_fingerprint;
 if(!samePath(proposal.arguments.path,d.path)||
    !Number.isSafeInteger(d.size_bytes)||d.size_bytes<1||
    d.size_bytes>256*1024*1024||typeof d.fnv1a64!=="string"||
    !HASH.test(d.fnv1a64)||
    !(d.modified_ms===null||
      (Number.isSafeInteger(d.modified_ms)&&d.modified_ms>=0)))return null;
 return Object.freeze({
   taskId,actionId,stepId:step.step_id,
   projectGuid:h.projectGuid,projectPath:d.path,
   sizeBytes:d.size_bytes,fingerprintAlgorithm:"fnv1a64_noncryptographic_change_detector",
   fnv1a64:d.fnv1a64,
   hostIdentityObserved:true,diskBytesObserved:true,
   sha256Attested:false,reopenVerified:false,
   originalGoalVerified:false
 });
}

export function projectCandidateStatus(candidate,activeTaskId){
 if(!obj(candidate)||candidate.taskId!==activeTaskId||!UUID.test(activeTaskId))
  return "No task-bound Premiere project creation proof candidate.";
 return "Premiere project-create candidate: native host identity and disk bytes observed "+
  "(FNV-1a64 change fingerprint, "+candidate.sizeBytes+" bytes). "+
  "No Rust SHA-256 delivery attestation or separate project-reopen acceptance. "+
  "ORIGINAL PROJECT GOAL UNVERIFIED; no retry, edit or export authorized.";
}
