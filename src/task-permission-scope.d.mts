export interface TaskPermissionScope {taskId:string;grants:Map<string,number>;revoked:boolean;}
export interface ScopedRead {taskId:string;tool:string;risk:string;key:string;}
export declare const TASK_GRANT_TTL_MS:number;
export declare function createTaskPermissionScope(taskId:string):TaskPermissionScope;
export declare function grantTaskRead(scope:TaskPermissionScope,grant:ScopedRead,now?:number):boolean;
export declare function allowsTaskRead(scope:TaskPermissionScope,grant:ScopedRead,now?:number):boolean;
export declare function revokeTaskScope(scope:TaskPermissionScope):void;
