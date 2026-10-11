export declare const DEFAULT_TASK_ACTION_BUDGET: 8;
export declare const MAX_RUNTIME_ACTIONS: 48;
export declare const MAX_TASK_DURATION_MS: number;
export declare function allowedTaskBudget(value: unknown): value is 8 | 24 | 48;
export declare function taskDeadline(now?: number): number | null;
export declare function taskDeadlineAllows(deadline: number | null, now?: number): boolean;

export declare function maxTaskModelRequests(maxSteps: number): number | null;
export declare function reserveTaskModelRequest<T extends {max_steps:number;model_requests_reserved:number;task_expires_at_ms:number|null}>(state:T):
  {ok:true;state:T}|{ok:false;reason:string};
