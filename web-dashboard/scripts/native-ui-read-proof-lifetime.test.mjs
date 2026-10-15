import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 77 failed new ui_windows inspection cannot leave old app proof active",()=>{
 const attempt=s.indexOf('if(current.action.kind==="ui_windows"){');
 const exec=s.indexOf('await invoke<ActionResult>("execute_action"');
 assert.ok(attempt!==-1&&attempt<exec,"invalidate proof before native execute");
 assert.match(s.slice(attempt,exec),/observedWindows.set\\(current.threadId,null\\)/);
 assert.match(s.slice(attempt,exec),/verifiedWindows.delete\(current.threadId\)/);
});
