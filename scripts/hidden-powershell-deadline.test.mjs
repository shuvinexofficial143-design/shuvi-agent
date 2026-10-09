import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const bounded=readFileSync(new URL("../src-tauri/src/bounded_child.rs",import.meta.url),"utf8");
const start=rust.indexOf("fn run_hidden_powershell(");
const end=rust.indexOf("\nfn ",start+4);
const helper=rust.slice(start,end>start?end:undefined);

test("hidden PowerShell uses an absolute 30-second deadline",()=>{
  assert.ok(start>=0,"native helper exists");
  assert.match(helper,/const POWER_SHELL_DEADLINE: Duration = Duration::from_secs\(30\)/);
  assert.match(helper,/\.stdout\(Stdio::piped\(\)\)/);
  assert.match(helper,/\.stderr\(Stdio::piped\(\)\)/);
  assert.match(helper,/\.spawn\(\)/);
  assert.match(helper,/bounded_child::collect_with_deadline\(child, POWER_SHELL_DEADLINE\)/);
  assert.doesNotMatch(helper,/\.output\(\)/);
});

test("bounded child drains streams in parallel and stops on timeout",()=>{
  assert.match(bounded,/MAX_UI_HELPER_STREAM_BYTES: usize=8\*1024\*1024/);
  assert.match(bounded,/drain_limited\(stdout,MAX_UI_HELPER_STREAM_BYTES\)/);
  assert.match(bounded,/drain_limited\(stderr,MAX_UI_HELPER_STREAM_BYTES\)/);
  assert.match(bounded,/child\.try_wait\(\)/);
  assert.match(bounded,/start\.elapsed\(\)>=deadline/);
  assert.match(bounded,/child\.kill\(\)/);
  assert.match(bounded,/outcome of any external action is unknown/);
  assert.match(bounded,/inspect it before retrying/);
});

test("screen capture shares the bounded PowerShell helper instead of .output()",()=>{
  const from=rust.indexOf("fn capture_screen_png()");
  const to=rust.indexOf("async fn analyze_png_with_provider(",from);
  assert.ok(from>=0&&to>from);
  const block=rust.slice(from,to);
  assert.match(block,/run_hidden_powershell\(&script\)/);
  assert.doesNotMatch(block,/\.output\(\)/);
});
