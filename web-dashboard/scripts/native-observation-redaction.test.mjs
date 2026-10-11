import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 91 redact observed window metadata in status and follow-up Master context",()=>{
 assert.match(s,/redactNativeMessage\(summarizeWindowObservation\(result,true\)\)/);
 assert.match(s,/redactNativeMessage\(goalEvidenceLabel\(task\.objective/);
 assert.match(s,/goalStatus\.textContent=proof\?redactNativeMessage\(goalEvidenceLabel/);
});
