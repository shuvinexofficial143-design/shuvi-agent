import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const stop=ui.slice(ui.indexOf("async function stopAgentForSafety("),
 ui.indexOf("async function persistRequiredContinuationCheckpoint"));
test("Stop retains exact old scope and failed task identity across both Rust audit awaits",()=>{
 const graph=stop.indexOf("const stopGraph=orchestration.task_graph");
 const audit1=stop.indexOf('recordOrchestrationAudit("task_graph_stopped"');
 const fence1=stop.indexOf("if(!stopStillCurrent())return;",audit1);
 const audit2=stop.indexOf('recordOrchestrationAudit("orchestration_stopped"');
 const fence2=stop.indexOf("if(!stopStillCurrent())return;",audit2);
 const message=stop.indexOf('messages.push({ role: "assistant", content: reason })');
 assert.ok(graph>0&&audit1>graph&&fence1>audit1&&audit2>fence1&&fence2>audit2&&message>fence2);
});
test("a late stopped checkpoint SAVE cannot reset the Busy flag of the new task",()=>{
 const save=stop.indexOf("await saveActiveCheckpoint();");
 const guard=stop.indexOf("if(!stopStillCurrent())return;",save);
 const done=stop.indexOf("setBusy(false);",save);
 assert.ok(save>0&&guard>save&&done>guard);
 assert.match(stop,/activePermissionScope===stoppedScope&&/);
 assert.match(stop,/orchestration\.owner_request===stopOwner/);
});
test("stop never converts native audit failure or cancelled action into success",()=>{
 assert.match(stop,/revokeTaskScope\(activePermissionScope\)/);
 assert.match(stop,/await revokeNativeTaskReads\(stoppedTaskId\)/);
 assert.match(stop,/recovery_mode: "stopped"/);
 assert.doesNotMatch(stop,/execute_action\(|grantTaskRead\(|"succeeded"/);
});
