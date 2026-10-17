import type {ToolProposal} from "./types";
export function attachNativePremiereOpeningBlueprint(
 owner:string|null,proposal:ToolProposal,
 state:{task_graph:unknown;objective:string|null;recovery_mode:string;next_step:number;tool_actions:number}
):ToolProposal;
