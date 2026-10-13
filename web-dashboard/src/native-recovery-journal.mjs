// Recoverable inspection metadata only, NEVER permission to run an old action.
export const NATIVE_JOURNAL_KEY="shuvi.native.task.recovery.v1";
const ACTIONS=new Set([8,24,48]);
const PHASES=new Set(["model_reserved","awaiting_approval","audit_verified","paused","outcome_unknown","executing"]);
const ACTION_ID=/^[A-Za-z0-9_-]{1,128}$/;
const TASK_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_AGE=7200000;
function normalize(record,now){
 if(!record||typeof record!=="object"||Array.isArray(record)||![1,2].includes(record.version))return null;
 // v1 is historical inspection evidence. Only v2 binds the persisted state
 // to a uniquely generated task identity; never fabricate one for v1.
 if(record.version===1&&(record.taskId!==undefined||record.revision!==undefined))return null;
 if(record.version===2&&(typeof record.taskId!=="string"||!TASK_ID.test(record.taskId)))return null;
 // Historical v2 can be read for owner inspection. Only new runtime writes
 // carry a positive revision, so ordered writes cannot be silently replayed.
 if(record.version===2&&record.revision!==undefined&&
  (!Number.isSafeInteger(record.revision)||record.revision<1))return null;
 if(!ACTIONS.has(record.maxActions)||!PHASES.has(record.phase))return null;
 const {stagedActions,modelRequests,expiresAt,updatedAt,actionId}=record;
 if(!Number.isSafeInteger(stagedActions)||stagedActions<0||stagedActions>record.maxActions)return null;
 if(!Number.isSafeInteger(modelRequests)||modelRequests<0||modelRequests>record.maxActions+1)return null;
 if(!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(updatedAt)||updatedAt<=0)return null;
 if(!Number.isSafeInteger(now)||now<=0||updatedAt>now+60000||expiresAt>updatedAt+MAX_AGE)return null;
 if(actionId!==null&&(typeof actionId!=="string"||!ACTION_ID.test(actionId)))return null;
 return {version:record.version,
  ...(record.version===2?{taskId:record.taskId,...(record.revision!==undefined?{revision:record.revision}:{})}:{}),
  maxActions:record.maxActions,stagedActions,modelRequests,expiresAt,updatedAt,phase:record.phase,actionId};
}
export function readNativeRecovery(store,now=Date.now()){
 if(!store)return null;
 try{const raw=store.getItem(NATIVE_JOURNAL_KEY);return !raw||raw.length>1800?null:normalize(JSON.parse(raw),now);}
 catch{return null;}
}
export function writeNativeRecovery(store,record,now=Date.now()){
 if(!store||!Number.isSafeInteger(now)||now<=0)return false;
 const safe=normalize({version:1,...record,updatedAt:now},now);
 if(!safe)return false;
 try{store.setItem(NATIVE_JOURNAL_KEY,JSON.stringify(safe));return true;}catch{return false;}
}
export function clearNativeRecovery(store){
 if(!store)return false;
 try{store.removeItem(NATIVE_JOURNAL_KEY);return true;}catch{return false;}
}

// Validate an independent Rust snapshot before showing it as crash evidence.
// It can never grant an executable task capability.
export function validateNativeRecoveryRecord(record,now=Date.now()){
 return normalize(record,now);
}


// Do not erase the distinction between an empty journal and one that exists
// but cannot be decoded. On startup, silently treating corruption as "none"
// would permit a new Windows task to overwrite unresolved execution evidence.
export function inspectNativeRecoveryStore(store,now=Date.now()){
 if(!store)return {kind:"unavailable",record:null};
 try{
  const raw=store.getItem(NATIVE_JOURNAL_KEY);
  if(raw===null)return {kind:"empty",record:null};
  if(raw.length>1800)return {kind:"invalid",record:null};
  const record=normalize(JSON.parse(raw),now);
  return record?{kind:"valid",record}:{kind:"invalid",record:null};
 }catch{return {kind:"invalid",record:null};}
}

// Both stores are independent inspection evidence; neither restores task
// authority. Any old record needs owner acknowledgement, including "paused"
// and "audit_verified": an audited action is not a completed user objective.
// Compare action/counters/phase but not updatedAt; the Rust fsync timestamp
// legitimately differs from the WebView timestamp for the same checkpoint.
export function assessNativeRecoveryPair(webview,rust,now=Date.now()){
 const decision=(reason)=>({requiresReview:reason!=="no_previous_task",reason});
 if(!webview||webview.kind==="invalid"||webview.kind==="unavailable")
  return decision("invalid_webview");
 if(webview.kind==="empty")
  return decision(rust===null?"no_previous_task":"missing_webview");
 if(webview.kind!=="valid")return decision("invalid_webview");
 const local=normalize(webview.record,now);
 if(!local)return decision("invalid_webview");
 if(rust===null)return decision("missing_rust");
 const native=normalize(rust,now);
 if(!native)return decision("invalid_rust");
 const fields=["version","taskId","revision","maxActions","stagedActions","modelRequests","expiresAt","phase","actionId"];
 if(fields.some(field=>local[field]!==native[field]))return decision("mismatched_stores");
 return decision("matched_previous_task");
}
