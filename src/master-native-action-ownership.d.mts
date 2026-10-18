export type NativeActionOwnerScope={taskId:string;revoked:boolean};
export type NativeActionOwnership=Readonly<{
 scope:NativeActionOwnerScope;taskId:string;graph:object|null;
 ownerRequest:string|null;actionId:string
}>;
export declare function captureNativeActionOwnership(
 scope:NativeActionOwnerScope|null|undefined,graph:object|null,
 ownerRequest:string|null,actionId:string,allowRevoked?:boolean
):NativeActionOwnership|null;
export declare function isNativeActionOwnershipCurrent(
 lease:NativeActionOwnership|null|undefined,
 current:{
  scope:NativeActionOwnerScope|null|undefined;graph:object|null;
  ownerRequest:string|null;actionId:string;
  cancelRequested:boolean;recoveryMode:string
 },allowRevoked?:boolean,allowAuditedTerminal?:boolean
):boolean;
