import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("real native Stop is offered beside the composer, never only CSS",()=>{
 assert.match(source,/const stopCurrent=field\("button","Request Stop \(current native action\)"\)/);
 assert.match(source,/composerParent\.insertBefore\(stopCurrent,chatForm\)/);
 assert.match(source,/stopCurrent\.hidden=!activeNativeActionId/);
 assert.match(source,/stopCurrent\.disabled=!ready\|\|!activeNativeActionId\|\|ownerStopRequestedIds\.has\(activeNativeActionId\)/);
});
test("Stop binds only the exact executing Rust action, never a supplied PID or arbitrary process",()=>{
 assert.match(source,/activeNativeActionId=current\.action\.id;/);
 assert.match(source,/const actionId=activeNativeActionId;/);
 assert.match(source,/invoke<boolean>\("cancel_running_action",\{actionId\}\)/);
 assert.doesNotMatch(source,/stopCurrent\.addEventListener[\s\S]{0,1400}(?:taskkill|kill_process|Stop-Process)/);
 assert.match(source,/if\(activeNativeActionId===current\.action\.id\)activeNativeActionId=null;/);
});
test("owner stop never certifies termination and blocks next paid planning even after verified action",()=>{
 assert.match(source,/ownerStopRequestedIds\.add\(actionId\);/);
 assert.match(source,/if\(ownerStopRequestedIds\.delete\(current\.action\.id\)\)\{/);
 assert.match(source,/await persistRecovery\(budget,"paused",current\.action\.id\)/);
 assert.match(source,/Stopped continuation after audited action/);
 assert.match(source,/stopFeedback\.textContent=accepted/);
 assert.match(source,/A successful request is not proof that the original goal or worker has terminated/);
 assert.match(source,/Further planning is stopped; inspect Rust Audit/);
});
test("old Allow once, native audit, recovery and no replay path remain",()=>{
 assert.match(source,/approve\.addEventListener\("click",\(\)=>\{void decide\(true\);\}\)/);
 assert.match(source,/result=await invoke<ActionResult>\("execute_action"/);
 assert.match(source,/verifiedExecutionReceipt\(current\.action,result,receipts\)/);
 assert.match(source,/persistRecovery\(currentBudget,"executing",current\.action\.id\)/);
});

// Stop-requested failures must never schedule the read-only recovery successor.
test("Stop wins over failed execution and asynchronous recovery staging",()=>{
 assert.match(source,/if\(ownerStopRequestedIds\.has\(current\.action\.id\)\)return false;/);
 assert.match(source,/if\(ownerStopRequestedIds\.has\(current\.action\.id\)\)\{[\s\S]{0,190}deny_action/);
 const handler=source.slice(source.indexOf("async function decide("),source.indexOf('stopCurrent.addEventListener("click"'));
 assert.match(handler,/if\(ownerStopRequestedIds\.has\(current\.action\.id\)\)\{[\s\S]{0,450}no recovery action or paid planning/);
});
