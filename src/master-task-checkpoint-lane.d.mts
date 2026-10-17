export type TaskCheckpointLane=Readonly<{
 enqueue(stillCurrent:()=>boolean,action:()=>Promise<unknown>):Promise<boolean>
}>;
export function createTaskCheckpointLane():TaskCheckpointLane;
