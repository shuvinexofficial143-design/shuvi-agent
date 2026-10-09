export type WorkerLane = "premiere" | "after_effects" | "remotion" | "browser" | "windows" | "coding" | "adobe" | "master" | "unsupported";
export type WorkerJob = {id:string;worker:WorkerLane;resource:string;tool:string;status:string;verified:boolean;action_id:string|null;depends_on:string[];title:string};
export type WorkerQueueView = {total:number;verified:number;running:number;ready:number;blocked:number;jobs:WorkerJob[];ready_job_ids?:string[]};
export function workerForTool(tool:unknown):WorkerLane;
export function evidenceForStep(step:unknown):{action_id:string;tool:string}|null;
export function workerQueueView(graph:unknown):WorkerQueueView;
export function workerQueueSummary(graph:unknown):string;
