// Shuvi 37 — deterministic ORIGINAL-goal-bound first native DAG.
// Not an executor, model grant, or permission. The existing task-graph parser,
// Rust scheduler and owner approval still validate every step and native UUID.
import {strictlySimplePremiereOpening} from "../web-dashboard/src/native-opening-completion.mjs";
import {pinnedMasterObjective} from "./master-autonomy-graph.mjs";
import {initialMasterInspectionDAG} from "./master-autonomy-contract.mjs";

export function attachNativePremiereOpeningBlueprint(owner,proposal,state){
 if(!strictlySimplePremiereOpening(owner)||!proposal||
    proposal.tool!=="premiere_launch"||
    !proposal.arguments||typeof proposal.arguments!=="object"||
    Array.isArray(proposal.arguments)||Object.keys(proposal.arguments).length!==0||
    proposal.task_graph!=null||proposal.task_step_id!=null||
    proposal.task_recovery!=null||state?.task_graph!=null||
    state?.objective!=null||state?.recovery_mode!=="normal"||
    state?.next_step!==1||state?.tool_actions!==0)
   return proposal;
 const plan=initialMasterInspectionDAG(owner);
 const objective=pinnedMasterObjective(owner);
 if(!plan||!objective||plan.steps.length!==2||
    plan.steps[0].expected_tool!=="premiere_launch"||
    plan.steps[1].expected_tool!=="ui_windows")return proposal;
 return {
  ...proposal,
  task_step_id:"launch_premiere",
  task_graph:{
   objective,revision:1,
   steps:[
    {
     step_id:"launch_premiere",title:"Launch Adobe Premiere Pro",
     purpose:"Perform only the owner-requested Premiere application launch.",
     success_criteria:"Rust executed audit of the exact native premiere_launch action UUID.",
     expected_tool:"premiere_launch",depends_on:[]
    },
    {
     step_id:"observe_window",title:"Verify Premiere Windows process and visible window",
     purpose:"Independently observe a unique Premiere native window after the audited launch.",
     success_criteria:"Fresh Rust-audited ui_windows result with distinct action UUID, matching OS ProcessName, PID and HWND.",
     expected_tool:"ui_windows",depends_on:["launch_premiere"]
    }
   ]
  }
 };
}
