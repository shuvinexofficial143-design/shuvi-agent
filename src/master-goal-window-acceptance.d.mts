import type {ActionResult,ToolProposal,NativeSchedule,NativeTaskDelivery} from "./types";
export type AuditedOpeningObservation={
 taskId:string;
 objective:string|null;
 actionId:string;
 stepId:string;
 window:{app:string;title:string;pid:number;hwnd:number};
};
export type OpeningDeliveryAssessment=
 {verified:false;scope:"unverified";reason:string}|
 {verified:true;scope:"premiere_window";reason:null;window:AuditedOpeningObservation["window"];actionId:string};
export function captureMasterOpeningObservation(
 owner:string|null,graph:unknown,proposal:ToolProposal,
 result:ActionResult,actionId:string,taskId:string,audited:boolean
):AuditedOpeningObservation|null;
export function verifyMasterOpeningDelivery(
 owner:string|null,graph:unknown,schedule:NativeSchedule|null,
 delivery:NativeTaskDelivery|null,captured:AuditedOpeningObservation|null,activeTaskId:string
):OpeningDeliveryAssessment;
