import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("managed browser stores one exact DevTools page target",()=>{
  assert.match(rust,/struct BrowserSession \{[\s\S]*target_id: String/);
  assert.match(rust,/fn cdp_initial_page_target\(port: u16\) -> Result<String, String>/);
  assert.match(rust,/Where-Object \{\{ \$_\.type -eq 'page' -and \$_\.id \}\}/);
  assert.match(rust,/let Some\(target_id\) = target_id else/);
  assert.match(rust,/target_id: target_id\.clone\(\)/);
});

test("CDP commands select the stored target ID instead of the first page",()=>{
  const start=rust.indexOf("fn cdp_command(");
  const end=rust.indexOf("fn cdp_eval(",start);
  const block=rust.slice(start,end);
  assert.match(block,/target_id: &str/);
  assert.match(block,/target_encoded = BASE64\.encode\(target_id\.as_bytes\(\)\)/);
  assert.match(block,/\$_\.id -eq \$targetId/);
  assert.match(block,/Shuvi-bound browser page target is no longer available/);
  assert.doesNotMatch(block,/Select-Object -First 1[\s\S]*No debuggable browser page is available/);
});

test("navigate and DOM evaluation pass the bound target",()=>{
  const first=rust.indexOf("ToolAction::BrowserNavigate");
  const navStart=rust.indexOf("ToolAction::BrowserNavigate",first+1);
  const navEnd=rust.indexOf("ToolAction::BrowserDomRead",navStart);
  assert.match(rust.slice(navStart,navEnd),/&session\.target_id/);
  assert.match(rust,/fn cdp_eval\(port: u16, target_id: &str, expression: String\)/);
  assert.match(rust,/cdp_eval\(session\.port, &session\.target_id, expression\)\?/);
});
