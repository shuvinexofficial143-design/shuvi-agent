import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const stage=ui.slice(ui.indexOf("async function stageProposal("),ui.indexOf("const masterNativeSingleFlight="));
const continuation=ui.slice(ui.indexOf("async function continueAfterOutcome"),ui.indexOf("async function stageProposal"));
test("original task lease is captured BEFORE blocked or accepted native orchestration event awaits",()=>{
 const lease=stage.indexOf("const proposalScope=activePermissionScope");
 const original=stage.indexOf("const proposalRemote=remoteTask");
 const blocked=stage.indexOf("recordProposalBlock(orchestration, proposal, decision)");
 const accepted=stage.indexOf("acceptProposalGraph(orchestration, proposal)");
 assert.ok(lease>=0&&original>lease&&blocked>original&&accepted>blocked);
 assert.match(stage,/const originalProposalTaskCurrent=\(\)=>activePermissionScope===proposalScope&&/);
 assert.match(stage,/remoteTask===proposalRemote/);
});
test("blocked task audit can never append a tool failure message to a replacement task",()=>{
 const blocked=stage.indexOf("const blockedProposalState=orchestration");
 const first=stage.indexOf('await recordOrchestrationAudit("orchestration_blocked"');
 const firstGuard=stage.indexOf("if(!originalProposalTaskCurrent()||orchestration!==blockedProposalState)return;",first);
 const second=stage.indexOf('await recordOrchestrationAudit("task_dependency_blocked"',firstGuard);
 const secondGuard=stage.indexOf("if(!originalProposalTaskCurrent()||orchestration!==blockedProposalState)return;",second);
 const message=stage.indexOf("messages.push(hiddenToolFailure",secondGuard);
 assert.ok(blocked>=0&&first>blocked&&firstGuard>first&&second>firstGuard&&secondGuard>second&&message>secondGuard);
});
test("accepted graph audit validates same original owner and orchestration identity before native prepare",()=>{
 const accept=stage.indexOf("const acceptedProposalState=orchestration");
 const audit=stage.indexOf("await recordOrchestrationAudit(accepted.event",accept);
 const fence=stage.indexOf("if(!originalProposalTaskCurrent()||orchestration!==acceptedProposalState)return;",audit);
 const prepare=stage.indexOf("orchestration = recordProposalStart",fence);
 assert.ok(accept>=0&&audit>accept&&fence>audit&&prepare>fence);
});
test("late Rust host or scheduler READBACK errors do not safety-stop newly admitted task",()=>{
 const read=continuation.slice(continuation.indexOf("const safeReadback="));
 const host=read.indexOf('invoke<NativeWorkerStatus>("native_worker_status")');
 const hostCatch=read.indexOf("catch {\n      if(readbackStale())return;",host);
 const sched=read.indexOf('invoke<NativeSchedule|null>("native_scheduler_status")');
 const schedCatch=read.indexOf("catch {\n      if(readbackStale())return;",sched);
 assert.ok(host>=0&&hostCatch>host&&sched>hostCatch&&schedCatch>sched);
 assert.match(read,/orchestration.task_graph!==readbackGraph/);
 assert.match(read,/readbackScope.revoked\|\|cancelRequested/);
});
test("pre-prepare stage still requires explicit Rust approval and checkpoint readback",()=>{
 assert.match(stage,/invoke<PendingAction>\("prepare_tool"/);
 assert.match(stage,/await guardedSaveNativeCheckpoint\(true\)/);
 assert.match(stage,/renderChatPermission\(proposal, step\)/);
});
