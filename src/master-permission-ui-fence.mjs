// Shuvi37 — exact DOM permission-button to Rust prepared-action owner fence.
// This checks local provenance; it is not a native grant or tool approval.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function captureMasterPermissionUiFence(scope,graph,owner,pending,proposal,remote){
 if(!obj(scope)||!UUID.test(scope.taskId)||scope.revoked!==false||
  !obj(pending)||!UUID.test(pending.id)||!obj(proposal)||
  !(graph===null||obj(graph))||
  !(owner===null||(typeof owner==="string"&&owner.length<=2500)))return null;
 return Object.freeze({scope,taskId:scope.taskId,graph,owner,pending,
  actionId:pending.id,proposal,remote});
}
export function isMasterPermissionUiFenceCurrent(fence,current){
 return Boolean(obj(fence)&&obj(current)&&obj(current.scope)&&
  current.scope===fence.scope&&current.scope.taskId===fence.taskId&&
  current.scope.revoked===false&&current.graph===fence.graph&&
  current.owner===fence.owner&&current.pending===fence.pending&&
  current.pending?.id===fence.actionId&&
  current.proposal===fence.proposal&&current.remote===fence.remote&&
  current.cancelRequested===false&&current.mode==="normal");
}
