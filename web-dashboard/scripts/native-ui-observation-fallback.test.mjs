import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
test("Batch 47 unparseable UI observation cannot be forwarded raw to Master",()=>{
 assert.match(s,/compactObservedUi\(result\)\?\?"Native UI observation unavailable or invalid/);
 assert.match(s,/\["ui_windows","ui_find","ui_discover"\]\.includes\(result\.tool\)/);
});
