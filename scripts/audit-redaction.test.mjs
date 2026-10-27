import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("persistent action audit redacts obvious secret-bearing details",()=>{
  const start=rust.indexOf("fn audit_safe_action_detail");
  const end=rust.indexOf("fn audit_io_lock",start);
  const block=rust.slice(start,end);
  assert.match(block,/"powershell"/);
  assert.match(block,/PowerShell command omitted from persistent audit/);
  assert.match(block,/"launch_app"/);
  assert.match(block,/"open_url" \| "browser_start" \| "browser_navigate"/);
  // Premiere prompts stay redacted even though their approved argument SHA remains auditable.
  assert.match(block,/"premiere_inspect_frame" \| "premiere_review_frames" =>/);
  assert.match(block,/"inspect_screen" => "Vision prompt omitted from persistent audit\."/);
  assert.match(block,/prefix\.strip_prefix\("premiere_args_sha256="\)/);
  assert.match(block,/Vision prompt omitted from persistent audit\./);
  assert.match(block,/detail\.chars\(\)\.take\(4_000\)/);
});

test("permission staging still retains full detail for the approval UI",()=>{
  const start=rust.indexOf("pending.insert(");
  const end=rust.indexOf("fn now_ms",start);
  const block=rust.slice(start,end);
  assert.match(block,/detail: detail\.clone\(\)/);
  assert.match(block,/PendingActionView[\s\S]*detail,[\s\S]*risk/);
});

test("deny expiry and execution audit use safe detail",()=>{
  const deny=rust.slice(rust.indexOf("fn deny_action("),rust.indexOf("fn cancel_running_action("));
  assert.match(deny,/audit_safe_action_detail\(&action\.tool, &action\.detail\)/);

  const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell"));
  assert.match(execute,/let safe_detail = audit_safe_action_detail\(&action\.tool, &action\.detail\)/);
  assert.match(execute,/let audit_detail = audit_safe_action_detail\(&tool, &detail\)/);
  assert.match(execute,/successful_execution_audit_detail\(&tool,&audit_detail,&result\)/);
  assert.match(execute,/detail: executed_audit_detail,/);
  assert.match(execute,/detail: audit_detail,/);
});

test("BUG-015: search-text action audit must never persist the original query or path",()=>{
  const start=rust.indexOf("fn audit_safe_action_detail");
  const end=rust.indexOf("fn successful_execution_audit_detail",start);
  const safe=rust.slice(start,end);
  assert.match(safe,/"search_text" => "Workspace text search path and query omitted from persistent audit\."/);
  // Prepared in-memory owner approval can still show the exact search input.
  assert.match(rust,/format!\("\{\} \| query=\{\}", path, query\)/);
  const exe=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell"));
  assert.match(exe,/let audit_detail = audit_safe_action_detail\(&tool, &detail\)/);
});
