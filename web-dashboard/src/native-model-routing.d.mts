export declare const NATIVE_MODEL_ROLES: readonly (readonly [string,string])[];
export declare function validModelId(value:unknown):boolean;
export declare function classifyNativeIntent(text:unknown):string;
export declare function safeNativeEndpoint(provider:string,provided:unknown):string;
export type NativeRouteChoice = {ok:true;role:string;provider:string;model:string;base_url:string}|{ok:false;role:string;error:string};
export declare function chooseNativeRoute(text:string,config:{provider:string;base_url?:string;roles:Record<string,string>}|null|undefined):NativeRouteChoice;
