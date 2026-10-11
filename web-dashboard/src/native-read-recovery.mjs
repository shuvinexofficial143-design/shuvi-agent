// Read-only UI recovery requires observed failure plus the EXACT native failed
// action audit receipt. This policy never stages or executes a tool itself.
const UI_READ_TOOLS=new Set(["ui_find","ui_discover"]);
const UI_LOOKUP_ERROR=/UI lookup failed:|UI discovery failed:|No matching UI element found|No matching controls|Requested top-level window was not found|Requested window not uniquely found|Ambiguous window identity/i;

export function isRecoverableUiReadFailure(kind, message){
 return UI_READ_TOOLS.has(kind)&&typeof message==="string"&&
  message.length>0&&message.length<=5000&&UI_LOOKUP_ERROR.test(message);
}
export function isAuditedUiReadFailure(kind, message, actionId, receipt, alreadyDiscovered=false){
 if(!isRecoverableUiReadFailure(kind,message)||alreadyDiscovered||
  typeof actionId!=="string"||!actionId)return false;
 return Boolean(receipt&&typeof receipt==="object"&&!Array.isArray(receipt)&&
  receipt.action_id===actionId&&receipt.tool===kind&&
  receipt.event==="failed"&&receipt.success===false);
}
