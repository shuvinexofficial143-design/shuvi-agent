import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("browser PID session grants can be revoked as a lifecycle boundary",()=>{
  const start=main.indexOf("function revokeBrowserSessionPermissions");
  const end=main.indexOf("function hiddenToolFailure",start);
  const block=main.slice(start,end);
  assert.match(block,/for \(const key of \[\.\.\.sessionAllowedScopes\]\)/);
  assert.match(block,/key\.includes\("\|pid:"\)/);
  assert.match(block,/sessionAllowedScopes\.delete\(key\)/);
});

test("new browser sessions cannot inherit an old PID-scoped read grant",()=>{
  const start=main.indexOf("async function executePendingProposal");
  const end=main.indexOf("function renderChatPermission",start);
  const block=main.slice(start,end);
  assert.match(block,/proposal\.tool === "browser_start"/);
  assert.match(block,/revokeBrowserSessionPermissions\(\)/);
  assert.match(block,/proposal\.tool === "stop_managed_process"/);
  assert.match(block,/revokeBrowserSessionPermissions\(proposal\.arguments\.pid\)/);
  assert.ok(block.indexOf("if (!cancelledByUser && result.success)") < block.indexOf("revokeBrowserSessionPermissions()"));
});
