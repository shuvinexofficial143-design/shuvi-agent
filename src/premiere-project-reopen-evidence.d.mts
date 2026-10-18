import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
import type {BoundPremiereProjectShaProof} from "./native-project-sha-proof.mjs";
import type {ToolProposal,ActionResult} from "./types";
export type PremiereReopenEvidence={
 taskId:string;createActionId:string;reopenActionId:string;
 projectGuid:string;projectPath:string;sha256BeforeReopen:string;
 fileBytesVerifiedBeforeReopen:true;
 hostProjectReopenObserved:true;diskFingerprintUnchanged:true;
 sha256AfterReopenVerified:boolean;originalGoalVerified:false;
 projectReopenEvidenceVerified?:true
};
export function inspectPremiereProjectReopenCandidate(
 taskId:string,created:PremiereProjectEvidenceCandidate|null,
 shaProof:BoundPremiereProjectShaProof|null,graph:unknown,
 proposal:ToolProposal,result:ActionResult,actionId:string,audited:boolean
):PremiereReopenEvidence|null;
export function bindPremiereReopenShaAfterReadback(
 reopen:PremiereReopenEvidence|null,
 shaAgain:BoundPremiereProjectShaProof|null,taskId:string
):PremiereReopenEvidence|null;
