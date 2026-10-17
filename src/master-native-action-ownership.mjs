// Shuvi 37: all native tool outcomes belong to the one original live task.
// This is a WebView/JS race guard, NOT native execution authority or a
// substitute for Rust UUID auditing and owner approval.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function captureNativeActionOwnership(scope,graph,ownerRequest,actionId,allowRevoked=false){
 if(!obj(scope)||!UUID.test(scope.taskId)||(!allowRevoked&&scope.revoked===true)||
    !(graph===null||obj(graph))||
    !(ownerRequest===null||(typeof ownerRequest==="string"&&ownerRequest.length<=2500))||
    !UUID.test(actionId))return null;
 return Object.freeze({scope,taskId:scope.taskId,graph,ownerRequest,actionId});
}
export function isNativeActionOwnershipCurrent(lease,current,allowRevoked=false,allowAuditedTerminal=false){
 if(!obj(lease)||!obj(current)||!obj(current.scope)||
    current.scope!==lease.scope||current.scope.taskId!==lease.taskId||
    (!allowRevoked&&current.scope.revoked===true)||
    current.graph!==lease.graph||current.ownerRequest!==lease.ownerRequest||
    current.actionId!==lease.actionId||
    current.cancelRequested!==false||
    (allowAuditedTerminal
      ? !["normal","replan_required","stopped"].includes(current.recoveryMode)
      : current.recoveryMode!=="normal")||
    !UUID.test(lease.taskId)||!UUID.test(lease.actionId))return false;
 return true;
}
