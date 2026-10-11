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
  typeof actionId!=="string"||!actionId.trim()||actionId.length>128)return false;
 return Boolean(receipt&&typeof receipt==="object"&&!Array.isArray(receipt)&&
  receipt.action_id===actionId&&receipt.tool===kind&&
  receipt.event==="failed"&&receipt.success===false);
}


// A failed UI read is only an obstacle, not an instruction to click another
// guessed button. This advice is offered AFTER a separately approved,
// successful ui_windows observation in the exact same native task.
export function uiReplanGuidance(previousFailedRead,verifiedObservationTool){
 if(!UI_READ_TOOLS.has(previousFailedRead)||verifiedObservationTool!=="ui_windows")return "";
 return "Recovery planning: an earlier "+previousFailedRead+
  " read-only lookup failed with an exact native failed audit receipt. "+
  "The separately approved ui_windows observation is now verified, but it does "+
  "NOT mean the missing control exists or that the original task is complete. "+
  "Use actual observed unique window/process identity. If the requested control "+
  "is not grounded, propose a separately approved ui_discover read in that "+
  "specific window, or ask for clarification when several windows/controls match. "+
  "Do not repeat the unsuccessful selector or blindly substitute similar labels; "+
  "never click, type, save or modify based only on a model guess.";
}
