// Shuvi37: an outbound mobile inbox reply is scoped to the exact local
// permission task and remote task object that requested it. Remote server
// receipts, Rust action approval and cancellation remain independent authority.
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function captureRemoteInboxOwner(scope,owner,task){
 if(!obj(scope)||typeof scope.taskId!=="string"||!scope.taskId.trim()||
    !(owner===null||(typeof owner==="string"&&owner.length<=2500))||
    !(task===null||obj(task)))return null;
 return Object.freeze({scope,taskId:scope.taskId,owner,task});
}
export function isRemoteInboxOwnerCurrent(c,current){
 return Boolean(obj(c)&&obj(current)&&obj(current.scope)&&
    current.scope===c.scope&&current.scope.taskId===c.taskId&&
    current.owner===c.owner&&current.task===c.task&&
    current.enabled===true);
}
