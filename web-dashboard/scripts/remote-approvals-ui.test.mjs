import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("src/remote-command-client.ts");
const coord=read("server/remote-coordinator.mjs");
test("mobile explicit task-bound approval and safe cancellation exist",()=>{
 assert.match(ui,/approvalExpiresAt/);
 assert.match(ui,/Approve once/);
 assert.match(ui,/Request stop/);
 assert.match(ui,/operation:"decide"/);
 assert.match(ui,/operation:"cancel"/);
 assert.match(coord,/approvalExpiresAt:r.status==="requires_approval"/);
});

test("BUG-020: mobile shows exact tool, target, risk, prepared ID before approve",()=>{
 assert.match(ui,/Tool: /);
 assert.match(ui,/Risk: /);
 assert.match(ui,/Target: /);
 assert.match(ui,/Exact Windows action disclosure unavailable/);
 assert.match(ui,/actionId:task\.approvalAction\.id/);
 assert.match(coord,/approvalAction:r\.status==="requires_approval"/);
 assert.match(coord,/task\.approvalDecision\.actionId===task\.receipt\.approvalAction\.id/);
});
