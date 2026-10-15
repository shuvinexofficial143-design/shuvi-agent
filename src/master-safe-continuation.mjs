// Shuvi 37 — deterministic, independently audited follow-up READ planning.
// This produces a candidate for the EXISTING prepare_tool -> Allow once or
// exact Rust task-grant -> execute_action -> receipt flow. It performs no IO,
// never claims a native action executed, and cannot grant permissions.
import {nextWorkerTurn,evidenceForStep} from "./master-worker-queue.mjs";
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
import {pinnedMasterObjective,validateMasterAction} from "./master-autonomy-graph.mjs";

// Deliberately small. Do not infer arguments/paths/target windows, import
// artifacts or dispatch a mutating worker from a task graph alone.
const READBACK_TOOLS=new Set(["ui_windows","list_processes"]);

export function planVerifiedNativeReadback(graph, ownerRequest, options={}) {
 if(!graph||!Array.isArray(graph.steps)||!pinnedMasterObjective(ownerRequest)
     ||graph.objective!==pinnedMasterObjective(ownerRequest))
   return null;
 if(options.lastOutcome!=="success"||options.recoveryMode!=="normal"
     ||options.cancelRequested===true||options.remoteTask===true)
   return null;
 const decision=decideNativeContinuation(graph);
 if(decision.mode!=="continue"||!decision.next)return null;
 const next=nextWorkerTurn(graph);
 if(!next||next.step_id!==decision.next.step_id||
    next.tool!==decision.next.tool||!READBACK_TOOLS.has(next.tool))
   return null;
 const current=graph.steps.find(s=>s.step_id===next.step_id);
 if(!current||current.status!=="ready"||
    !Array.isArray(current.depends_on)||current.depends_on.length===0
    ||current.depends_on.length>7)return null;
 // Never derive a "verified predecessor" from a model-authored status alone.
 // evidenceForStep demands an independent UUID, exact typed success and audit.
 const receipts=[];
 for(const depId of current.depends_on) {
   const previous=graph.steps.find(s=>s.step_id===depId);
   if(!previous||previous.status!=="completed")return null;
   const receipt=evidenceForStep(previous);
   if(!receipt||!receipt.action_id||!receipt.tool)return null;
   receipts.push(receipt);
 }
 if(new Set(receipts.map(r=>r.action_id)).size!==receipts.length)return null;
 // Worker queue additionally checks EVERY native UUID, dependency order,
 // artifact handoff, native worker lease and supported worker availability.
 const candidate={
   tool:next.tool,
   arguments:{},
   task_step_id:next.step_id,
   reason:"Verified dependency-ready native readback. This is a proposed action only; Rust preparation, approval/grant and independent audit still required."
 };
 if(!validateMasterAction(ownerRequest,candidate).ok)return null;
 return candidate;
}
