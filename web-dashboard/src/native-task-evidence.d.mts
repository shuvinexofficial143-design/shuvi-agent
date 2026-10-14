export type NativeEvidence={audited:number;lastTool:string|null;observations:{id:string;tool:string;kind:string}[]};
export declare function newEvidence():NativeEvidence;
export declare function recordAuditedEvidence(state:NativeEvidence,id:string,result:{success:boolean;tool:string},audited:boolean):NativeEvidence;
export declare function evidenceSummary(state:NativeEvidence|null):string;
