import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("an audited action cannot trigger the next paid provider call without a durable checkpoint",()=>{
 const helper=main.slice(main.indexOf("async function persistRequiredContinuationCheckpoint"),
   main.indexOf("async function continueAfterOutcome"));
 assert.match(helper,/await invoke\("save_session_checkpoint", \{ checkpoint: currentCheckpoint\(\) \}\)/);
 assert.match(helper,/catch \{[\s\S]*stopAgentForSafety[\s\S]*return false/);
 const block=main.slice(main.indexOf("async function continueAfterOutcome"),
   main.indexOf("async function stageProposal"));
 assert.match(block,/if \(!await persistRequiredContinuationCheckpoint\(\)\) return;/);
 assert.ok(block.indexOf("persistRequiredContinuationCheckpoint")<block.indexOf("await runAgentStep()"));
 const master=main.slice(main.indexOf("async function runAgentStep"),
   main.indexOf('el<HTMLButtonElement>("#resumeTask")'));
 assert.match(master,/masterEmptyToolReplies\+=1;[\s\S]*if \(!await persistRequiredContinuationCheckpoint\(\)\) return;[\s\S]*await runAgentStep\(\)/);
});
test("checkpoint write failure is never translated into owner approval or an audited success",()=>{
 assert.doesNotMatch(main.slice(main.indexOf("async function persistRequiredContinuationCheckpoint"),
   main.indexOf("async function continueAfterOutcome")),/execute_action|grantTaskRead|stageProposal\(/);
});
