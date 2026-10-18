// Shuvi 37 — compare a native Rust-reloaded durable checkpoint to the exact
// snapshot saved BEFORE a paid provider/tool continuation. This is evidence
// of a matching readback at ONE instant, NOT a cross-process transaction lock.
const MAX_JSON=2*1024*1024,MAX_DEPTH=80;
function comparableJSON(value){
 const seen=new Set();
 function visit(v,depth){
  if(depth>MAX_DEPTH)throw Error("Checkpoint nesting exceeded safe limit");
  if(v===null||typeof v==="string"||typeof v==="boolean")return v;
  if(typeof v==="number"){
   if(!Number.isFinite(v))throw Error("Non-finite checkpoint numeric value");
   return v;
  }
  if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
  if(!v||typeof v!=="object"||seen.has(v))throw Error("Invalid checkpoint object");
  const prototype=Object.getPrototypeOf(v);
  if(prototype!==Object.prototype&&prototype!==null)throw Error("Unserializable checkpoint object");
  seen.add(v);
  const output={};
  for(const k of Object.keys(v).sort()){
   if(k==="__proto__"||k==="constructor"||k==="prototype")
    throw Error("Checkpoint contains unsafe field");
   if(v[k]!==undefined)output[k]=visit(v[k],depth+1);
  }
  seen.delete(v);
  return output;
 }
 const str=JSON.stringify(visit(value,0));
 if(typeof str!=="string"||str.length>MAX_JSON)throw Error("Checkpoint readback exceeds bounded size");
 return str;
}
export function assessNativeCheckpointReadback(expected,observed){
 const fail=reason=>Object.freeze({verified:false,reason});
 if(!expected||!observed||typeof expected!=="object"||typeof observed!=="object"||
    Array.isArray(expected)||Array.isArray(observed))
  return fail("Native durable checkpoint was not readable.");
 if(expected.version!==2||observed.version!==2||
    !Number.isSafeInteger(expected.updated_at_ms)||expected.updated_at_ms<=0||
    expected.updated_at_ms!==observed.updated_at_ms)
  return fail("Native checkpoint schema or write generation does not match.");
 const e=expected.orchestration,o=observed.orchestration;
 if(!e||!o||e.version!==5||o.version!==5||
    e.owner_request!==o.owner_request||
    e.task_graph?.objective!==o.task_graph?.objective||
    e.task_graph?.revision!==o.task_graph?.revision||
    e.model_requests_reserved!==o.model_requests_reserved)
  return fail("Original task, DAG revision or model reservation was replaced.");
 try{
  if(comparableJSON(expected)!==comparableJSON(observed))
   return fail("Native checkpoint readback contents differ from the published snapshot.");
 }catch{
  return fail("Native checkpoint readback could not be safely compared.");
 }
 return Object.freeze({verified:true,reason:null});
}
