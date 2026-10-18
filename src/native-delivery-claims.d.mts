export type NativeDeliveryClaim={stepId:string;tool:string;actionId:string;artifact:null|{kind:string;path:string;sha256:string;bytes:number}};
export type NativeProjectDeliveryProof=Readonly<{taskId:string;
 created:unknown;sha:unknown;reopened:unknown}>;
export function nativeTaskDeliveryClaims(graph:unknown,schedule:unknown,
 projectProof?:NativeProjectDeliveryProof|null):NativeDeliveryClaim[]|null;
