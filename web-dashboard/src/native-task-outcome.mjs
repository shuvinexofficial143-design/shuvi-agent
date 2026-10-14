import {taskGoalChecks} from "./native-goal-checks.mjs";
// This is a conservative summary of native evidence, never model prose.
// A matching live window does not verify project creation, editing or export.
export function taskOutcomeSummary(objective,verifiedWindow=null){
 const checks=taskGoalChecks(objective).map(s=>s.id);
 if(!verifiedWindow)return "Outcome: UNVERIFIED. No uniquely observed audited target window; "+
  "no task-completion claim is warranted.";
 const outstanding=checks.filter(id=>id!=="window");
 return outstanding.length?
  "Outcome: PARTIALLY OBSERVED. Window existence independently observed; "+
   "still UNVERIFIED: "+outstanding.join(", ")+". No overall task completion claim.":
  "Outcome: WINDOW OBSERVED. The requested application's window exists in the "+
   "last audited inspection. No other application, file or project effects were verified.";
}
