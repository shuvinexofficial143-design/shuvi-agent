export type AcceptedRemotionArtifact={kind:"accepted_remotion";acceptance_action_id:string;render_action_id:string;path:string;sha256:string};
export type PremiereInsertionArtifact={kind:"premiere_insertion_plan";final_acceptance_action_id:string;path:string;sha256:string};
export type WorkerArtifact=AcceptedRemotionArtifact|PremiereInsertionArtifact;
export function parseWorkerArtifact(tool:string,stdout:string,actionId:string):WorkerArtifact|null;
export function validWorkerArtifact(value:unknown,tool:string,actionId:string|null):boolean;
export function artifactHandoffFailure(graph:unknown,stepId:string,proposal?:unknown):string|null;
