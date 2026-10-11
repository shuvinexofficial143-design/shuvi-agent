export declare function taskClarificationKind(question:unknown,answer:unknown):"application"|"destination"|"name"|null;
export declare function extendTaskClarification(root:unknown,answer:unknown,kind:unknown):string;
export declare function isTaskClarificationQuestion(question:unknown):boolean;
export declare function nextClarificationRoot(objective:unknown,reply:unknown,hasTool:boolean,role:string):string|null;
