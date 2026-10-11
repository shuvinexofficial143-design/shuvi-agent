export type NativeTaskBudget={maxActions:number;expiresAt:number;modelRequests:number;stagedActions:number};
export declare function createNativeTaskBudget(actions:number,now?:number):NativeTaskBudget|null;
export declare function reserveNativeModelRequest(state:NativeTaskBudget,now?:number):boolean;
export declare function canStageNativeAction(state:NativeTaskBudget,now?:number):boolean;
export declare function canExecuteNativeAction(state:NativeTaskBudget,now?:number):boolean;
export declare function markNativeActionStaged(state:NativeTaskBudget,now?:number):boolean;
