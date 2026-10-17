import type {ActionResult,ToolProposal} from "./types";
export type PremiereProjectEvidenceCandidate={
 taskId:string;actionId:string;stepId:string;projectGuid:string;projectPath:string;
 sizeBytes:number;fingerprintAlgorithm:"fnv1a64_noncryptographic_change_detector";
 fnv1a64:string;hostIdentityObserved:true;diskBytesObserved:true;
 sha256Attested:false;reopenVerified:false;originalGoalVerified:false
};
export function inspectPremiereProjectCreateCandidate(
 original:string|null,graph:unknown,proposal:ToolProposal,result:ActionResult,
 actionId:string,taskId:string,rustAuditVerified:boolean
):PremiereProjectEvidenceCandidate|null;
export function projectCandidateStatus(
 candidate:PremiereProjectEvidenceCandidate|null,activeTaskId:string
):string;
