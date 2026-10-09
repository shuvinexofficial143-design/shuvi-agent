import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const run=source.slice(source.indexOf("async function runAgentStep(): Promise<void> {"),source.indexOf('el<HTMLButtonElement>("#resumeTask")'));
const resume=source.slice(source.indexOf('el<HTMLButtonElement>("#resumeTask")'),source.indexOf('el<HTMLButtonElement>("#discardTask")'));
test("A12 failure of native AI provider persists bounded private-safe checkpoint and stops implicit retry",()=>{
 const failure=run.slice(run.lastIndexOf("} catch {"));
 assert.match(failure,/provider request outcome is unknown/);
 assert.match(failure,/may already have been billed/);
 assert.match(failure,/DO NOT automatically retry/);
 assert.match(failure,/recovery_mode: "stopped"/);
 assert.match(failure,/await saveActiveCheckpoint\(\)/);
 assert.doesNotMatch(failure,/String\(error\)/);
 assert.doesNotMatch(failure,/runAgentStep\(\)/);
});
test("A12 resumed checkpoint cannot silently resubmit a pending billable request",()=>{
 assert.match(resume,/window\.confirm\(/);
 assert.match(resume,/prior provider request may have been billed/);
 assert.match(resume,/if \(restored\.recovery_mode !== "stopped"/);
 assert.match(resume,/if \(orchestration\.recovery_mode === "stopped"\)/);
 assert.ok(resume.indexOf('if (orchestration.recovery_mode === "stopped")')<resume.indexOf("await runAgentStep()"));
 assert.match(resume,/await saveActiveCheckpoint\(\)/);
});
