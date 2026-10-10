import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const native=read("web-dashboard/src/native-agent.ts");
const doc=read("docs/AGENT_ORCHESTRATION.md");
test("native Master continuation has no arbitrary approved-action count cutoff",()=>{
 assert.doesNotMatch(native,/MAX_NATIVE_TASK_STEPS|task\.step\s*>=\s*[0-9]+|approved-step limit/);
 assert.match(native,/Current approved step: /);
 assert.match(doc,/no fixed six-step/);
});
test("new actions require explicit approval and duplicate proposals are still blocked",()=>{
 assert.match(native,/task\.seen\.has\(fp\)/);
 assert.match(native,/Repeated action blocked/);
 assert.match(native,/approval\.hidden=false/);
 assert.match(native,/invoke<ActionResult>\("execute_action"/);
 assert.match(native,/r\.action_id===current\.action\.id/);
 assert.match(native,/if\(verified\)await continueAfterVerifiedAction/);
});
