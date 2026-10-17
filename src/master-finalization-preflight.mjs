// Shuvi 37 — pure owner-goal-bound admission before writing native delivery.
// A project path or user/model-written SHA is never adequate: Rust must
// independently check the native audited create action and real file bytes.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {pinnedMasterObjective} from "./master-autonomy-graph.mjs";
import {assessPremiereProjectProofProgress} from "./master-project-proof-progress.mjs";
import {nativeTaskDeliveryClaims} from "./native-delivery-claims.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";
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
 // Check ORIGINAL owner identity on every delivery lane, not just Premiere.
 // A legitimate Rust receipt for another task must not be relabeled when
 // owner text rotates but its tool family/classification stays the same.
 const objective=pinnedMasterObjective(owner);
 if(!objective||graph.objective!==objective||schedule.objective!==objective||
    schedule.version!==1||schedule.revision!==graph.revision||
    !Array.isArray(schedule.jobs)||schedule.jobs.length!==graph.steps.length)
  return gate(false,"owner_task_identity_mismatch",
   "Native final delivery belongs to another original owner brief, task graph or scheduler revision.");
 const goal=deriveMasterGoalContract(owner);
 const hasProjectTool=graph.steps.some(s=>isProjectTool(s?.expected_tool));
 if(hasProjectTool||(goal?.apps?.includes("premiere")&&goal.project)){
  const progress=assessPremiereProjectProofProgress(taskId,created,sha,reopened);
  const deny=(stage,reason)=>gate(false,stage,reason,progress.stage);
  if(!goal||goal.apps.length!==1||goal.apps[0]!=="premiere"||
     !goal.project||goal.editing||goal.exportFile)
   return deny("premiere_goal_not_eligible","Native project delivery only applies to the original, bounded Premiere project-only goal.");
  if(progress.stage!=="reopen_audited")
   return deny("premiere_project_delivery_unavailable",
    "The owner-approved Create, independent Rust SHA-256 and separately approved/audited Reopen must all be present before claiming a .prproj delivery.");
  const creates=graph.steps.filter(s=>s?.expected_tool==="premiere_create_project");
  const opens=graph.steps.filter(s=>s?.expected_tool==="premiere_open_project");
  if(creates.length!==1||opens.length!==1||creates[0].step_id!==created.stepId||
     opens[0].depends_on?.includes(creates[0].step_id)!==true)
   return deny("premiere_project_graph_invalid","Require exactly one audited CREATE and one dependent separately approved OPEN.");
  // JS preflight and the independent Rust finalizer must agree on the
  // NATIVE scheduler edge. A WebView-only DAG dependency is not sufficient.
  const createIndex=schedule.jobs?.findIndex(j=>j?.stepId===creates[0].step_id);
  const openIndex=schedule.jobs?.findIndex(j=>j?.stepId===opens[0].step_id);
  if(!Number.isInteger(createIndex)||createIndex<0||
     !Number.isInteger(openIndex)||openIndex<=createIndex||
     !schedule.jobs[openIndex]?.dependsOn?.includes(creates[0].step_id))
   return deny("premiere_project_native_dependency_invalid",
    "Rust scheduler must independently require a later, dependent project REOPEN.");
  const make=evidenceForStep(creates[0]),open=evidenceForStep(opens[0]);
  if(!make||!open||make.action_id!==created.actionId||
     open.action_id!==reopened.reopenActionId||
     make.action_id===open.action_id||open.orchestration_step<=make.orchestration_step)
   return deny("premiere_project_audit_invalid","Project create/open native action UUID and audited order disagree.");
  const actual=nativeTaskDeliveryClaims(graph,schedule,{taskId,created,sha,reopened});
  if(!actual||JSON.stringify(actual)!==JSON.stringify(claims))
   return deny("unreconciled_native_claims","Rust final delivery must receive the exact original owner-bound create+SHA+reopen graph, never an injected artifact.");
  if(!claims.every((step,i)=> i===graph.steps.indexOf(creates[0])
      ?obj(step.artifact)&&step.artifact.kind==="premiere_project"&&
       step.artifact.path===created.projectPath&&
       step.artifact.sha256===sha.sha256&&step.artifact.bytes===sha.bytes
      :step.artifact==null))
   return deny("premiere_project_artifact_invalid","Only the audited project-create step may carry its exact, independently verified project artifact.");
  return gate(true,"premiere_project_native_hash_candidate",
   "The exact project proof chain is eligible for Rust SHA-256 file rehash and complete action-audit verification; original Premiere creative goal is NOT yet accepted.",
   progress.stage);
 }
 const actual=nativeTaskDeliveryClaims(graph,schedule);
 if(!actual||JSON.stringify(actual)!==JSON.stringify(claims))
  return gate(false,"unreconciled_native_claims",
   "Final delivery claims are not the exact same independently audited Rust-bound graph.");
 if(claims.some(s=>s?.artifact?.kind==="premiere_project"))
  return gate(false,"unsupported_project_artifact",
   "Premiere project artifacts must be associated with exactly one owner-proven create/reopen chain.");
 return gate(true,"standard_native_audited_delivery",
  "Existing native delivery requirements are satisfied at source level; Rust must still independently verify all receipts and files.");
}
