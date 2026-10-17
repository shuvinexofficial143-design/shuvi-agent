export type NativeCheckpointReadback=Readonly<{verified:boolean;reason:string|null}>;
export declare function assessNativeCheckpointReadback(expected:unknown,observed:unknown):NativeCheckpointReadback;
