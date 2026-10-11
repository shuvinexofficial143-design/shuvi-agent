// Native audit verification: tie success to the exact approved action AND
// the prepared tool identity; contradictory records fail closed.
export function verifiedExecutionReceipt(prepared,result,receipts){
 if(!prepared||typeof prepared.id!=="string"||!prepared.id||
  typeof prepared.kind!=="string"||!prepared.kind||
  result?.success!==true||result.tool!==prepared.kind||
  (result.exit_code!=null&&(!Number.isSafeInteger(result.exit_code)||result.exit_code!==0))||
  !Array.isArray(receipts))return false;
 const same=receipts.filter(r=>r?.action_id===prepared.id);
 if(!same.length)return false;
 // Rust logs may also include normal prepared/approved bookkeeping for
 // the same approved action. Only contradictory terminal outcomes fail closed.
 if(same.some(r=>r.tool!==prepared.kind||
  r.event==="failed"||r.event==="denied"||
  r.event==="executed"&&r.success!==true))return false;
 return same.some(r=>r.tool===prepared.kind&&r.event==="executed"&&r.success===true);
}
export function contradictsFailureReceipt(prepared,receipts){
 if(!prepared||typeof prepared.id!=="string"||!Array.isArray(receipts))return true;
 return receipts.some(r=>r?.action_id===prepared.id&&
  (r.tool!==prepared.kind||r.event==="denied"||r.event==="executed"));
}
