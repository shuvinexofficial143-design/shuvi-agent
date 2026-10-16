// A prepared UIA action that expires in Rust is a native DENIAL, not an
// unknown side effect. We accept this only when the exact Rust audit corroborates
// a non-executed denial: neither the model nor an error string is trusted alone.
const UIA_MUTATIONS=new Set([
 "ui_click","ui_set_value","ui_focus","ui_scroll","ui_toggle",
 "ui_expand_collapse","ui_send_keys"
]);
const RUST_EXPIRY="Prepared action expired before execution and must be prepared again.";

export function auditedNativeUiaExpiry(actionId,tool,error,auditRows){
 if(!UIA_MUTATIONS.has(tool)||
  typeof actionId!=="string"||!actionId||actionId.length>128||
  typeof error!=="string"||!error.includes(RUST_EXPIRY)||
  !Array.isArray(auditRows)||auditRows.length<1||auditRows.length>200)return false;
 const entries=auditRows.filter(x=>x&&x.action_id===actionId);
 if(!entries.length)return false;
 // UUID is never reused. Any native execution/unknown outcome for this exact
 // action overrides the seemingly harmless denied label.
 if(entries.some(x=>x.tool!==tool&&x.event!=="prepared"))return false;
 if(entries.some(x=>["executed","executing","started","failed","error"].includes(x.event)))
  return false;
 const denials=entries.filter(x=>x.event==="denied"&&x.tool===tool&&x.success===false);
 if(denials.length!==1)return false;
 return true;
}
