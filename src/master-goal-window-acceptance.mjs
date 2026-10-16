// Shuvi 37 — no-provider, audit-bound proof of a narrow application-opening goal.
// Never proves project creation, editing, exports or app usability. Native
// Rust receipts and delivery are authoritative; this module cannot execute.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {pinnedMasterObjective,validateMasterPlan} from "./master-autonomy-graph.mjs";
import {assessMasterSchedulerAdmission} from "./native-scheduler-admission.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";
import {windowGoalEvidence} from "../web-dashboard/src/native-goal-evidence.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const deny=reason=>({verified:false,scope:"unverified",reason});
const purePremiereOpening=owner=>{
 const g=deriveMasterGoalContract(owner);
 return !!g&&g.apps.length===1&&g.apps[0]==="premiere"&&g.opening&&
  !g.project&&!g.editing&&!g.exportFile;
};

// Called only after executing an explicitly owner-approved native action and
// verifying the exact execute_action UUID+tool/result against Rust audit.
// The record is transient and discarded on task rotation/restart/mutation.
export function captureMasterOpeningObservation(owner,graph,proposal,result,actionId,taskId,audited){
 if(!purePremiereOpening(owner)||audited!==true||!obj(graph)||
    !obj(proposal)||proposal.tool!=="ui_windows"||
    !UUID.test(actionId)||!UUID.test(taskId))return null;
 const step=graph.steps?.find(s=>s.step_id===proposal.task_step_id);
 const receipt=evidenceForStep(step);
 if(!receipt||step.expected_tool!=="ui_windows"||receipt.action_id!==actionId)return null;
 const observed=windowGoalEvidence(owner,result,true);
 if(!observed||observed.app!=="premiere")return null;
 // For final acceptance, both an observed target TITLE and the OS's positive
 // ProcessName must agree: title-only matching is insufficient.
 let rows;try{rows=JSON.parse(result.stdout);}catch{return null;}
 const candidates=rows.filter(row=>obj(row)&&
  row.ProcessId===observed.pid&&row.NativeWindowHandle===observed.hwnd&&
  typeof row.ProcessName==="string"&&/\bpremiere\b/i.test(row.ProcessName));
 if(candidates.length!==1)return null;
 return Object.freeze({
  taskId,objective:pinnedMasterObjective(owner),actionId,stepId:step.step_id,
  window:Object.freeze({...observed})
 });
}

export function verifyMasterOpeningDelivery(owner,graph,schedule,delivery,captured,activeTaskId){
 if(!purePremiereOpening(owner))return deny("Only an explicitly requested Premiere opening is eligible for window-only goal acceptance.");
 const objective=pinnedMasterObjective(owner);
 if(!objective||!obj(graph)||graph.objective!==objective||
   !validateMasterPlan(owner,graph).ok)return deny("Original task identity or typed DAG scope disagrees.");
 if(!obj(captured)||captured.taskId!==activeTaskId||!UUID.test(activeTaskId)||
   captured.objective!==objective||!UUID.test(captured.actionId)||
   !obj(captured.window)||captured.window.app!=="premiere"||
   typeof captured.window.title!=="string"||
   !/\bpremiere\b/i.test(captured.window.title)||
   !Number.isSafeInteger(captured.window.pid)||captured.window.pid<=0||
   !Number.isSafeInteger(captured.window.hwnd)||captured.window.hwnd<=0)
   return deny("Fresh audited target-window evidence is missing or from another task.");

 const stages=graph.steps;
 if(stages.length<2||stages.length>48||
   !stages.every(s=>s.status==="completed"&&!s.running))
   return deny("The native workflow is not completely independently audited.");
 const launch=stages.filter(s=>s.expected_tool==="premiere_launch");
 const observed=stages.filter(s=>s.expected_tool==="ui_windows");
 if(launch.length!==1||observed.length!==1||
   captured.stepId!==observed[0].step_id)
   return deny("Exactly one dedicated Premiere launcher and one fresh window inspection must be audited.");
 const launchReceipt=evidenceForStep(launch[0]),windowReceipt=evidenceForStep(observed[0]);
 if(!launchReceipt||!windowReceipt||captured.actionId!==windowReceipt.action_id||
   launchReceipt.action_id===windowReceipt.action_id||
   launchReceipt.orchestration_step>=windowReceipt.orchestration_step||
   !observed[0].depends_on?.includes(launch[0].step_id))
   return deny("Window observation is not a distinct, dependency-bound Rust-audited successor to Premiere launch.");

 const admission=assessMasterSchedulerAdmission(schedule,graph);
 if(!admission.ok||!obj(schedule)||schedule.objective!==objective||
    schedule.jobs?.length!==stages.length||
    schedule.jobs.some(job=>job.phase!=="audited"))
   return deny("Exact Rust scheduler identity and audited worker steps do not match.");
 if(!obj(delivery)||delivery.version!==1||delivery.objective!==objective||
    delivery.revision!==graph.revision||
    !Array.isArray(delivery.steps)||delivery.steps.length!==stages.length)
   return deny("Exact Rust-verified final native delivery is unavailable or mismatched.");
 const indexed=new Map(stages.map(s=>[s.step_id,s]));
 const seen=new Set();
 for(const item of delivery.steps){
   if(!obj(item)||seen.has(item.stepId))return deny("Native final delivery has duplicate or missing step identity.");
   seen.add(item.stepId);
   const nativeStep=indexed.get(item.stepId);
   const receipt=evidenceForStep(nativeStep);
   if(!nativeStep||!receipt||nativeStep.expected_tool!==item.tool||
      receipt.action_id!==item.actionId||!UUID.test(item.actionId))
      return deny("Final delivery lacks a matching independently audited action receipt.");
 }
 return {verified:true,scope:"premiere_window",reason:null,
    window:captured.window,actionId:captured.actionId};
}
