import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
export type NativePremiereShaReceipt={
 actionId:string;projectPath:string;bytes:number;sha256:string;fnv1a64:string;
 verifiedFileBytes:boolean;reopenVerified:boolean;originalGoalVerified:boolean
};
export type BoundPremiereProjectShaProof={
 taskId:string;actionId:string;projectGuid:string;projectPath:string;bytes:number;
 fnv1a64:string;sha256:string;hashAlgorithm:"sha256";fileBytesVerified:true;
 projectReopenVerified:false;originalGoalVerified:false
};
export function bindNativePremiereShaProof(candidate:PremiereProjectEvidenceCandidate|null,
 native:NativePremiereShaReceipt|null,activeTaskId:string):BoundPremiereProjectShaProof|null;
export function nativePremiereShaProgress(
 proof:BoundPremiereProjectShaProof|null,activeTaskId:string
):string;
