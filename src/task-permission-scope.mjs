// The AI never grants permissions. Only an explicit local owner click does.
// This narrow in-memory permission is NOT the native Rust executor's authority.
const READ_TOOLS = new Set(["read_file","list_directory","ui_find","list_processes",
 "browser_dom_read","workspace_scan","search_text","git_status","git_diff",
 "premiere_bridge_status","premiere_context","premiere_list_items"]);
export const TASK_GRANT_TTL_MS=5*60*1000;
export function createTaskPermissionScope(taskId){
 if(typeof taskId!=="string"||!taskId.trim()||taskId.length>128)throw Error("Task ID required");
 return {taskId,grants:new Map(),revoked:false};
}
function valid(scope,grant){
 return scope&&scope.revoked!==true&&grant?.taskId===scope.taskId&&
  grant?.risk==="low"&&READ_TOOLS.has(grant.tool)&&
  typeof grant.key==="string"&&grant.key.startsWith(grant.tool+"|")&&
  grant.key.length>grant.tool.length+1&&grant.key.length<=4096;
}
export function grantTaskRead(scope,grant,now=Date.now()){
 if(!valid(scope,grant)||!Number.isFinite(now))return false;
 scope.grants.set(grant.key,now+TASK_GRANT_TTL_MS);
 return true;
}
export function allowsTaskRead(scope,grant,now=Date.now()){
 if(!valid(scope,grant)||!Number.isFinite(now))return false;
 const until=scope.grants.get(grant.key);
 if(!Number.isFinite(until)||now>=until){
  scope.grants.delete(grant.key);
  return false;
 }
 return true;
}
export function revokeTaskScope(scope){
 if(scope){scope.grants.clear();scope.revoked=true;}
}
