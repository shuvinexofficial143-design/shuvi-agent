// Shuvi37 — source-only *replay PREVENTION*, not proof of the original
// owner's creative goal. A durable all-audited DAG must not spawn another
// billed model call even if its completed checkpoint survived native cleanup.
// Exact prior Rust delivery is corroborated using graph's audited UUIDs.
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
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
      actual.tool===step.expected_tool&&actual.actionId===receipt.action_id;
   });
 return Object.freeze({blocked:true,delivered:Boolean(same),
  reason:same
   ?"Saved native DAG already has an independently Rust-audited final delivery. This finished task cannot be resumed or billed again. Review last delivery receipt."
   :"Saved native DAG is already fully audited but matching Rust final delivery has not been confirmed. Inspect the task and Rust delivery; do not repeat Windows actions or paid requests."});
}
