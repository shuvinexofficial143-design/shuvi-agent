import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const start=ui.indexOf('el<HTMLButtonElement>("#stopButton").addEventListener("click"');
const end=ui.indexOf('document.querySelectorAll<HTMLButtonElement>(".nav")',start);
const block=ui.slice(start,end);
test("old Stop cannot edit a new local owner task after Rust grant revoke",()=>{
 const captures=block.indexOf("const stoppingOwner=orchestration.owner_request");
 const graph=block.indexOf("let stoppingGraph=orchestration.task_graph",captures);
 const remote=block.indexOf("const stoppingRemote=remoteTask");
 const awaitRust=block.indexOf("await revokeNativeTaskReads(stoppingReadTaskId)");
 const fence=block.indexOf("if(!stillStopping())return;",awaitRust);
 assert.ok(captures>=0&&graph>captures&&remote>captures&&awaitRust>graph&&fence>awaitRust);
 assert.match(block,/orchestration.task_graph===stoppingGraph&&/);
 assert.match(block,/orchestration.owner_request===stoppingOwner&&/);
 assert.match(block,/remoteTask===stoppingRemote&&cancelRequested/);
});
test("old Allow Once buttons are removed before native denial IPC",()=>{
 const action=block.indexOf("const stoppingPending=pendingAction");
 const hide=block.indexOf("if(stoppingPending)clearChatPermission();",action);
 const revoke=block.indexOf("revokeTaskScope(stoppingScope)",hide);
 const awaitRust=block.indexOf("await revokeNativeTaskReads",revoke);
 assert.ok(action>=0&&hide>action&&revoke>hide&&awaitRust>revoke);
});
test("mobile denial/receipt must still own the same original task after Rust IPC",()=>{
 const remote=block.indexOf("if(stoppingRemote){");
 const denial=block.indexOf('await invoke("deny_action",{actionId})',remote);
 const fence=block.indexOf("if(!stillStopping())return;",denial);
 const ack=block.indexOf('if(!(await closeRemoteTask("stopped")))return;',fence);
 const post=block.indexOf("remoteTask!==null)return;",ack);
 assert.ok(remote>=0&&denial>remote&&fence>denial&&ack>fence&&post>ack);
});
test("local denied prepared action does not restart a paid Master model",()=>{
 const receipt=block.indexOf("receipt = await readActionAuditReceipt(actionId)");
 const guard=block.indexOf("if(!stillStopping())return;",receipt);
 const audit=block.indexOf("await auditGraphOutcome(stoppingProposal)",guard);
 const save=block.indexOf("await saveActiveCheckpoint();",audit);
 const stop=block.indexOf("await stopAgentForSafety(",save);
 assert.ok(receipt>=0&&guard>receipt&&audit>guard&&save>audit&&stop>save);
 assert.doesNotMatch(block,/await runAgentStep\(\)|invoke<ChatResponse>\("chat"/);
});
test("running cancellation still uses original Rust UUID and awaits cancellation",()=>{
 assert.match(block,/if \(executingActionId\)/);
 assert.match(block,/invoke<boolean>\("cancel_running_action", \{ actionId \}\)/);
 assert.match(block,/executingCancellation = \{ actionId, promise \}/);
 assert.match(block,/await promise;/);
 assert.doesNotMatch(block,/closeRemoteTask\("succeeded"\)/);
});
