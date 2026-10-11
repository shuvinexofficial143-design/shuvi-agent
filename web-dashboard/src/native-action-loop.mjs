// Bounded duplicate-guard for the native Master. This module only compares
// proposed actions; it never chooses a tool, authorizes an action or executes it.
const READ_ONLY_UI=new Set(["ui_windows","ui_find","ui_discover"]);
const AUDITED_UI_CHANGES=new Set([
 "premiere_launch","launch_app","ui_click","ui_set_value",
 "ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse"
]);
function canonical(value,depth=0){
 if(depth>12)throw Error("nested proposal too deep");
 if(value===null||typeof value==="string"||typeof value==="boolean")return value;
 if(typeof value==="number"&&Number.isFinite(value))return value;
 if(Array.isArray(value)){
  if(value.length>300)throw Error("oversized proposal array");
  return value.map(item=>canonical(item,depth+1));
 }
 if(value&&typeof value==="object"){
  if(Object.keys(value).length>120)throw Error("oversized proposal object");
  if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
   throw Error("unsupported proposal value");
  const out={};
  for(const key of Object.keys(value).sort()){
   if(key==="__proto__"||key==="constructor"||key==="prototype")throw Error("unsafe proposal key");
   Object.defineProperty(out,key,{value:canonical(value[key],depth+1),
    writable:true,enumerable:true,configurable:true});
  }
  return out;
 }
 throw Error("unsupported proposal value");
}
export function actionFingerprint(proposal){
 try{
  if(!proposal||typeof proposal!=="object"||Array.isArray(proposal)||
   typeof proposal.tool!=="string"||!/^[a-z][a-z0-9_]{0,79}$/.test(proposal.tool))
   return null;
  if(proposal.arguments!==undefined&&(!proposal.arguments||typeof proposal.arguments!=="object"||
   Array.isArray(proposal.arguments)))return null;
  const json=JSON.stringify({tool:proposal.tool,arguments:canonical(proposal.arguments??{})});
  return json.length<=16000?json:null;
 }catch{return null;}
}
// Re-observing the same window after a successfully audited UI mutation can
// be necessary to verify effect. Never reset on a model assertion, failed
// result, read-only tool or unrecognized tool. Mutations remain remembered.
export function seenAfterAuditedChange(seen,verifiedTool,hasExactSuccessfulAudit=false){
 if(!(seen instanceof Set)||hasExactSuccessfulAudit!==true||
  !AUDITED_UI_CHANGES.has(verifiedTool))return seen;
 return new Set([...seen].filter(fp=>{
  if(typeof fp!=="string")return true;
  try{return !READ_ONLY_UI.has(JSON.parse(fp).tool);}catch{return true;}
 }));
}
export function actionLoopGuidance(){
 return "Avoid planning loops: an identical action proposal with reordered JSON arguments "+
  "is still the same action. Do not repeat an unchanged UI inspection or selector "+
  "without verified intervening UI change. After an audited UI mutation, request a newly approved ui_windows read before another UI mutation. Inspect "+
  "the new observed state if needed; a tool call or click alone is not task completion. "+
  "Ask for clarification when progress cannot be grounded. No extra paid retries or "+
  "unapproved actions.";
}
