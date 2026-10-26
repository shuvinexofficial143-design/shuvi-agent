import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const start=rust.indexOf("ToolAction::UiDiscover { window } => {");
const end=rust.indexOf("ToolAction::UiFind ",start);
const arm=rust.slice(start,end);
test("UIA discovery diagnostic uses escaped PowerShell formatting braces inside Rust format!",()=>{
 assert.ok(start>=0&&end>start);
 assert.match(arm,/SHUVI_UIA_DISCOVERY_SCAN nodes=\{\{0\}\} elapsed_ms=\{\{1\}\}/);
 assert.doesNotMatch(arm,/SHUVI_UIA_DISCOVERY_SCAN nodes=\{0\} elapsed_ms=\{1\}/);
 assert.match(arm,/-f \$shuviDiscoveryNodes,\$shuviDiscoveryClock\.ElapsedMilliseconds/);
 assert.match(arm,/TreeWalker\]::ControlViewWalker/);
 assert.match(arm,/shuviDiscoveryNodes -gt 1200/);
 assert.match(arm,/shuviParent.Depth -ge 14/);
 assert.match(arm,/Assert-ShuviObservedControl/);
 assert.match(arm,/Assert-ShuviObservedWindow/);
});
