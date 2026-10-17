export type RemoteReceiptTask={revision:number;status:string};
export type RemoteReceiptLane=Readonly<{
 publish(task:RemoteReceiptTask,isCurrent:(task:RemoteReceiptTask)=>boolean,
  send:(revision:number)=>Promise<unknown>,status:string):Promise<boolean>
}>;
export declare function createMasterRemoteReceiptLane():RemoteReceiptLane;
