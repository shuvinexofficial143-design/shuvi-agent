export type NativeRecoveryFields={maxActions:number;stagedActions:number;modelRequests:number;expiresAt:number;updatedAt:number;phase:string;actionId:string|null};
export type NativeRecoveryRecord=(NativeRecoveryFields&{version:1;updatedAt:number})|(NativeRecoveryFields&{version:2;taskId:string;revision?:number;updatedAt:number});
export type NativeRecoveryWrite=(NativeRecoveryFields&{version?:1})|(NativeRecoveryFields&{version:2;taskId:string;revision?:number});
export declare const NATIVE_JOURNAL_KEY:string;
export declare function readNativeRecovery(store:Storage|null,now?:number):NativeRecoveryRecord|null;
export declare function writeNativeRecovery(store:Storage|null,record:NativeRecoveryWrite,now?:number):boolean;
export declare function clearNativeRecovery(store:Storage|null):boolean;
export declare function validateNativeRecoveryRecord(record:unknown,now?:number):NativeRecoveryRecord|null;

export type NativeRecoveryInspection={kind:"empty"|"valid"|"invalid"|"unavailable";record:NativeRecoveryRecord|null};
export type NativeRecoveryAssessment={requiresReview:boolean;reason:"invalid_webview"|"missing_webview"|"missing_rust"|"invalid_rust"|"mismatched_stores"|"matched_previous_task"|"no_previous_task"};
export declare function inspectNativeRecoveryStore(store:Storage|null,now?:number):NativeRecoveryInspection;
export declare function assessNativeRecoveryPair(webview:NativeRecoveryInspection,rust:unknown,now?:number):NativeRecoveryAssessment;
