// Native audit verification: tie success to the exact approved action AND
// the prepared tool identity; contradictory records fail closed.
export function verifiedExecutionReceipt(prepared,result,receipts){
 if(!prepared||typeof prepared.id!=="string"||!prepared.id.trim()||prepared.id.length>128||
  typeof prepared.kind!=="string"||!prepared.kind||
  result?.success!==true||result.tool!==prepared.kind||
  (result.exit_code!=null&&(!Number.isSafeInteger(result.exit_code)||result.exit_code!==0))||
  !Array.isArray(receipts))return false;
 const same=receipts.filter(r=>r?.action_id===prepared.id);
 if(!same.length)return false;
 // Rust logs may also include normal prepared/approved bookkeeping for
 // the same approved action. Only contradictory terminal outcomes fail closed.
 if(same.some(r=>r.tool!==prepared.kind||
  !["prepared","approved","executed"].includes(r.event)||
  (r.event==="prepared"||r.event==="approved")&&r.success!==true||
  r.event==="executed"&&r.success!==true))return false;
 return same.some(r=>r.tool===prepared.kind&&r.event==="executed"&&r.success===true);
}
export function contradictsFailureReceipt(prepared,receipts){
 if(!prepared||typeof prepared.id!=="string"||!prepared.id.trim()||prepared.id.length>128||
  typeof prepared.kind!=="string"||!prepared.kind.trim()||!Array.isArray(receipts))return true;
 return receipts.some(r=>r?.action_id===prepared.id&&
  (r.tool!==prepared.kind||
  !["prepared","approved","failed"].includes(r.event)||
  ((r.event==="prepared"||r.event==="approved")&&r.success!==true)||
  (r.event==="failed"&&r.success!==false)));
}


// P0: Exact Rust action trace, not the last 200 global audit entries. A
// matching UUID alone is not success: the typed result, terminal audit and
// current worker journal (when it refers to this action) must agree.
// All branches are diagnostic only; none reissues an OS action.
const TERMINALS=new Set(["executed","failed","denied","outcome_unknown"]);
const SAFE_READS=new Set(["ui_windows","ui_discover","ui_find","premiere_bridge_status","premiere_context"]);
export function diagnoseNativeAction(prepared,result,trace,worker=null){
 const id=prepared?.id, tool=prepared?.kind;
 const base={actionId:typeof id==="string"?id:null,tool:typeof tool==="string"?tool:null,
   safeRead:SAFE_READS.has(tool),replayAllowed:false};
 const outcome=(kind,reason)=>({...base,kind,reason});
 if(typeof id!=="string"||!id.trim()||id.length>128||
    typeof tool!=="string"||!/^[a-z][a-z0-9_]*$/.test(tool))
   return outcome("identity_mismatch","तैयार Action UUID या Tool अमान्य है।");
 if(!Array.isArray(trace))
   return outcome("missing_audit","इस Action का Rust Audit पढ़ा नहीं जा सका।");
 const same=trace.filter(r=>r?.action_id===id);
 if(trace.some(r=>r?.action_id!==id)||same.some(r=>r.tool!==tool))
   return outcome("identity_mismatch","Rust Audit का Action UUID या Tool अलग है।");
 const terminal=same.filter(r=>TERMINALS.has(r.event));
 if(terminal.length===0)
   return outcome("missing_audit","Rust Audit में इस Action की अंतिम Receipt नहीं मिली।");
 if(terminal.length!==1||same.some(r=>!TERMINALS.has(r.event)&&
      !["prepared","approved"].includes(r.event)))
   return outcome("audit_conflict","एक ही Action पर विरोधी या दोहरी Rust Audit Entries मिलीं।");
 const receipt=terminal[0];
 if(worker&&typeof worker==="object"&&
    (worker.durableJobActionId===id||worker.actionId===id)){
   const wid=worker.durableJobActionId===id?worker.durableJobTool:worker.tool;
   const phase=worker.durableJobActionId===id?worker.durableJobPhase:worker.state;
   if(wid&&wid!==tool)return outcome("identity_mismatch","Worker का Tool, Rust Audit Tool से मेल नहीं खाता।");
   if(phase==="outcome_unknown"||phase==="running")
     return outcome("worker_unresolved","Worker का परिणाम अभी अनिश्चित है; दोबारा नहीं चलाया गया।");
   if(phase==="audit_verified"&&worker.auditSuccess===false&&receipt.event==="executed")
     return outcome("worker_failure","Worker और Audit की Success स्थिति अलग है।");
 }
 if(receipt.event==="outcome_unknown")
   return outcome("worker_unresolved","Rust ने Worker/External Action को UNKNOWN दर्ज किया है।");
 if(receipt.event==="denied")
   return outcome("denied","इस Action को Owner या Rust ने अनुमति नहीं दी।");
 if(receipt.event==="failed")
   return outcome("worker_failure","Rust Audit में Action FAILED दर्ज है; Effect की जाँच जरूरी हो सकती है।");
 if(receipt.event!=="executed"||receipt.success!==true)
   return outcome("readback_failed","Native Execution का सफल Readback नहीं मिला।");
 if(!result)
   return outcome("verified_audit_only","Rust Audit सफल है, लेकिन App Result उपलब्ध नहीं है; Editing की पुष्टि नहीं हुई।");
 if(result.tool!==tool)
   return outcome("identity_mismatch","Worker Result का Tool, तैयार Action से अलग है।");
 if(result.success!==true||
    (result.exit_code!=null&&(!Number.isSafeInteger(result.exit_code)||result.exit_code!==0)))
   return outcome("readback_failed","Rust Audit सफल है, लेकिन लौटे Worker Result में Error/Exit Code है।");
 return outcome("verified","Rust Audit, Action UUID, Tool और Worker Result मेल खाते हैं।");
}
