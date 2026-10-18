// Shuvi 37: one in-flight paid provider dispatch per Desktop WebView.
// Acquired BEFORE budget reservation and strict native checkpoint readback.
// This prevents concurrent paid requests. A completed provider HTTP response
// frees its lane before audited native continuation, which can re-enter.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createMasterProviderSingleFlight(){
 let active=null;
 return Object.freeze({
  acquire(scope){
   if(active!==null||!scope||typeof scope!=="object"||
     !UUID.test(scope.taskId)||scope.revoked!==false)return null;
   const claim=Object.freeze({scope,taskId:scope.taskId});
   active=claim;
   let released=false;
   return Object.freeze({
    release(){
     if(released||active!==claim)return false;
     released=true;active=null;return true;
    }
   });
  }
 });
}
