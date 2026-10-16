import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("native execution and post-audit planning errors are distinct phases",()=>{
 assert.match(src,/let executionVerified=false/);
 assert.match(src,/executionVerified=verified/);
 assert.match(src,/if\(executionVerified\)\{/);
 assert.match(src,/Native action remained audit-verified/);
 assert.match(src,/if\(confirmedExpiry\)\{[\s\S]*?else\{[\s\S]*?const unknownBudget=taskBudgets\.get\(current\.threadId\)/);
 assert.match(src,/if\(unknownBudget\)await persistRecovery\(unknownBudget,"outcome_unknown",current\.action\.id\)/);
 assert.match(src,/const recoveryPrepared=await prepareAuditedUiReadRecovery\(current,message\)/);
});
test("UI recovery prepared action has nonempty bounded matching native ID",()=>{
 assert.match(src,/!next\.id\.trim\(\)\|\|next\.id\.length>128\|\|next\.kind!=="ui_windows"/);
});
