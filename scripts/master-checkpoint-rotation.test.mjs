import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stagingWasInvalidated} from "../src/approval-staging-guard.mjs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const segment=(a,b)=>ui.slice(ui.indexOf(a),ui.indexOf(b,ui.indexOf(a)));
test("an old final delivery cannot clear a newly rotated task checkpoint after Rust grant revocation",()=>{
 const block=segment("async function clearActiveCheckpoint()", "async function loadRecoveryCheckpoint");
 assert.match(block,/const clearingScope=activePermissionScope;/);
 assert.match(block,/const clearingGraph=orchestration\.task_graph;/);
 assert.match(block,/const clearingOwner=orchestration\.owner_request;/);
 assert.ok(block.indexOf("await revokeNativeTaskReads(finishedTaskId)") <
   block.indexOf("if(activePermissionScope!==clearingScope"));
 assert.ok(block.indexOf("if(activePermissionScope!==clearingScope") <
   block.indexOf('guardedClearNativeCheckpoint(clearingScope,clearingGraph,clearingOwner)'));
});
test("stale pre-stage checkpoint failure never stops a newly admitted owner task",()=>{
 const block=segment("async function stageProposal", "async function executePendingProposal");
 const start=block.indexOf('await guardedSaveNativeCheckpoint()');
 const catchAt=block.indexOf('if(staleStage())return;',start);
 const stop=block.indexOf("Could not save task progress before staging the action.",catchAt);
 assert.ok(start>=0&&catchAt>start&&stop>catchAt);
});
test("stale prepared-action checkpoint error denies ONLY old action UUID",()=>{
 const block=segment("async function stageProposal", "async function executePendingProposal");
 const prepare=block.indexOf("Could not save the prepared-action binding before approval/execution.");
 const nearest=block.lastIndexOf("if(staleStage()){",prepare);
 const deny=block.indexOf("await denyStaleAction(preparedId);",nearest);
 const clear=block.lastIndexOf("pendingAction = null;",prepare);
 assert.ok(prepare>0&&nearest>0&&deny>nearest&&deny<prepare&&clear>deny);
 assert.match(block,/pendingAction\?\.id === id && pendingChatProposal === proposal\) clearChatPermission/);
});
test("approval staging detects task replacement and graph rotation even with replayed action IDs",()=>{
 const before={taskId:"same",revoked:false}, after={taskId:"same",revoked:false};
 const graph={revision:1};
 assert.equal(stagingWasInvalidated(before,after,graph,graph,false),true);
 assert.equal(stagingWasInvalidated(before,before,graph,{...graph},false),true);
 assert.equal(stagingWasInvalidated(before,before,graph,graph,true),true);
});
test("nothing relaxes native approval, signed Rust action receipt or source proof gate",()=>{
 assert.match(ui,/const actionOwnership=captureNativeActionOwnership/);
 assert.match(ui,/const preflight=assessNativeFinalizationPreflight\(/);
 assert.match(ui,/const receipt = await readActionAuditReceipt\(actionId\)/);
 assert.match(ui,/!isNativeActionOwnershipCurrent\(postOutcomeOwnership,/);
});
