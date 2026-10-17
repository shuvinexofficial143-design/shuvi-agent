// Shuvi 37 — serialized, owner-object-bound remote task receipt publication.
// Never call native IPC for a queued stale task; never let an old IPC reply
// update the new task's revision, status or approval state.
export function createMasterRemoteReceiptLane(){
 let tail=Promise.resolve();
 function publish(task,isCurrent,send,status){
  if(!task||typeof task!=="object"||
    !Number.isSafeInteger(task.revision)||task.revision<0||
    !["admitted","running","requires_approval","succeeded","failed","stopped","outcome_unknown"].includes(status)||
    typeof isCurrent!=="function"||typeof send!=="function")
   return Promise.reject(new TypeError("Remote task receipt identity is invalid."));
  const op=tail.then(async()=>{
   if(isCurrent(task)!==true)return false;
   const previous=task.revision;
   if(previous>=Number.MAX_SAFE_INTEGER-1)
    throw Error("Remote task revision budget exhausted");
   await send(previous+1);
   if(isCurrent(task)!==true||task.revision!==previous)return false;
   task.revision=previous+1;
   task.status=status;
   return true;
  });
  tail=op.then(()=>{},()=>{});
  return op;
 }
 return Object.freeze({publish});
}
