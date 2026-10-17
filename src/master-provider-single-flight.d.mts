export type ProviderTaskScope=Readonly<{taskId:string;revoked:boolean}>;
export type ProviderFlightLease=Readonly<{release():boolean}>;
export type ProviderSingleFlight=Readonly<{
 acquire(scope:ProviderTaskScope|null):ProviderFlightLease|null
}>;
export declare function createMasterProviderSingleFlight():ProviderSingleFlight;
