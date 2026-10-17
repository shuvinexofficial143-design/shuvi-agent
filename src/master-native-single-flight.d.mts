export type NativeSingleFlightScope=Readonly<{taskId:string;revoked:boolean}>;
export type NativeFlightLease=Readonly<{release():boolean}>;
export type NativeSingleFlight=Readonly<{
 acquire(scope:NativeSingleFlightScope|null,actionId:string):NativeFlightLease|null
}>;
export declare function createMasterNativeSingleFlight():NativeSingleFlight;
