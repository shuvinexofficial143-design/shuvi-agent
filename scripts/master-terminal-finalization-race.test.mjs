import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {terminalRemoteReceiptClearAllowed as canClear} from "../src/master-remote-terminal-fence.mjs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const done=main.slice(main.indexOf("async function continueAfterOutcome"),main.indexOf("async function stageProposal"));
const close=main.slice(main.indexOf("async function closeRemoteTask("),main.indexOf("async function tickRemoteAgent("));
test("positive final mobile acknowledgement is required before checkpoint clear and busy reset",()=>{
 const previous=done.indexOf('const hadTerminalRemote=remoteTask!==null');
 const wait=done.indexOf('if(!(await closeRemoteTask(terminalStatus)))return;',previous);
 const owned=done.indexOf('if(!terminalStillOwned())return;',wait);
 const clear=done.indexOf('await clearActiveCheckpoint();',owned);
 const reset=done.indexOf('setBusy(false);',clear);
 assert.ok(previous>0&&wait>previous&&owned>wait&&clear>owned&&reset>clear);
 assert.match(done,/remoteTask===null&&!cancelRequested&&/);
 assert.match(done,/activePermissionScope!==continuationScope\|\|/);
});
test("terminal remote result no longer uses the pre-close remote-pointer check after successful acknowledgement",()=>{
 const pos=done.indexOf("const hadTerminalRemote");
 const section=done.slice(pos,done.indexOf("setBusy(false);",pos));
 assert.doesNotMatch(section,/if\(!continuationCurrent\(\)\)return;/);
 assert.match(section,/const terminalStillOwned=\(\)=>activePermissionScope===continuationScope/);
});
test("terminal receipt failure preserves unresolved task, preventing a new inbound remote admission",()=>{
 const original={message:{taskId:"mobile-1"}};
 assert.equal(canClear(original,original,true),true);
 assert.equal(canClear(original,original,false),false);
 assert.match(close,/if\(!terminalRemoteReceiptClearAllowed\(closingTask,remoteTask,acknowledged\)\)\{/);
 assert.match(close,/revokeTaskScope\(closingScope\)/);
 assert.match(close,/return false;/);
 assert.match(close,/return true;/);
});
test("old Rust checkpoint clear completion cannot reset busy in a rotated task",()=>{
 const pos=done.indexOf("await clearActiveCheckpoint();",done.indexOf("const terminalStillOwned"));
 const post=done.slice(pos,done.indexOf("setBusy(false);",pos));
 assert.match(post,/activePermissionScope!==continuationScope/);
 assert.match(post,/orchestration.task_graph!==continuationGraph/);
 assert.match(post,/orchestration.owner_request!==continuationOwner/);
 assert.match(post,/remoteTask!==null/);
});
