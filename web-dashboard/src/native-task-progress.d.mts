export type NativeTaskProgress={phase:"planning"|"awaiting_approval"|"executing"|"paused";verified:number;tools:string[];pending:{id:string;tool:string;step:number}|null;reason:string|null};
export declare function createTask():NativeTaskProgress;
export declare function stageTask(s:NativeTaskProgress|null,id:string,tool:string,step:number):NativeTaskProgress|null;
export declare function executeTask(s:NativeTaskProgress|null,id:string):NativeTaskProgress|null;
export declare function verifyTask(s:NativeTaskProgress|null,id:string,tool:string,audited:boolean):NativeTaskProgress|null;
export declare function pauseTask(s:NativeTaskProgress|null,reason:string):NativeTaskProgress|null;
export declare function taskSummary(s:NativeTaskProgress|null):string;
export declare function taskContext(s:NativeTaskProgress|null):string;
