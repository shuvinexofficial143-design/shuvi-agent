// Inspection only: never converts a recovered action into execution authority.
const ACTION_ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOOL=/^[a-z][a-z0-9_]{0,79}$/;
const EVENTS=new Set(["executed","failed","denied"]);
function valid(row,id){
 return row!==null&&typeof row==="object"&&!Array.isArray(row)&&row.action_id===id&&
  typeof row.tool==="string"&&TOOL.test(row.tool)&&
  EVENTS.has(row.event)&&typeof row.success==="boolean";
}
export function reconcileNativeActionAudit(id,receipt,trail){
 if(typeof id!=="string"||!ACTION_ID.test(id))return {kind:"unknown",tool:null};
 if(!valid(receipt,id)||!Array.isArray(trail)||trail.length>200)return {kind:"unknown",tool:null};
 const matches=trail.filter(item=>item?.action_id===id);
 if(matches.length!==1||!valid(matches[0],id))return {kind:"unknown",tool:null};
 const row=matches[0];
 if(row.tool!==receipt.tool||row.event!==receipt.event||row.success!==receipt.success)
  return {kind:"unknown",tool:null};
 if(row.event==="executed"&&row.success)return {kind:"executed_audited",tool:row.tool};
 if(row.event==="denied"&&!row.success)return {kind:"denied_audited",tool:row.tool};
 if(row.event==="failed"&&!row.success)return {kind:"failed_audited",tool:row.tool};
 return {kind:"unknown",tool:null};
}
export function recoveryAuditMessage(record){
 switch(record?.kind){
  case "executed_audited":return "Rust Audit confirms a successful action: "+record.tool+".";
  case "denied_audited":return "Rust Audit confirms the previous action was denied: "+record.tool+".";
  case "failed_audited":return "Rust Audit records a failed action: "+record.tool+". Side effects may still need review.";
  default:return "Previous action remains UNKNOWN: audit evidence is missing or conflicting.";
 }
}
