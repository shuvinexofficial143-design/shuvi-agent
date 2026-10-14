export type WorkerModelMap=Readonly<Record<string,string>>|null;
export type WorkerModelDelegation={
 isSpecialist:boolean;role:string;
 route:{provider:string;model:string;base_url:string;role:string};
 step_id:string|null;tool:string|null
};
export const SPECIALIST_ROLES:readonly string[];
export function restorePinnedWorkerModels(value:unknown):WorkerModelMap;
export function pinNativeWorkerModels(raw:string|null,provider:string):WorkerModelMap;
export function specialistRoleForTurn(turn:unknown):string|null;
export function chooseSpecialistTurn(turn:unknown,models:WorkerModelMap,master:{provider:string;model:string;base_url:string;role:string}):WorkerModelDelegation|null;
export function specialistProposalMatches(delegation:WorkerModelDelegation|null,proposal:unknown):boolean;

export function delegatedWorkerContext(base:string,delegation:WorkerModelDelegation|null,graph:unknown):string|null;
