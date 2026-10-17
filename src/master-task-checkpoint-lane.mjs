// Shuvi 37 — one WebView's bounded native checkpoint IPC lane.
// Reject stale, queued owner-task calls and serialize *all* dispatched saves
// and clears. Once Rust IPC has started this cannot cancel its disk effects;
// serialization ensures a NEW task's queued write follows an OLD in-flight
// write/clear rather than being overtaken by it. Cross-process/Rust fencing
// still requires a separately approved native integration.
export function createTaskCheckpointLane(){
 let tail=Promise.resolve();
 function enqueue(stillCurrent,action){
  if(typeof stillCurrent!=="function"||typeof action!=="function")
   return Promise.reject(new TypeError("Checkpoint lane requires a live-task check and native operation."));
  const pending=tail.then(async()=>{
   // A rotated owner task is never allowed to publish a queued old snapshot.
   if(stillCurrent()!==true)return false;
   await action();
   return true;
  });
  // Never poison subsequent native writes when the previous IPC rejects.
  tail=pending.then(()=>{},()=>{});
  return pending;
 }
 return Object.freeze({enqueue});
}
