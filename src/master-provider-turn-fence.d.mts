export type MasterProviderTurnScope=Readonly<{taskId:string;revoked:boolean}>;
export type MasterProviderTurnFence=Readonly<{
 scope:MasterProviderTurnScope;taskId:string;graph:object|null;
 owner:string;nextStep:number;reserved:number;mode:string;
}>;
export declare function captureMasterProviderTurnFence(
 scope:MasterProviderTurnScope|null,graph:object|null,
 owner:string|null,nextStep:number,reserved:number,mode:string
):MasterProviderTurnFence|null;
export declare function isMasterProviderTurnFenceCurrent(
 fence:MasterProviderTurnFence|null,current:{
 scope:MasterProviderTurnScope;graph:object|null;owner:string|null;
 nextStep:number;reserved:number;mode:string;cancelRequested:boolean
 }
):boolean;
