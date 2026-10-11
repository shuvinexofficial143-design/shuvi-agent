export type NativeRecoveryRecord={version:1;maxActions:number;stagedActions:number;modelRequests:number;expiresAt:number;updatedAt:number;phase:string;actionId:string|null};
export declare const NATIVE_JOURNAL_KEY:string;
export declare function readNativeRecovery(store:Storage|null,now?:number):NativeRecoveryRecord|null;
export declare function writeNativeRecovery(store:Storage|null,record:Omit<NativeRecoveryRecord,"version"|"updatedAt">,now?:number):boolean;
export declare function clearNativeRecovery(store:Storage|null):boolean;
