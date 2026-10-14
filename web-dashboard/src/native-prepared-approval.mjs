// Prepared native action metadata is owner-facing permission information.
// Empty or arbitrarily long summaries can obscure what an Allow once permits.
export function validPreparedApproval(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 for(const [key,limit] of [["summary",700],["detail",2400],["risk",300]]){
  const v=value[key];
  // Invisible direction marks or control codes can disguise the permission
  // being approved. Ordinary tab/newline formatting remains allowed.
  if(typeof v!=="string"||!v.trim()||v.length>limit||
   /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(v))return false;
 }
 return true;
}
