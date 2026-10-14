export type NativeDeliveryClaim={stepId:string;tool:string;actionId:string;artifact:null|{kind:string;path:string;sha256:string;bytes:number}};
export function nativeTaskDeliveryClaims(graph:unknown,schedule:unknown):NativeDeliveryClaim[]|null;
