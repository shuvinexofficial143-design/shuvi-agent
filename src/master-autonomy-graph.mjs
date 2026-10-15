// Shuvi 37: owner-brief-bound graph admission for the EXISTING Rust-backed
// Tauri desktop coordinator. This validates plans; never dispatches a tool,
// issues a permission grant, fabricates native receipts, or retries a model.
import {deriveMasterGoalContract} from './master-autonomy-contract.mjs';
import {workerForTool} from './master-worker-queue.mjs';

const EDITOR_TOOLS={
  premiere:/^premiere_/,
  after_effects:/^after_effects_/,
  blender:/^blender_/
};
const deny=reason=>({ok:false,reason});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const TOOL=/^[a-z][a-z0-9_]{0,159}$/;

// Long natural-language requests have a bounded native scheduler objective,
// but the full original brief (up to the task guard's 2500 chars) stays in the
// orchestration checkpoint. Never model-paraphrase the native DAG identity.
export function pinnedMasterObjective(ownerRequest) {
  if(typeof ownerRequest!=='string'||!ownerRequest.trim()||ownerRequest.length>2500)return null;
  return ownerRequest.trim().slice(0,500);
}

// A clear plan is not evidence that work has happened. We only validate
// provenance, declared tool ownership and required order; old graph evidence
// remains entirely owned by task-graph and Rust, not by this module.
export function validateMasterPlan(ownerRequest,metadata) {
  const pinned=pinnedMasterObjective(ownerRequest);
  if(!pinned)return deny('No valid, local owner-brief identity. Re-enter the task before authoring a native DAG.');
  if(!object(metadata)||!Array.isArray(metadata.steps)||
     metadata.steps.length<1||metadata.steps.length>48)
    return deny('Master DAG is missing bounded typed worker steps.');
  if(metadata.objective!==pinned)
    return deny('Master DAG objective differs from the exact original owner brief; it may not be paraphrased or replaced.');
  const goal=deriveMasterGoalContract(ownerRequest);
  if(!goal)return deny('Master owner brief could not be classified safely.');
  for(const step of metadata.steps){
    if(!object(step)||typeof step.expected_tool!=='string'||
       !TOOL.test(step.expected_tool)||workerForTool(step.expected_tool)==='unsupported')
      return deny('Master DAG includes an unknown or unsupported native worker tool.');
    const conflicting=goal.apps.length===1&&Object.keys(EDITOR_TOOLS).find(app=>
      app!==goal.apps[0]&&EDITOR_TOOLS[app].test(step.expected_tool));
    if(conflicting)return deny('Master DAG tries to add '+conflicting+
      ' although the owner only requested '+goal.apps[0]+'.');
  }
  // A user's request to open an editor is not a request to edit/save/export.
  // Do not let a plan expand a simple launch into unrelated project actions.
  if(goal.apps.length===1&&goal.opening&&!goal.project&&!goal.editing&&!goal.exportFile){
    if(metadata.steps.some(s=>/^(?:premiere_|after_effects_|blender_)/.test(s.expected_tool)&&
         !/(?:launch|detect|inspect|context|status|windows)$/.test(s.expected_tool)))
      return deny('Opening an editor does not authorize a project mutation or export.');
  }
  return {ok:true,reason:null};
}

// An owner-brief-bound job can never switch apps through a later proposal
// that omits its updated graph. The usual native approval checks still apply.
export function validateMasterAction(ownerRequest,proposal){
  const goal=deriveMasterGoalContract(ownerRequest);
  if(!goal)return deny('Original task is missing; native action scope not established.');
  if(!object(proposal)||typeof proposal.tool!=='string'||!TOOL.test(proposal.tool))
    return deny('Master proposed a malformed native tool identity.');
  const conflicting=goal.apps.length===1&&Object.keys(EDITOR_TOOLS).find(app=>
    app!==goal.apps[0]&&EDITOR_TOOLS[app].test(proposal.tool));
  if(conflicting)return deny('Native action targets '+conflicting+
    ' but the owner requested only '+goal.apps[0]+'.');
  if(goal.apps.length===1&&goal.opening&&!goal.project&&!goal.editing&&!goal.exportFile&&
      /^(?:premiere_|after_effects_|blender_)/.test(proposal.tool)&&
      !/(?:launch|detect|inspect|context|status)$/.test(proposal.tool))
    return deny('An editor-opening brief does not authorize editing or export.');
  return {ok:true,reason:null};
}

// Source-level readiness ONLY. Immutable successful Rust audits and durable
// delivery prove steps, not necessarily the ORIGINAL creative end goal.
// A project/save, edit or export requires stronger app/file evidence than
// a generic complete DAG and currently remains unverified.
export function assessMasterGoalDelivery(ownerRequest,graph) {
  const goal=deriveMasterGoalContract(ownerRequest);
  if(!goal||!graph||!Array.isArray(graph.steps))
    return {verified:false,reason:'Original task or native graph is unavailable.'};
  if(goal.project||goal.editing||goal.exportFile)
    return {verified:false,reason:'Project creation, edit and export require independent app-state/artifact acceptance; audited tool steps alone are insufficient.'};
  if(goal.apps.length===1&&goal.opening)
    return {verified:false,reason:'An audited UI inspection needs independently matched target-window evidence before the opening goal is verified.'};
  return {verified:false,reason:'No model-neutral final goal verifier exists for this task type.'};
}
