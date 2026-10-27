export declare function verifiedExecutionReceipt(prepared:{id:string;kind:string},result:{success:boolean;tool:string},receipts:unknown):boolean;
export declare function contradictsFailureReceipt(prepared:{id:string;kind:string},receipts:unknown):boolean;

export function diagnoseNativeAction(prepared:unknown,result:unknown,trace:unknown,worker?:unknown):{
 actionId:string|null;tool:string|null;safeRead:boolean;replayAllowed:false;
 kind:"identity_mismatch"|"missing_audit"|"audit_conflict"|"worker_unresolved"|
 "worker_failure"|"denied"|"readback_failed"|"verified_audit_only"|"verified";
 reason:string;
};
