import type {NativeSchedule,NativeTaskDelivery} from "./types";
import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
import type {BoundPremiereProjectShaProof} from "./native-project-sha-proof.mjs";
import type {PremiereReopenEvidence} from "./premiere-project-reopen-evidence.mjs";
export type NativeFinalizationPreflight=Readonly<{
 allowed:boolean;stage:string;reason:string;projectProofStage:string;
 originalGoalVerified:false;
}>;
export declare function assessNativeFinalizationPreflight(
 owner:string|null,graph:unknown,schedule:NativeSchedule|null,
 claims:NativeTaskDelivery["steps"]|null,
 taskId:string,created:PremiereProjectEvidenceCandidate|null,
 sha:BoundPremiereProjectShaProof|null,
 reopened:PremiereReopenEvidence|null
):NativeFinalizationPreflight;
