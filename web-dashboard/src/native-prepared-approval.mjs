// Prepared native action metadata is owner-facing permission information.
// Empty or arbitrarily long summaries can obscure what an Allow once permits.
export function validPreparedApproval(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 for(const [key,limit] of [["summary",700],["detail",2400],["risk",300]]){
  const v=value[key];
  if(typeof v!=="string"||!v.trim()||v.length>limit)return false;
 }
 return true;
}
