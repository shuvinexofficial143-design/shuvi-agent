export type RemoteInboxScope=Readonly<{taskId:string}>;
export type RemoteInboxOwner=Readonly<{
 scope:RemoteInboxScope;taskId:string;owner:string|null;task:object|null
}>;
export declare function captureRemoteInboxOwner(scope:RemoteInboxScope|null,
 owner:string|null,task:object|null):RemoteInboxOwner|null;
export declare function isRemoteInboxOwnerCurrent(lease:RemoteInboxOwner|null,
 current:{scope:RemoteInboxScope|null;owner:string|null;task:object|null;enabled:boolean}):boolean;
