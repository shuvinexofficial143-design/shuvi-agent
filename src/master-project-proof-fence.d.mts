export type NativeProjectProofScope={taskId:string;revoked:boolean};
export type NativeProjectProofFence=Readonly<{
 scope:NativeProjectProofScope;taskId:string;graph:object;
 ownerRequest:string;actionId:string;
}>;
export declare function captureNativeProjectProofFence(
 scope:NativeProjectProofScope|null|undefined,
 graph:object|null|undefined,
 ownerRequest:string|null|undefined,
 actionId:string
):NativeProjectProofFence|null;
export declare function isNativeProjectProofFenceCurrent(
 fence:NativeProjectProofFence|null|undefined,
 current:{
  scope:NativeProjectProofScope|null|undefined;
  graph:object|null|undefined;
  ownerRequest:string|null|undefined;
  actionId:string;cancelRequested:boolean;recoveryMode:string;
 }
):boolean;
