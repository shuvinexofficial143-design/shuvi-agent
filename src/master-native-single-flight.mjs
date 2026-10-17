// Shuvi37 — one native execution per Desktop WebView, even when owner
// double-clicks Allow Once or a remote decision repeats. This is only
// admission serialization: Rust prepared-action UUID+grant audits are final.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createMasterNativeSingleFlight(){
 let active=null;
 function acquire(scope,actionId){
  if(active!==null||!scope||typeof scope!=="object"||
     !UUID.test(scope.taskId)||scope.revoked!==false||!UUID.test(actionId))return null;
  const token=Object.freeze({scope,taskId:scope.taskId,actionId});
  active=token;let done=false;
  return Object.freeze({release(){
   if(done||active!==token)return false;
   done=true;active=null;return true;
  }});
 }
 return Object.freeze({acquire});
}
