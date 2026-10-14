export type NativeContinuationDecision = {mode:"continue"|"replan"|"complete"|"pause";reason:string|null;next:{step_id:string;worker:string;tool:string}|null};
export function decideNativeContinuation(graph:unknown):NativeContinuationDecision;
