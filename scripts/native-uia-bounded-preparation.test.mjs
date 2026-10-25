import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src-tauri/src/native_uia_window_guard.rs",import.meta.url),"utf8");
test("UIA preparation uses bounded read-only traversal instead of full-descendant materialization",()=>{
 assert.match(src,/function Resolve-ShuviPreparedMatches/);
 assert.match(src,/TreeWalker]::ControlViewWalker/);
 assert.match(src,/visited -gt 1200/);
 assert.match(src,/Depth -ge 14/);
 assert.match(src,/SHUVI_UIA_PREPARE_BOUNDED/);
 assert.match(src,/SHUVI_UIA_PREPARE_AMBIGUOUS/);
 assert.match(src,/SHUVI_UIA_PREPARE_LOOKUP nodes=/);
 assert.match(src,/\$matches = Resolve-ShuviPreparedMatches -root \$root -condition \$condition/);
 assert.match(src,/\$control = \$matches\[0\]/);
});
