import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("native execution and post-audit planning errors are distinct phases",()=>{
 assert.match(src,/let executionVerified=false/);
 assert.match(src,/executionVerified=verified/);
 assert.match(src,/if\(executionVerified\)\{/);
 assert.match(src,/Native action remained audit-verified/);
 assert.match(src,/else\{\s*const recoveryPrepared=await prepareAuditedUiReadRecovery\(current,message\)/);
});
test("UI recovery prepared action has nonempty bounded matching native ID",()=>{
 assert.match(src,/!next\.id\.trim\(\)\|\|next\.id\.length>128\|\|next\.kind!=="ui_windows"/);
});
