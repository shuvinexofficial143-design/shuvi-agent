import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
import type {BoundPremiereProjectShaProof} from "./native-project-sha-proof.mjs";
import type {PremiereReopenEvidence} from "./premiere-project-reopen-evidence.mjs";
export type PremiereProjectProofProgress={
 stage:"unverified"|"create_audited"|"file_sha256_verified"|"reopen_audited";
 verifiedStages:number;label:string;remaining:string;originalGoalVerified:false
};
export function assessPremiereProjectProofProgress(
 taskId:string,created:PremiereProjectEvidenceCandidate|null,
 sha:BoundPremiereProjectShaProof|null,reopened:PremiereReopenEvidence|null
):PremiereProjectProofProgress;
