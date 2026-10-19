// Ephemeral progress only; the native Rust action audit owns authorization.
// Both packaged Shuvi UI surfaces share the same real worker/tool taxonomy.
import {workerForTool} from "../../src/master-worker-queue.mjs";
export const createTask=()=>({phase:"planning",verified:0,tools:[],usedActionIds:[],pending:null,reason:null});
const valid=x=>typeof x==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(x);
export function stageTask(s,id,tool,step){
 if(!s||s.pending||!["planning","paused"].includes(s.phase)||
  typeof id!=="string"||!id||id.length>128||!valid(tool)||
  s.usedActionIds?.includes(id)||
  !Number.isSafeInteger(step)||step<1)return s;
 return {...s,phase:"awaiting_approval",pending:{id,tool,step},reason:null};
}
export function executeTask(s,id){
 return s?.phase==="awaiting_approval"&&s.pending?.id===id?{...s,phase:"executing"}:s;
}
export function verifyTask(s,id,tool,audited){
 if(!s||s.phase!=="executing"||s.pending?.id!==id||s.pending.tool!==tool||audited!==true)return s;
 return {...s,phase:"planning",verified:s.verified+1,tools:[...s.tools,tool].slice(-8),
  usedActionIds:[...(s.usedActionIds??[]),id].slice(-48),pending:null,reason:null};
}
// A completed opening is narrower than a completed arbitrary Windows task.
export function completeAuditedOpening(s,appName="Premiere"){
 if(!s||s.phase!=="planning"||s.pending||s.verified<2||
    s.tools.at(-1)!=="ui_windows"||(!s.tools.includes("premiere_launch")&&!s.tools.includes("launch_app")))return s;
 if(!["Premiere","Notepad"].includes(appName))return s;
 return {...s,phase:"window_verified",windowApp:appName,reason:null};
}
export function pauseTask(s,reason){
 if(!s)return s;
 const reasons=["denied","unknown_outcome","confirmed_read_failure","model_failed","prepare_failed","no_next_tool","repeated_tool","no_tool","awaiting_clarification","context_limit_exceeded"];
 return {...s,phase:"paused",pending:null,reason:reasons.includes(reason)?reason:"unknown_outcome"};
}
export function taskSummary(s){
 if(!s)return "No active Windows task.";
 const next=s.pending?" · Step "+s.pending.step+" "+s.pending.tool+
  (s.phase==="executing"?" executing":" awaiting Allow once"):"";
 const stop=s.phase==="paused"?" · Paused ("+s.reason+")":"";
 if(s.phase==="window_verified")return s.verified+" audited native step(s) · Requested "+(s.windowApp??"Premiere")+" window opening VERIFIED at last inspection; project/edit/export NOT verified.";
 return s.verified+" audited native step(s)"+next+stop+
  (s.pending?" · Worker lane: "+workerForTool(s.pending.tool):"")+
  " · Overall task unverified.";
}
export function taskContext(s){
 return s?s.verified+" audited native step(s). Verified tools: "+
  (s.tools.join(", ")||"none")+". Verified worker lanes: "+
  ([...new Set(s.tools.map(workerForTool))].join(", ")||"none")+
  ". Steps are not overall task completion.":"No audited step evidence.";
}
