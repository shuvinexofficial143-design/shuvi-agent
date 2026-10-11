export type NativeAuditVerdict={kind:"unknown"|"executed_audited"|"denied_audited"|"failed_audited";tool:string|null};
export declare function reconcileNativeActionAudit(id:string,receipt:unknown,trail:unknown):NativeAuditVerdict;
export declare function recoveryAuditMessage(record:NativeAuditVerdict):string;
