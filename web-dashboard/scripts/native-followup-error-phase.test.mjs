import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("native execution and post-audit planning errors are distinct phases",()=>{
 assert.match(src,/let executionVerified=false/);
 assert.match(src,/executionVerified=verified/);
 assert.match(src,/if\(executionVerified\)\{/);
 assert.match(src,/Native action remained audit-verified/);
 // An audited pre-execution denial returns early. Unknown outcomes stay
 // separate and must never be reclassified as a confirmed expiration.
 const from=src.indexOf("if(confirmedExpiry){");
 const unknown=src.indexOf("const unknownBudget=taskBudgets.get(current.threadId)",from);
 assert.ok(from>0&&unknown>from);
 const denialBranch=src.slice(from,unknown);
 assert.match(denialBranch,/await persistRecovery\(expiryBudget,"native_denied",current\.action\.id\)/);
 assert.match(denialBranch,/haltTask\(current\.threadId,journalOk\?"approval_expired":"recovery_journal_failed"\)/);
 assert.match(denialBranch,/No automatic replay/);
 assert.match(denialBranch,/return;/);
 assert.match(src,/if\(unknownBudget\)await persistRecovery\(unknownBudget,"outcome_unknown",current\.action\.id\)/);
 assert.match(src,/const recoveryPrepared=rustDiagnosis\?\.kind===\"worker_failure\"&&[\s\S]*?await prepareAuditedUiReadRecovery\(current,message\)/);
});
test("UI recovery prepared action has nonempty bounded matching native ID",()=>{
 assert.match(src,/!next\.id\.trim\(\)\|\|next\.id\.length>128\|\|next\.kind!=="ui_windows"/);
});
