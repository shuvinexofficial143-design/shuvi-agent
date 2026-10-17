export type MasterCommentaryCompletion=Readonly<{
 mode:"no_graph"|"native_finalizer"|"preserve_checkpoint";
}>;
export declare function classifyMasterCommentaryCompletion(graph:unknown):MasterCommentaryCompletion;
