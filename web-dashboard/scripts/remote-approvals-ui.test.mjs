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
