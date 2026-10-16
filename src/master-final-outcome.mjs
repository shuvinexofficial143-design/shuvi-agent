// Shuvi 37: final ORIGINAL-owner-goal acceptance is independent from Rust
// action execution, complete DAG status and native delivery publication.
// Only a narrow Premiere-window opening has a live, separately auditable
// acceptance contract today. For all other tasks fail closed and report the
// exact capability/evidence gaps; never infer completion from worker counts.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {verifyMasterOpeningDelivery} from "./master-goal-window-acceptance.mjs";

const REQUIREMENT_REASONS=Object.freeze({
 window:"Unique target-app window identity from a fresh Rust-audited OS inspection",
 new_project_identity:"Actual application project identity observed after a native project-create action",
 saved_project_location:"Native file identity, absolute .prproj path and independent Rust SHA-256 file-byte attestation (Team 40 FNV-1a64 is not cryptographic)",
 observed_edit_effect:"Independent application timeline before/after evidence of the requested edit",
 persisted_export_artifact:"Rust-rehashed final exported video linked to the requested project and timeline"
});

const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const failure=(reason,requirements=[],completedNativeSteps=0)=>({
 verified:false,scope:"unverified",reason,completedNativeSteps,
 required:requirements,missing:requirements.map(id=>({
   id,reason:REQUIREMENT_REASONS[id]??"Task-specific independent native result verifier"
 }))
});

// No tool-only or arbitrary Rust delivery artifact can manufacture a
// Premiere project proof: native_task_delivery currently only accepts
// blender_artifact, accepted_remotion and premiere_insertion_plan. Those are
// NOT native Premiere .prproj creation, timeline-effect or export attestations.
export function assessMasterFinalOutcome(owner,graph,schedule,delivery,opening,taskId){
 const goal=deriveMasterGoalContract(owner);
 if(!goal||!obj(graph)||!Array.isArray(graph.steps))
   return failure("Original owner request or typed native DAG is missing. No task completion inferred.");
 const requirements=goal.required.length?goal.required.slice():["task_specific_result"];
 const completedNativeSteps=graph.steps.filter(s=>s&&s.status==="completed").length;
 if(goal.apps.length!==1)
   return failure("No unique explicitly named application is bound to an independent outcome verifier.",
     requirements,completedNativeSteps);
 if(goal.apps[0]!=="premiere")
   return failure("This editor has no model-neutral native result verifier. Successful actions do not establish its end goal.",
     requirements,completedNativeSteps);
 if(goal.project||goal.editing||goal.exportFile)
   return failure("Premiere creative goal is not independently verified. Rust action receipts do NOT attest project identity, saved .prproj, timeline edits or finished export.",
     requirements,completedNativeSteps);
 if(!goal.opening)
   return failure("This Premiere request is not a simple opening goal with an independent acceptance contract.",
     requirements,completedNativeSteps);
 // The existing strict native opening verifier checks all graph dependencies,
 // distinct Rust action UUIDs, exact schedule and final Rust delivery IDs,
 // plus positive OS process/window evidence in the current task.
 const accepted=verifyMasterOpeningDelivery(owner,graph,schedule,delivery,opening,taskId);
 if(!accepted.verified)
   return failure(accepted.reason,requirements,completedNativeSteps);
 return {
   verified:true,scope:"premiere_window",reason:null,
   completedNativeSteps,required:requirements,missing:[],
   window:accepted.window,actionId:accepted.actionId
 };
}

export function summarizeMasterMissingProof(outcome){
 if(!outcome||outcome.verified!==false)return "Original task outcome not independently verified.";
 const list=Array.isArray(outcome.missing)?outcome.missing:[];
 const missing=list.slice(0,5).map(x=>x.reason).filter(x=>typeof x==="string");
 const reason=typeof outcome.reason==="string"?outcome.reason.slice(0,420):"Missing independent native acceptance.";
 return "ORIGINAL TASK UNVERIFIED: "+reason+
   (missing.length?" Required proof: "+missing.join("; ")+".":"")+
   " The audited native delivery may be inspected, but is not an end-goal success claim.";
}


// Bounded, deterministic instructions for the NEXT Master or specialist turn.
// They declare proof obligations only; they NEVER grant permission, create a
// native tool, assert a native app capability, or ask for paid retries.
export function masterGoalEvidenceContext(owner){
 const goal=deriveMasterGoalContract(owner);
 if(!goal)return "SHUVI ORIGINAL GOAL: unavailable; do not stage native work.";
 const ids=goal.required.length?goal.required:["task_specific_result"];
 const proofs=ids.map(id=>id+": "+(REQUIREMENT_REASONS[id]??
   "No independent goal-specific native verifier is installed"));
 const eligibleSimpleOpening=goal.apps.length===1&&goal.apps[0]==="premiere"&&
   goal.opening&&!goal.project&&!goal.editing&&!goal.exportFile;
 return "SHUVI INDEPENDENT GOAL ACCEPTANCE: Preserve the owner's ORIGINAL "+
   "request; a completed native DAG or successful tool count is NOT task completion. "+
   "Before any final success claim independently satisfy each proof obligation: "+
   proofs.join("; ").slice(0,1100)+". "+
   (eligibleSimpleOpening?"A separately audited Premiere launcher and unique matching native window inspection can prove opening only. ":
    "Independent verified native result acceptance for this full goal is not yet installed; report unverified until actually available. ")+
   "Never invent a Premiere project path, .prproj hash, timeline change, export, UI observation, action ID or Rust receipt. "+
   "Keep owner approvals, typed tool scope, Rust worker lease and independent audits mandatory.";
}
