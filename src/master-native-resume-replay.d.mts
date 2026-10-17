export type NativeResumeReplayResult=Readonly<{
 blocked:boolean;delivered:boolean;reason:string|null;
}>;
export declare function classifyNativeResumeReplay(graph:unknown,delivery:unknown):NativeResumeReplayResult;
