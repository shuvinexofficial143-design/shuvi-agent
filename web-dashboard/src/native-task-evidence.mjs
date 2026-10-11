// Per-thread evidence of audit-verified native tool steps; NEVER claim goal completion.
const READS=new Set(["ui_windows","ui_discover","ui_find"]);
export const newEvidence=()=>({audited:0,observations:[],lastTool:null});
export function recordAuditedEvidence(state,id,result,audited){
 if(!state||audited!==true||result?.success!==true||
  typeof id!=="string"||!id||id.length>128||
  typeof result.tool!=="string"||!/^[a-z][a-z0-9_]{0,79}$/.test(result.tool))return state;
 if(state.observations.some(x=>x.id===id))return state;
 return {audited:state.audited+1,lastTool:result.tool,
  observations:[...state.observations,{
   id,tool:result.tool,kind:READS.has(result.tool)?"read_only":"tool_execution"
  }].slice(-12)};
}
export function evidenceSummary(state){
 if(!state)return "No audited native evidence; overall goal unverified.";
 const recent=state.observations.slice(-5).map(x=>x.tool+" ("+x.kind+")").join(", ");
 return state.audited+" audited native action(s). Recent: "+(recent||"none")+
  ". Overall application/task goals NOT independently verified.";
}
