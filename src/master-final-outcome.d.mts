import type {NativeSchedule,NativeTaskDelivery} from "./types";
import type {AuditedOpeningObservation} from "./master-goal-window-acceptance.mjs";
export type MasterGoalProofRequirement={
 id:string; reason:string
};
export type MasterFinalOutcome={
 verified:boolean;scope:"unverified"|"premiere_window";reason:string|null;
 completedNativeSteps:number;required:string[];missing:MasterGoalProofRequirement[];
 window?:{app:string;title:string;pid:number;hwnd:number};
 actionId?:string
};
export function assessMasterFinalOutcome(
 owner:string|null,graph:unknown,schedule:NativeSchedule|null,
 delivery:NativeTaskDelivery|null,opening:AuditedOpeningObservation|null,
 taskId:string
):MasterFinalOutcome;
export function summarizeMasterMissingProof(outcome:MasterFinalOutcome):string;
export function masterGoalEvidenceContext(owner:string|null):string;
