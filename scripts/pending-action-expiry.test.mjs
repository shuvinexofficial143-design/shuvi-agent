import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("prepared action expiry and claim happen under one pending lock",()=>{
  const start=rust.indexOf("async fn execute_action(");
  const end=rust.indexOf("async fn execute_powershell",start);
  const block=rust.slice(start,end);
  assert.match(block,/let \(action, expired_action\) = \{/);
  assert.match(block,/let mut pending = state[\s\S]*?\.pending[\s\S]*?\.lock\(\)/);
  assert.match(block,/now_ms\(\)\.saturating_sub\(prepared\.created_at_ms\) > PENDING_ACTION_TTL_MS/);
  assert.match(block,/\(None, pending\.remove\(&action_id\)\)/);
  assert.match(block,/let action = pending[\s\S]*?\.remove\(&action_id\)/);
  assert.doesNotMatch(block,/let expired_action = \{[\s\S]*?\};[\s\S]*?let action = \{/);
});

test("expired prepared actions remain denied and audited",()=>{
  const start=rust.indexOf("async fn execute_action(");
  const end=rust.indexOf("async fn execute_powershell",start);
  const block=rust.slice(start,end);
  assert.match(block,/if let Some\(action\) = expired_action/);
  assert.match(block,/event: "denied"\.into\(\)/);
  assert.match(block,/Prepared action expired before execution and must be prepared again/);
});
