// Shuvi37 — source-only *replay PREVENTION*, not proof of the original
// owner's creative goal. A durable all-audited DAG must not spawn another
// billed model call even if its completed checkpoint survived native cleanup.
// Exact prior Rust delivery is corroborated using graph's audited UUIDs.
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const SHA=/^[a-f0-9]{64}$/;
const FILE_TOOLS=new Set(["blender_run_plan",
 "motion_graphics_accept_final_remotion","motion_graphics_plan_premiere_insertion"]);
const expectedKind=Object.freeze({
 blender_run_plan:"blender_artifact",
 motion_graphics_accept_final_remotion:"accepted_remotion",
 motion_graphics_plan_premiere_insertion:"premiere_insertion_plan",
 premiere_create_project:"premiere_project"
});
// A host-rehashed final receipt must describe the SAME persisted worker
// artifact that was locally bound to the audited DAG. Matching action UUIDs
// alone cannot justify reporting an external artifact as delivered.
function matchesArtifact(step,actual){
 const tool=step.expected_tool,a=actual.artifact;
 if(!FILE_TOOLS.has(tool)&&tool!=="premiere_create_project")
  return a==null;
 if(!obj(a)||a.kind!==expectedKind[tool]||
    typeof a.path!=="string"||!a.path||
    typeof a.sha256!=="string"||!SHA.test(a.sha256)||
    !Number.isSafeInteger(a.bytes)||a.bytes<1)return false;
 if(tool==="premiere_create_project")
  return /\\.prproj$/i.test(a.path);
 const evidence=step.evidence?.filter(e=>e?.success===true&&
   e.action_id===actual.actionId&&e.tool===tool);
 if(evidence?.length!==1||!obj(evidence[0].artifact))return false;
 const original=evidence[0].artifact;
 return original.kind===a.kind&&original.path===a.path&&
   original.sha256===a.sha256&&
   (tool!=="blender_run_plan"||original.bytes===a.bytes);
}
function matchesProjectChain(graph,delivery){
 const creates=graph.steps.filter(s=>s.expected_tool==="premiere_create_project");
 if(creates.length===0)return true;
 const opens=graph.steps.filter(s=>s.expected_tool==="premiere_open_project");
 if(creates.length!==1||opens.length!==1||
    !opens[0].depends_on?.includes(creates[0].step_id))return false;
 const createIndex=graph.steps.indexOf(creates[0]);
 const openIndex=graph.steps.indexOf(opens[0]);
 if(openIndex<=createIndex)return false;
 const create=evidenceForStep(creates[0]);
 const reopened=evidenceForStep(opens[0]);
 return !!create&&!!reopened&&
   reopened.orchestration_step>create.orchestration_step&&
   delivery.steps[createIndex]?.actionId===create.action_id&&
   delivery.steps[openIndex]?.actionId===reopened.action_id;
}
export function classifyNativeResumeReplay(graph,delivery){
 if(decideNativeContinuation(graph).mode!=="complete")
  return Object.freeze({blocked:false,delivered:false,reason:null});
 const same= obj(delivery)&&delivery.version===1&&
   delivery.objective===graph.objective&&
   delivery.revision===graph.revision&&
   Array.isArray(delivery.steps)&&delivery.steps.length===graph.steps.length&&
   Number.isSafeInteger(delivery.recordedAtMs)&&delivery.recordedAtMs>0&&
   graph.steps.every((step,i)=>{
    const receipt=evidenceForStep(step),actual=delivery.steps[i];
    return obj(actual)&&receipt&&actual.stepId===step.step_id&&
      actual.tool===step.expected_tool&&actual.actionId===receipt.action_id&&
      matchesArtifact(step,actual);
   })&&matchesProjectChain(graph,delivery);
 return Object.freeze({blocked:true,delivered:Boolean(same),
  reason:same
   ?"Saved native DAG already has an independently Rust-audited final delivery. This finished task cannot be resumed or billed again. Review last delivery receipt."
   :"Saved native DAG is already fully audited but matching Rust final delivery has not been confirmed. Inspect the task and Rust delivery; do not repeat Windows actions or paid requests."});
}
