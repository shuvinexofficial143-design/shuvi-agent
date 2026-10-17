export type FinalizationScope=Readonly<{taskId:string;revoked:boolean}>;
export type MasterFinalizationLease=Readonly<{release():boolean}>;
export type MasterFinalizationSingleFlight=Readonly<{
 acquire(scope:FinalizationScope|null,graph:object|null,owner:string|null):MasterFinalizationLease|null;
}>;
export declare function createMasterFinalizationSingleFlight():MasterFinalizationSingleFlight;
