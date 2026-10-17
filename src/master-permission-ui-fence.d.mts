export type PermissionUiScope=Readonly<{taskId:string;revoked:boolean}>;
export type PermissionUiFence=Readonly<{
 scope:PermissionUiScope;taskId:string;graph:object|null;owner:string|null;
 pending:{id:string};actionId:string;proposal:object;remote:object|null;
}>;
export declare function captureMasterPermissionUiFence(
 scope:PermissionUiScope|null,graph:object|null,owner:string|null,
 pending:{id:string}|null,proposal:object,remote:object|null
):PermissionUiFence|null;
export declare function isMasterPermissionUiFenceCurrent(
 fence:PermissionUiFence|null,state:{
 scope:PermissionUiScope|null;graph:object|null;owner:string|null;
 pending:{id:string}|null;proposal:object|null;remote:object|null;
 cancelRequested:boolean;mode:string
 }
):boolean;
