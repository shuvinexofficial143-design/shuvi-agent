// Shuvi 37: fail-closed identity fence for asynchronous Premiere proof.
// Rust remains sole native execution, approval, scheduler and audit authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function captureNativeProjectProofFence(scope,graph,ownerRequest,actionId){
 if(!object(scope)||!UUID.test(scope.taskId)||scope.revoked===true||
    !object(graph)||typeof ownerRequest!=="string"||!ownerRequest.trim()||
    ownerRequest.length>2500||!UUID.test(actionId))return null;
 return Object.freeze({scope,taskId:scope.taskId,graph,ownerRequest,actionId});
}
export function isNativeProjectProofFenceCurrent(fence,current){
 if(!object(fence)||!object(current)||!object(current.scope)||
    current.scope!==fence.scope||current.scope.taskId!==fence.taskId||
    current.scope.revoked===true||current.graph!==fence.graph||
    current.ownerRequest!==fence.ownerRequest||
    current.actionId!==fence.actionId||
    current.cancelRequested!==false||current.recoveryMode!=="normal"||
    !UUID.test(fence.taskId)||!UUID.test(fence.actionId))return false;
 return true;
}
