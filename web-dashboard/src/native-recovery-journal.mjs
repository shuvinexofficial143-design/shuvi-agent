// Recoverable inspection metadata only, NEVER permission to run an old action.
export const NATIVE_JOURNAL_KEY="shuvi.native.task.recovery.v1";
const ACTIONS=new Set([8,24,48]);
const PHASES=new Set(["model_reserved","awaiting_approval","audit_verified","paused","outcome_unknown","executing"]);
const ACTION_ID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_AGE=7200000;
function normalize(record,now){
 if(!record||typeof record!=="object"||Array.isArray(record)||record.version!==1)return null;
 if(!ACTIONS.has(record.maxActions)||!PHASES.has(record.phase))return null;
 const {stagedActions,modelRequests,expiresAt,updatedAt,actionId}=record;
 if(!Number.isSafeInteger(stagedActions)||stagedActions<0||stagedActions>record.maxActions)return null;
 if(!Number.isSafeInteger(modelRequests)||modelRequests<0||modelRequests>record.maxActions+1)return null;
 if(!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(updatedAt)||updatedAt<=0)return null;
 if(!Number.isSafeInteger(now)||now<=0||updatedAt>now+60000||expiresAt>updatedAt+MAX_AGE)return null;
 if(actionId!==null&&(typeof actionId!=="string"||!ACTION_ID.test(actionId)))return null;
 return {version:1,maxActions:record.maxActions,stagedActions,modelRequests,expiresAt,updatedAt,phase:record.phase,actionId};
}
export function readNativeRecovery(store,now=Date.now()){
 if(!store)return null;
 try{const raw=store.getItem(NATIVE_JOURNAL_KEY);return !raw||raw.length>1800?null:normalize(JSON.parse(raw),now);}
 catch{return null;}
}
export function writeNativeRecovery(store,record,now=Date.now()){
 if(!store||!Number.isSafeInteger(now)||now<=0)return false;
 const safe=normalize({version:1,updatedAt:now,...record},now);
 if(!safe)return false;
 try{store.setItem(NATIVE_JOURNAL_KEY,JSON.stringify(safe));return true;}catch{return false;}
}
export function clearNativeRecovery(store){
 if(!store)return false;
 try{store.removeItem(NATIVE_JOURNAL_KEY);return true;}catch{return false;}
}
