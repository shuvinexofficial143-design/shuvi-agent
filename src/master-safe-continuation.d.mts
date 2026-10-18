import type {ToolProposal} from "./types";
export type NativeReadbackGate = {
 lastOutcome?:string|null; recoveryMode?:string|null;
 cancelRequested?:boolean; remoteTask?:boolean
};
export function planVerifiedNativeReadback(graph:unknown,ownerRequest:unknown,options?:NativeReadbackGate):ToolProposal|null;
