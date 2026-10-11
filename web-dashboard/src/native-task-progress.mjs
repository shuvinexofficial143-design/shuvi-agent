// Ephemeral progress only; the native Rust action audit owns authorization.
export const createTask=()=>({phase:"planning",verified:0,tools:[],pending:null,reason:null});
const valid=x=>typeof x==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(x);
export function stageTask(s,id,tool,step){
 if(!s||s.pending||!["planning","paused"].includes(s.phase)||
  typeof id!=="string"||!id||id.length>128||!valid(tool)||
  !Number.isSafeInteger(step)||step<1)return s;
 return {...s,phase:"awaiting_approval",pending:{id,tool,step},reason:null};
}
export function executeTask(s,id){
 return s?.phase==="awaiting_approval"&&s.pending?.id===id?{...s,phase:"executing"}:s;
}
export function verifyTask(s,id,tool,audited){
 if(!s||s.phase!=="executing"||s.pending?.id!==id||s.pending.tool!==tool||audited!==true)return s;
 return {...s,phase:"planning",verified:s.verified+1,tools:[...s.tools,tool].slice(-8),pending:null,reason:null};
}
export function pauseTask(s,reason){
 if(!s)return s;
 const reasons=["denied","unknown_outcome","confirmed_read_failure","model_failed","prepare_failed","no_next_tool","repeated_tool","no_tool"];
 return {...s,phase:"paused",pending:null,reason:reasons.includes(reason)?reason:"unknown_outcome"};
}
export function taskSummary(s){
 if(!s)return "No active Windows task.";
 const next=s.pending?" · Step "+s.pending.step+" "+s.pending.tool+
  (s.phase==="executing"?" executing":" awaiting Allow once"):"";
 const stop=s.phase==="paused"?" · Paused ("+s.reason+"):"";
 return s.verified+" audited native step(s)"+next+stop+" · Overall task unverified.";
}
export function taskContext(s){
 return s?s.verified+" audited native step(s). Verified tools: "+
  (s.tools.join(", ")||"none")+". Steps are not overall task completion.":"No audited step evidence.";
}
