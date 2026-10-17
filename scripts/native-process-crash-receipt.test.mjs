import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const owned=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const journal=readFileSync(new URL("../src-tauri/src/native_process_receipt.rs",import.meta.url),"utf8");
test("native process launch persists intent before OS child creation and PID after launch",()=>{
  const at=owned.indexOf("process_receipt::begin_at(&receipt");
  const spawn=owned.indexOf("let mut owned=spawn_checked(&schedule");
  const reg=owned.indexOf("process_receipt::started_at(&receipt");
  assert.ok(at>=0&&spawn>at&&reg>spawn);
  assert.match(owned,/owned\.lease=Some\(lease\)/);
  assert.match(owned,/self\.complete_owned_terminal\("exited",Some\(code\)\)/);
  assert.match(owned,/self\.complete_owned_terminal\(phase,result\)/);
  assert.match(owned,/self\.record_terminal\(actual,code\)\?/);
});
test("disk receipt is independent of application progress and quarantines unknown launches",()=>{
  assert.match(journal,/app_progress_verified:false/);
  assert.match(journal,/Previous subprocess launch or process outcome is unresolved/);
  assert.match(journal,/Native subprocess UUID cannot be relaunched from durable history/);
  assert.match(journal,/prior\.previous_action_ids\.iter\(\)\.any/);
  assert.match(journal,/prior_uuid_remains_blocked_after_successful_other_action_and_restart/);
  assert.match(journal,/owner_review_at\(/);
  assert.match(journal,/corrupt_primary_and_orphan_backup_are_not_unlocked/);
  assert.doesNotMatch(owned,/tauri::command|invoke_handler/);
});
