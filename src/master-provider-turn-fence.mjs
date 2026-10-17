// Shuvi 37 — hold a paid model response to the EXACT original task and
// single reserved request. A provider message is never a native approval.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const MODE=new Set(["normal","replan_required"]);
export function captureMasterProviderTurnFence(scope,graph,owner,nextStep,reserved,mode){
 if(!object(scope)||!UUID.test(scope.taskId)||scope.revoked!==false||
    !(graph===null||object(graph))||
    typeof owner!=="string"||!owner.trim()||owner.length>2500||
    !Number.isInteger(nextStep)||nextStep<1||nextStep>48||
    !Number.isInteger(reserved)||reserved<1||reserved>48||
    !MODE.has(mode))return null;
 return Object.freeze({scope,taskId:scope.taskId,graph,owner,nextStep,reserved,mode});
}
export function isMasterProviderTurnFenceCurrent(fence,state){
 return Boolean(object(fence)&&object(state)&&object(state.scope)&&
  state.scope===fence.scope&&state.scope.revoked===false&&
  state.scope.taskId===fence.taskId&&state.graph===fence.graph&&
  state.owner===fence.owner&&state.nextStep===fence.nextStep&&
  state.reserved===fence.reserved&&state.mode===fence.mode&&
  state.cancelRequested===false&&UUID.test(fence.taskId));
}
