import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const begin=ui.indexOf("async function runAgentStep(): Promise<void> {");
const end=ui.indexOf('el<HTMLButtonElement>("#resumeTask")',begin);
const run=ui.slice(begin,end);
test("after approved model response, final UI idle requires original task identity after async remote receipt",()=>{
 const owner=run.indexOf("const responseCleanupOwnerCurrent=");
 const accept=run.indexOf('if(!(await closeRemoteTask("outcome_unknown")))return;',owner);
 const post=run.indexOf("if(!responseCleanupOwnerCurrent()||remoteTask!==null)return;",accept);
 const idle=run.indexOf("setBusy(false);",post);
 assert.ok(owner>=0&&accept>owner&&post>accept&&idle>post);
});
test("provider errors preserve uncertain paid reservation and cannot reset the new task Busy status",()=>{
 const catchBlock=run.slice(run.indexOf("const caution = "),run.lastIndexOf("} finally {"));
 const write=catchBlock.indexOf("await saveActiveCheckpoint();");
 const guard=catchBlock.indexOf("if(!responseCleanupOwnerCurrent())return;",write);
 const remote=catchBlock.indexOf('if(!(await closeRemoteTask("outcome_unknown")))return;',guard);
 const second=catchBlock.indexOf("if(!responseCleanupOwnerCurrent()||remoteTask!==null)return;",remote);
 const idle=catchBlock.indexOf("setBusy(false);",second);
 assert.ok(write>=0&&guard>write&&remote>guard&&second>remote&&idle>second);
 assert.match(catchBlock,/recovery_mode: "stopped", stop_reason: caution/);
});
test("post-response terminal owner recheck accepts intentional old task consent revocation without authorizing new task",()=>{
 assert.match(run,/const responseCleanupOwnerCurrent=\(\)=>requestScope===activePermissionScope&&/);
 assert.match(run,/orchestration.task_graph===requestGraph&&/);
 assert.match(run,/orchestration.owner_request===requestOwner&&!cancelRequested/);
 const local=run.slice(run.indexOf("const responseCleanupOwnerCurrent="),
    run.indexOf("let providerTurnFence"));
 assert.doesNotMatch(local,/!requestScope.revoked/);
});
test("provider cleanup keeps exact one paid reservation and no remote execution on ambiguous receipt",()=>{
 const model=run.indexOf("const reservation = reserveTaskModelRequest(orchestration)");
 const durable=run.indexOf("guardedSaveNativeCheckpoint(true)",model);
 const billed=run.indexOf('invoke<ChatResponse>("chat"',durable);
 assert.ok(model>0&&durable>model&&billed>durable);
 const source=run.slice(run.indexOf("const caution = "));
 assert.doesNotMatch(source,/invoke\("execute_action"|grantTaskRead/);
});
