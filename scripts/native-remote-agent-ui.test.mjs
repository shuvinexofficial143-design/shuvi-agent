import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/remote_agent.rs",import.meta.url),"utf8");
test("native remote inbox is opt-in, outbound-only and uses normal agent orchestration",()=>{
 assert.match(native,/remote_agent_pair/);
 assert.match(native,/remote_agent_poll/);
 assert.match(native,/await sendRemoteReceipt\("admitted"\)/);
 assert.match(native,/await runAgentStep\(\)/);
 assert.match(native,/await stageProposal\(response.tool_proposal\)/);
 assert.match(native,/requires_approval/);
 assert.match(native,/Approve on mobile/);
 assert.match(rust,/keyring::Error::NoEntry/);
 assert.doesNotMatch(rust,/TcpListener|127\.0\.0\.1:47771/);
});
test("native terminal success uses correlated audit, no fake remote success",()=>{
 assert.match(native,/remoteTask\.evidenceActionId=actionId/);
 assert.match(native,/receiptMatches/);
 assert.match(native,/outcome_unknown/);
 assert.match(native,/kind:"native_audit"/);
});
