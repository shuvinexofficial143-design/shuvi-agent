import type { ToolProposal } from "./types";
export type MasterAdmission = {ok:true;reason:null}|{ok:false;reason:string};
export type GoalDelivery = {verified:boolean;reason:string;requiresIndependentAcceptance?:boolean};
export type MasterStepDeclaration = {expected_tool:string;step_id?:string;depends_on?:string[]};
export type MasterGraphDeclaration = {objective:string;revision?:number;steps:MasterStepDeclaration[]};
export function pinnedMasterObjective(ownerRequest:unknown):string|null;
export function validateMasterPlan(ownerRequest:unknown,metadata:unknown):MasterAdmission;
export function validateMasterAction(ownerRequest:unknown,proposal:ToolProposal):MasterAdmission;
export function assessMasterGoalDelivery(ownerRequest:unknown,graph:unknown):GoalDelivery;
