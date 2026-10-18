import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const run=ui.slice(ui.indexOf("async function continueAfterOutcome()"),
 ui.indexOf("async function stageProposal"));
test("stopped DAG from native failed/denied action is not suppressed by normal live-lease guard",()=>{
 const owner=run.indexOf("const continuationOwnerCurrent=");
 const stopped=run.indexOf('if(orchestration.recovery_mode==="stopped"){',owner);
 const sameTask=run.indexOf("if(!continuationOwnerCurrent())return;",stopped);
 const safety=run.indexOf("await stopAgentForSafety(",sameTask);
 const persist=run.indexOf("await persistRequiredContinuationCheckpoint(",safety);
 const provider=run.lastIndexOf("await runAgentStep()");
 assert.ok(owner>0&&stopped>owner&&sameTask>stopped&&safety>sameTask&&persist>safety&&provider>persist);
});
test("stopped branch is exact scope+graph+owner+remote and never performs native tool or paid provider dispatch",()=>{
 const init=run.slice(0,run.indexOf("renderOrchestrationStatus();"));
 assert.match(init,/continuationScope===activePermissionScope&&/);
 assert.match(init,/orchestration.task_graph===continuationGraph&&/);
 assert.match(init,/orchestration.owner_request===continuationOwner&&/);
 assert.match(init,/remoteTask===continuationRemote/);
 assert.match(init,/!continuationScope.revoked&&!cancelRequested&&/);
 assert.doesNotMatch(init,/invoke<ChatResponse>\("chat"|executePendingProposal\(|stageProposal\(/);
});
test("terminal failure has explicit safety-stop audit and owner-bound checkpoint preservation",()=>{
 const stop=ui.slice(ui.indexOf("async function stopAgentForSafety("),
   ui.indexOf("async function persistRequiredContinuationCheckpoint"));
 assert.match(stop,/await revokeNativeTaskReads\(stoppedTaskId\)/);
 assert.match(stop,/recovery_mode: "stopped"/);
 assert.match(stop,/await recordOrchestrationAudit\("orchestration_stopped"/);
 assert.match(stop,/await saveActiveCheckpoint\(\)/);
 assert.match(stop,/if\(!stopStillCurrent\(\)\)return;/);
});
