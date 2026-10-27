// Owner-facing metadata bound to an exact Rust-prepared native action.
// Never forward arbitrary command, file content, prompts, or credential text.
const safe=(s,max)=>typeof s==="string"&&s.trim()===s&&s.length>0&&s.length<=max&&
 !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(s);
export function remoteApprovalDisclosure(prepared,proposal){
 if(!prepared||!proposal||typeof proposal!=="object"||
  !safe(prepared.id,96)||!/^[a-zA-Z0-9_-]{16,96}$/.test(prepared.id)||
  prepared.kind!==proposal.tool||!safe(prepared.kind,70)||
  !/^[a-z][a-z0-9_]{1,69}$/.test(prepared.kind)||
  !["low","medium","high"].includes(prepared.risk)||
  !safe(prepared.summary,240))return null;
 const args=proposal.arguments;
 if(!args||typeof args!=="object"||Array.isArray(args))return null;
 if(["powershell","execute_powershell","run_command","browser_eval"].includes(prepared.kind))return null;
 let target=null;
 for(const key of ["window","path","file_path","program","application","pid","target"]){
  if(Object.prototype.hasOwnProperty.call(args,key)){
   const v=args[key];
   if((typeof v==="string"&&safe(v,260))||(typeof v==="number"&&Number.isSafeInteger(v)&&v>0))
    target=key+": "+String(v);
   else return null;
   break;
  }
 }
 if(!target&&["list_processes","ui_windows","runtime_status","browser_list_sessions"].includes(prepared.kind))
  target="System inspection (no specific application/file)";
 return target&&safe(target,320)
  ?{id:prepared.id,tool:prepared.kind,risk:prepared.risk,summary:prepared.summary,target}
  :null;
}
