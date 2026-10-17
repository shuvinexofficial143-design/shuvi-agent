import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const a=ui.indexOf("async function runAgentStep");
const b=ui.indexOf('el<HTMLButtonElement>("#resumeTask")',a);
const step=ui.slice(a,b);
test("consent revoked by ordinary completed chat cleanup must not block original Mobile terminal receipt",()=>{
 const noGraph=step.indexOf("const completionRoute=classifyMasterCommentaryCompletion");
 const cleared=step.indexOf("await clearActiveCheckpoint();",noGraph);
 const remote=step.indexOf("if(remoteTask&&responseCleanupOwnerCurrent())",cleared);
 const accepted=step.indexOf('if(!(await closeRemoteTask("outcome_unknown")))return;',remote);
 const final=step.indexOf("if(!responseCleanupOwnerCurrent()||remoteTask!==null)return;",accepted);
 const idle=step.indexOf("setBusy(false);",final);
 assert.ok(noGraph>=0&&cleared>noGraph&&remote>cleared&&accepted>remote&&final>accepted&&idle>final);
 assert.match(step,/staleModelRequest\(\) would falsely reject it due expected revocation/);
});
test("late old remote callback cannot retire newly arrived Mobile task on same local task scope",()=>{
 assert.match(step,/const requestRemote=remoteTask;/);
 assert.match(step,/remoteTask===requestRemote\|\|\(requestRemote!==null&&remoteTask===null\)/);
 assert.match(step,/requestScope===activePermissionScope&&/);
 assert.match(step,/orchestration.owner_request===requestOwner&&!cancelRequested/);
});
test("provider unknown outcome terminal receipt also checks original remote identity after saved checkpoint",()=>{
 const danger=step.slice(step.indexOf("const caution = "),step.lastIndexOf("} finally {"));
 assert.match(danger,/await saveActiveCheckpoint\(\);\s*if\(!responseCleanupOwnerCurrent\(\)\)return;/);
 assert.match(danger,/if\(!\(await closeRemoteTask\("outcome_unknown"\)\)\)return;/);
 assert.match(danger,/if\(!responseCleanupOwnerCurrent\(\)\|\|remoteTask!==null\)return;/);
});
