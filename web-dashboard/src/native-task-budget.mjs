// Per-native-dashboard task guard. Owner-selected limits are in-memory; they
// never claim to be crash-durable, and tasks are NOT auto-resumed after restart.
const ALLOWED=new Set([8,24,48]);
const MAX_AGE_MS=2*60*60*1000;
export function createNativeTaskBudget(actions,now=Date.now()){
 if(!ALLOWED.has(actions)||!Number.isSafeInteger(now)||now<=0||now>Number.MAX_SAFE_INTEGER-MAX_AGE_MS)return null;
 return {maxActions:actions,expiresAt:now+MAX_AGE_MS,modelRequests:0,stagedActions:0};
}
function valid(state,now){
 return !!state&&ALLOWED.has(state.maxActions)&&Number.isSafeInteger(state.expiresAt)&&
 Number.isSafeInteger(now)&&now>0&&now<state.expiresAt&&
 state.expiresAt<=now+MAX_AGE_MS&&Number.isSafeInteger(state.modelRequests)&&
 state.modelRequests>=0&&state.modelRequests<=state.maxActions+1&&Number.isSafeInteger(state.stagedActions)&&
 state.stagedActions>=0&&state.stagedActions<=state.maxActions;
}
export function reserveNativeModelRequest(state,now=Date.now()){
 if(!valid(state,now)||state.modelRequests>=state.maxActions+1)return false;
 state.modelRequests+=1;
 return true;
}
export function canStageNativeAction(state,now=Date.now()){
 return valid(state,now)&&state.stagedActions<state.maxActions;
}
export function canExecuteNativeAction(state,now=Date.now()){
 return valid(state,now)&&state.stagedActions>0;
}
export function markNativeActionStaged(state,now=Date.now()){
 if(!canStageNativeAction(state,now))return false;
 state.stagedActions+=1;
 return true;
}
