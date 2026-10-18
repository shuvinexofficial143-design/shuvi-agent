import type {NativeTaskDelivery,NativeSchedule} from "./types";
import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
import type {BoundPremiereProjectShaProof} from "./native-project-sha-proof.mjs";
import type {PremiereReopenEvidence} from "./premiere-project-reopen-evidence.mjs";
export type PremiereProjectDeliveryContract=Readonly<{
 stage:string;reason:string;deliveryContractAligned:boolean;
 originalGoalVerified:false;windowsLiveVerified:false
}>;
export declare function assessPremiereProjectDeliveryContract(
 owner:string|null,graph:unknown,schedule:NativeSchedule|null,
 delivery:NativeTaskDelivery|null,taskId:string,
 created:PremiereProjectEvidenceCandidate|null,
 sha:BoundPremiereProjectShaProof|null,
 reopened:PremiereReopenEvidence|null
):PremiereProjectDeliveryContract;
