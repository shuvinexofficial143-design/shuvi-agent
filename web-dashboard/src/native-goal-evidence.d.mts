export type VerifiedWindowGoal={app:string;title:string;pid:number;hwnd:number};
export declare function windowGoalEvidence(objective:unknown,result:{success:boolean;tool:string;stdout:string},hasExactAudit:boolean):VerifiedWindowGoal|null;
export declare function goalEvidenceLabel(request:unknown,verifiedWindow:VerifiedWindowGoal|null):string;
