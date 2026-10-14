// Build an immutable, Rust-revalidated deliverable from a FINISHED native DAG.
// Never substitutes a WebView claim for the native audit/actual file hash.
import {evidenceForStep} from "./master-worker-queue.mjs";
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
export function nativeTaskDeliveryClaims(graph,schedule){
 if(decideNativeContinuation(graph).mode!=="complete"
     ||!graph||!schedule||schedule.version!==1
     ||schedule.objective!==graph.objective
     ||schedule.revision!==graph.revision
     ||!Array.isArray(schedule.jobs)||schedule.jobs.length!==graph.steps.length
     ||!schedule.jobs.every(job=>job.phase==="audited"))
   return null;
 const ids=new Set(),steps=[];
 for(let i=0;i<graph.steps.length;i++){
   const node=graph.steps[i],job=schedule.jobs[i];
   const receipt=evidenceForStep(node);
   if(!receipt||!job||job.stepId!==node.step_id||
       job.tool!==node.expected_tool||job.actionId!==receipt.action_id
       ||ids.has(receipt.action_id))return null;
   ids.add(receipt.action_id);
   // evidenceForStep is intentionally a minimal identity projection.
   // Recover the one matching source evidence only AFTER verification;
   // never accept an arbitrary untrusted artifact from an unrelated step.
   const proof=node.evidence.filter(e=>e?.action_id===receipt.action_id
     &&e.tool===receipt.tool&&e.success===true);
   if(proof.length!==1)return null;
   const entry={stepId:node.step_id,tool:node.expected_tool,
     actionId:receipt.action_id,artifact:null};
   const required=new Set(["blender_run_plan",
     "motion_graphics_accept_final_remotion",
     "motion_graphics_plan_premiere_insertion"]);
   if(required.has(node.expected_tool)){
     const a=proof[0].artifact;
     if(!a||typeof a.path!=="string"||typeof a.sha256!=="string"
        ||typeof a.kind!=="string")return null;
     entry.artifact={kind:a.kind,path:a.path,sha256:a.sha256,
       bytes:Number.isSafeInteger(a.bytes)?a.bytes:0};
   }
   steps.push(entry);
 }
 return steps;
}
