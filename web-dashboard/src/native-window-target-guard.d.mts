export type ObservedWindow={title:string;pid:number;hwnd:number};
export declare function observedWindowInventory(result:{success:boolean;tool:string;stdout:string},audited:boolean):ObservedWindow[]|null;
export declare function checkObservedMutationTarget(proposal:unknown,observed:ObservedWindow[]|null):{allowed:boolean;reason:string};
export declare function checkAmbiguousReadWindow(proposal:unknown,observed:ObservedWindow[]|null):{allowed:boolean;reason:string};
