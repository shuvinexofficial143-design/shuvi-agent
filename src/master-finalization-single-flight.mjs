// Shuvi 37 — one terminal native delivery verification per Desktop WebView.
// Only excludes duplicate concurrent finalization. Rust remains the source
// of all native audit/artifact proof, and this never grants an action.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function createMasterFinalizationSingleFlight(){
 let current=null;
 return Object.freeze({
  acquire(scope,graph,owner){
   if(current!==null||!object(scope)||!UUID.test(scope.taskId)||
      scope.revoked===true||!object(graph)||typeof owner!=="string"||
      owner.length<1||owner.length>2500)return null;
   const identity=Object.freeze({scope,taskId:scope.taskId,graph,owner});
   current=identity;let done=false;
   return Object.freeze({release(){
    if(done||current!==identity)return false;
    current=null;done=true;return true;
   }});
  }
 });
}
