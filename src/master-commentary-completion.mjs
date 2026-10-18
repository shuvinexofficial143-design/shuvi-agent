// Shuvi 37 — distinguish an audited DAG from generic AI commentary.
// This controls ONLY the local handoff. Rust must still independently
// verify scheduler jobs, action receipts, artifact bytes and original goal.
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
export function classifyMasterCommentaryCompletion(graph){
 if(graph===null)return Object.freeze({mode:"no_graph"});
 const decision=decideNativeContinuation(graph);
 return Object.freeze({mode:decision.mode==="complete"?"native_finalizer":"preserve_checkpoint"});
}
