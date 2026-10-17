import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const native=ui.slice(ui.indexOf("async function executePendingProposal("),
 ui.indexOf("function renderChatPermission("));
test("post-audit native success cannot apply an old action to a replaced Mobile task",()=>{
 assert.match(native,/if\(remoteTask!==actionRemoteTask\|\|!isNativeActionOwnershipCurrent\(postOutcomeOwnership,/);
 assert.match(native,/if\(remoteTask!==actionRemoteTask\|\|!isNativeActionOwnershipCurrent\(actionOwnership,/);
 assert.match(native,/if\(remoteTask!==actionRemoteTask\|\|!isNativeActionOwnershipCurrent\(failedOutcomeOwnership,/);
 assert.match(native,/await auditGraphOutcome\(proposal\);/);
});
test("Disconnect requests cancellation of a running OS mutation rather than reporting fake success",()=>{
 const b=ui.slice(ui.indexOf('el<HTMLButtonElement>("#remoteAgentDisconnect")'),
 ui.indexOf("function remoteReceipt("));
 assert.match(b,/if\(executingActionId\)\{/);
 assert.match(b,/#stopButton/);
 assert.doesNotMatch(b,/closeRemoteTask\("succeeded"\)/);
});
test("disconnect revokes old consent synchronously before awaited Rust denial",()=>{
 const b=ui.slice(ui.indexOf('el<HTMLButtonElement>("#remoteAgentDisconnect")'),
 ui.indexOf("function remoteReceipt("));
 const x=b.indexOf("cancelRequested=true"),y=b.indexOf("revokeTaskScope(disconnectScope)"),
  z=b.indexOf('invoke("deny_action",{actionId:denyId})');
 assert.ok(x>=0&&y>x&&z>y);
 assert.match(b,/if\(denyId\)clearChatPermission\(\)/);
 assert.match(b,/remoteTask===disconnectRemote&&activePermissionScope===disconnectScope/);
});
test("late disconnected remote deny reply cannot stop a newer local owner or wipe pending action",()=>{
 const b=ui.slice(ui.indexOf('el<HTMLButtonElement>("#remoteAgentDisconnect")'),
 ui.indexOf("function remoteReceipt("));
 assert.match(b,/if\(remoteTask===disconnectRemote&&activePermissionScope===disconnectScope\)\{/);
 assert.match(b,/if\(activePermissionScope===disconnectScope\)\s*await stopAgentForSafety/);
 assert.match(b,/await invoke\("remote_agent_disconnect"\)/);
});
