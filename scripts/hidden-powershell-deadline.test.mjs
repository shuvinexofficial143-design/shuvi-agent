import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const start=rust.indexOf("fn run_hidden_powershell(");
const end=rust.indexOf("\nfn ",start+4);
const helper=rust.slice(start,end>start?end:undefined);

test("hidden PowerShell UIA/CDP calls cannot block for an unlimited time",()=>{
  assert.ok(start>=0,"native helper is registered");
  assert.match(helper,/const POWER_SHELL_DEADLINE: Duration = Duration::from_secs\(30\)/);
  assert.match(helper,/\.stdout\(Stdio::piped\(\)\)/);
  assert.match(helper,/\.stderr\(Stdio::piped\(\)\)/);
  assert.match(helper,/\.spawn\(\)/);
  assert.match(helper,/child\.try_wait\(\)/);
  assert.match(helper,/started\.elapsed\(\) >= POWER_SHELL_DEADLINE/);
  assert.match(helper,/child\.kill\(\)/);
  assert.match(helper,/child\.wait_with_output\(\)/);
  assert.doesNotMatch(helper,/\.output\(\)/);
});

test("timeout does not report that an external mutation was undone",()=>{
  assert.match(helper,/outcome of any external action is unknown/);
  assert.match(helper,/inspect it before retrying/);
});
