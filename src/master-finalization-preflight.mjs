// Shuvi 37 — pure owner-goal-bound admission before writing native delivery.
// Rust currently cannot attest .prproj as a final delivery artifact. The
// evidence-only SHA/reopen status is NOT a replacement for native final proof.
// Do not add a Premiere artifact to the current Rust-owned delivery allowlist.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {assessPremiereProjectProofProgress} from "./master-project-proof-progress.mjs";
import {nativeTaskDeliveryClaims} from "./native-delivery-claims.mjs";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const gate=(allowed,stage,reason,projectProofStage="unverified")=>Object.freeze({
 allowed,stage,reason,projectProofStage,originalGoalVerified:false
});
const isProjectTool=tool=>tool==="premiere_create_project"||
 tool==="premiere_open_project";
export function assessNativeFinalizationPreflight(
 owner,graph,schedule,claims,taskId,created,sha,reopened
){
 if(!obj(graph)||!Array.isArray(graph.steps)||!Array.isArray(claims)||
    !obj(schedule)||typeof owner!=="string")
  return gate(false,"invalid_native_graph","Original owner, typed graph, native scheduler or delivery claims are missing.");
 const actual=nativeTaskDeliveryClaims(graph,schedule);
 if(!actual||JSON.stringify(actual)!==JSON.stringify(claims))
  return gate(false,"unreconciled_native_claims",
   "Final delivery claims are not the exact same independently audited Rust-bound graph.");
 // A model-written or foreign project artifact never smuggles through an
 // unrelated native tool as a purported .prproj final proof.
 if(claims.some(s=>s?.artifact?.kind==="premiere_project"))
  return gate(false,"unsupported_project_artifact",
   "The current Rust delivery allowlist cannot attest a premiere_project artifact.");
 const goal=deriveMasterGoalContract(owner);
 const hasProjectTool=graph.steps.some(s=>isProjectTool(s?.expected_tool));
 if(hasProjectTool||(goal?.apps?.includes("premiere")&&goal.project)){
  const progress=assessPremiereProjectProofProgress(taskId,created,sha,reopened);
  return gate(false,"premiere_project_delivery_unavailable",
   "The audited Premiere project is NOT a native-delivered .prproj: current Rust delivery cannot independently rehash and publish that project artifact. "+
   "Do not replay Adobe Create/Open or infer completed project/export.",
   progress.stage);
 }
 // Preserve the existing audited native-delivery path for other tools,
 // including strictly simple Premiere window opening and Blender/Remotion.
 return gate(true,"standard_native_audited_delivery",
  "Existing native delivery requirements are satisfied at source level; Rust must still independently verify all receipts and files.");
}
