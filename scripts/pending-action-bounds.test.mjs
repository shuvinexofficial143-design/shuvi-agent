import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("backend prepared permission store has a hard count and TTL",()=>{
  assert.match(rust,/const MAX_PENDING_ACTIONS: usize = 16/);
  assert.match(rust,/const PENDING_ACTION_TTL_MS: u64 = 10 \* 60 \* 1000/);
  assert.match(rust,/struct PendingAction \{[\s\S]*created_at_ms: u64/);
  const start=rust.indexOf("fn stage_tool(");
  const end=rust.indexOf("fn now_ms()",start);
  const block=rust.slice(start,end);
  assert.match(block,/pending\.retain\(\|_, action\|/);
  assert.match(block,/prepared_at_ms\.saturating_sub\(action\.created_at_ms\) <= PENDING_ACTION_TTL_MS/);
  assert.match(block,/pending\.len\(\) >= MAX_PENDING_ACTIONS/);
  assert.match(block,/created_at_ms: prepared_at_ms/);
});

test("execute_action refuses an expired exact prepared action UUID",()=>{
  const start=rust.indexOf("async fn execute_action(");
  const end=rust.indexOf("async fn execute_powershell",start);
  const block=rust.slice(start,end);
  assert.match(block,/now_ms\(\)\.saturating_sub\(prepared\.created_at_ms\) > PENDING_ACTION_TTL_MS/);
  assert.match(block,/pending\.remove\(&action_id\)/);
  assert.match(block,/event: "denied"\.into\(\)/);
  assert.match(block,/Prepared action expired before execution/);
  assert.ok(block.indexOf("Prepared action expired before execution") < block.indexOf("execute_tool_with_action_id"));
});

test("all PendingAction constructors carry a creation timestamp",()=>{
  const constructors=[...rust.matchAll(/PendingAction \{/g)].map(match=>match.index);
  assert.equal(constructors.length,3);
  for(const index of constructors.slice(1)){
    assert.match(rust.slice(index,index+260),/created_at_ms:/);
  }
});
