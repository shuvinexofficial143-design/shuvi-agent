import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const worker=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const scheduler=readFileSync(new URL("../src-tauri/src/native_scheduler.rs",import.meta.url),"utf8");
test("process supervision is compiled into native scheduler, not a model-supplied IPC",()=>{
  assert.match(scheduler,/#\[path = "native_owned_process.rs"\]/);
  assert.match(worker,/fn spawn_for_active_action(?:<[^>]+>)?\(/);
  assert.match(worker,/lease:NativeExecutionLease<'lease>/);
  assert.match(worker,/owned\.lease=Some\(lease\)/);
  assert.match(worker,/std::mem::forget\(lease\)/);
  assert.match(worker,/super::read\(app\)/);
  assert.match(worker,/native_worker_job::read\(app\)/);
  assert.match(worker,/identity_matches\(/);
  assert.doesNotMatch(worker,/invoke_handler|tauri::command|execute_model_shell/);
});
test("PID lifetime and cancellation are bound to exact Rust action",()=>{
  assert.match(worker,/PROCESS_OWNER:Mutex<ProcessSlot>/);
  assert.match(worker,/MAX_RECENT_LAUNCHES:usize=48/);
  assert.match(worker,/slot\.recent\.iter\(\)\.any/);
  assert.match(worker,/self\.child\.id\(\)/);
  assert.match(worker,/self\.child\.try_wait\(\)/);
  assert.match(worker,/if action_id!=self\.action_id/);
  assert.match(worker,/self\.child\.terminate_tree\(\)/);
  assert.match(worker,/self\.child\.active_processes\(\)/);
  assert.match(worker,/app_progress_verified:false/);
  assert.match(worker,/descendants_contained:self\.child\.tree_contained\(\)/);
  assert.match(worker,/fn active_worker_blocks_second_owned_child_until_reaped/);
});
