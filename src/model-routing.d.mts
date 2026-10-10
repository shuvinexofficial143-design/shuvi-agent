export type ModelRoute = {provider:string;model:string;base_url:string};
export type TaskModelRoute = ModelRoute & {role:string};
export declare const MODEL_ROLES: readonly (readonly [string,string])[];
export declare function taskRole(text:unknown):string;
export declare function validateModelRoute(role:string,config:unknown,providers:string[]):ModelRoute|null;
export declare function loadModelRoutes(raw:string|null,providers:string[]):Record<string,ModelRoute>;
export declare function selectTaskRoute(text:string,routes:Record<string,ModelRoute>,fallback:ModelRoute):TaskModelRoute;
