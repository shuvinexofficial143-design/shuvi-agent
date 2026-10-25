import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkOpeningToolSelection,preparationFailureMessage} from "../web-dashboard/src/native-preparation-policy.mjs";
const agent=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("opening without editing intent cannot route to ui_set_value",()=>{
 for(const goal of ["YouTube kholo. Pehle check karo ki YouTube already open hai ya nahi.",
  "Premiere kholo","Blender खोलो","Open website"]){
  assert.equal(checkOpeningToolSelection(goal,{tool:"ui_set_value"}).allowed,false,goal);
 }
 assert.equal(checkOpeningToolSelection("Open website",{tool:"open_url"}).allowed,true);
 assert.equal(checkOpeningToolSelection("Open Premiere and create project",{tool:"ui_set_value"}).allowed,true);
 assert.equal(checkOpeningToolSelection("Search on YouTube",{tool:"ui_set_value"}).allowed,true);
});
test("prepare failures are durably paused, never confused with external execution",()=>{
 assert.match(agent,/const saved=await persistRecovery\(taskBudget,"paused",task.action.id\)/);
 assert.match(agent,/const saved=await persistRecovery\(taskBudget,"paused"\)/);
 assert.doesNotMatch(agent,/persistRecovery\(taskBudget,"outcome_unknown"\);\s*updateTask\(threadId,pauseTask\(createTask\(\),"prepare_failed"\)\)/);
 assert.match(preparationFailureMessage(true),/कोई नया Action नहीं चला/);
 assert.match(preparationFailureMessage(false),/Recovery/);
});
test("verified tool stdout is excluded from the conversational status",()=>{
 assert.doesNotMatch(agent,/appendReply\(current.threadId,current.promptIndex,label\+\(output/);
 assert.match(agent,/Technical stdout\/JSON is not normal Chat content/);
});
