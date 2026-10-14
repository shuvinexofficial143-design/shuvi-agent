// Pure Master/worker continuation decision after exact audited native action.
// Read-only: does not grant a permission, infer application progress or
// schedule another mutating action. Real dispatch stays in Rust execute_action.
import {workerQueueView,nextWorkerTurn} from "./master-worker-queue.mjs";

const pause=reason=>({mode:"pause",reason,next:null});
export function decideNativeContinuation(graph){
  if(graph==null)return {mode:"continue",reason:null,next:null};
  if(!graph||!Array.isArray(graph.steps)||graph.steps.length<1
      ||graph.steps.length>48)return pause("Native task graph is missing or exceeds budget.");
  const queue=workerQueueView(graph);
  if(queue.total!==graph.steps.length||queue.jobs.length!==queue.total)
    return pause("The native task graph is malformed or cannot be verified.");
  if(queue.running>0||graph.steps.some(step=>step?.running!=null))
    return pause("A native job is still running or has an unresolved prepared action.");
  if(queue.jobs.some((job,i)=>graph.steps[i].status==="completed"&&!job.verified))
    return pause("A claimed completion lacks exact Rust-correlated worker evidence.");
  if(queue.verified===queue.total&&
      queue.jobs.every(job=>job.status==="completed"&&job.verified))
    return {mode:"complete",reason:null,next:null};
  const next=nextWorkerTurn(graph);
  if(next)return {mode:"continue",reason:null,next:{
    step_id:next.step_id,worker:next.worker,tool:next.tool
  }};
  if(queue.jobs.some(job=>job.status==="failed"))
    return {mode:"replan",reason:null,next:null};
  return pause("No independently approved, dependency-ready native action remains. Inspect the saved graph.");
}
