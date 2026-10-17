import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("paid AI responses cannot cross task identity after Stop or replacement",()=>{
 const start=main.indexOf("async function runAgentStep()");
 const end=main.indexOf('el<HTMLButtonElement>("#resumeTask")',start);
 const run=main.slice(start,end);
 assert.match(run,/const requestScope = activePermissionScope/);
 assert.match(run,/requestScope !== activePermissionScope/);
 assert.match(run,/requestScope.revoked \|\| cancelRequested/);
 const sent=run.indexOf('const response = await invoke<ChatResponse>("chat"');
 const check=run.indexOf("if (staleModelRequest()) return;",sent);
 const usage=run.indexOf("if (response.usage)",sent);
 const stage=run.indexOf("await stageProposal(response.tool_proposal, selectedRoute)",sent);
 assert.ok(sent>=0 && check>sent && usage>check && stage>usage);
 const handleError=run.lastIndexOf("} catch {");
 assert.ok(handleError>sent);
 assert.match(run.slice(handleError),/if \(staleModelRequest\(\)\) return/);
});
test("native chat dispatch is guarded again after durable checkpoint preflight",()=>{
 const start=main.indexOf("async function runAgentStep()");
 const end=main.indexOf('el<HTMLButtonElement>("#resumeTask")',start);
 const run=main.slice(start,end);
 const save=run.indexOf('await guardedSaveNativeCheckpoint(true)');
 const gate=run.indexOf("if (staleModelRequest()) return;",save);
 const send=run.indexOf('const response = await invoke<ChatResponse>("chat"');
 assert.ok(save>=0 && gate>save && send>gate);
});
