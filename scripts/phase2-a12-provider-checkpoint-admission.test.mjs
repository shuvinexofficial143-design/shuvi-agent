import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const step=source.slice(source.indexOf("async function runAgentStep(): Promise<void> {"),source.indexOf('el<HTMLButtonElement>("#resumeTask")'));
test("A12 native chat must durably save recovery state before any potentially billed AI call",()=>{
 const preflight=step.indexOf('await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() })');
 const network=step.indexOf('const response = await invoke<ChatResponse>("chat"');
 assert.ok(preflight>=0&&network>preflight);
 const gate=step.slice(preflight,network);
 assert.match(gate,/catch \{/);
 assert.match(gate,/No AI provider request was sent/);
 assert.match(gate,/setBusy\(false\);\s*return;/);
 assert.match(gate,/if \(cancelRequested\)/);
 assert.match(step,/provider request outcome is unknown/);
});
