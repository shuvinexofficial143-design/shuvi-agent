import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("uncertain native prepare never silently retries provider generation or accepts a late action",()=>{
 const start=main.indexOf("async function stageProposal(");
 const end=main.indexOf("function clearChatPermission(",start);
 const block=main.slice(start,end);
 const failure=block.slice(block.lastIndexOf("  } catch {"));
 assert.match(failure,/if \(staleStage\(\)\) return;/);
 assert.match(failure,/pendingChatProposal === proposal \? pendingAction\?\.id : null/);
 assert.match(failure,/await invoke\("deny_action", \{ actionId: abandonedId \}\)/);
 assert.match(failure,/if \(pendingChatProposal === proposal\) clearChatPermission\(\)/);
 assert.match(failure,/revokeTaskScope\(activePermissionScope\)/);
 assert.match(failure,/prepare_outcome_unknown: true/);
 assert.match(failure,/await stopAgentForSafety\(/);
 assert.doesNotMatch(failure,/await continueAfterOutcome\(\)/);
 assert.doesNotMatch(failure,/runAgentStep\(\)/);
 assert.doesNotMatch(failure,/String\(error\)/);
});
test("native stage validates action metadata and commits identity before owner approval",()=>{
 const stage=main.slice(main.indexOf("async function stageProposal("),main.indexOf("function clearChatPermission("));
 assert.match(stage,/validPendingDisplayMetadata\(pendingAction, proposal.tool\)/);
 assert.match(stage,/bindPreparedAction\(orchestration, proposal, preparedId\)/);
 assert.match(stage,/if \(staleStage\(\)\) \{[\s\S]*?denyStaleAction\(staged\?\.id\)/);
});
