import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const queue=readFileSync(new URL('../src-tauri/src/native_background_parent_queue.rs',import.meta.url),'utf8');
const parent=readFileSync(new URL('../src-tauri/src/native_background_os_workers.rs',import.meta.url),'utf8');
const admission=readFileSync(new URL('../src-tauri/src/native_background_admission.rs',import.meta.url),'utf8');
const native=readFileSync(new URL('../src-tauri/src/native_scheduler.rs',import.meta.url),'utf8');
const lib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
test('M52 stays internal, compiled in Windows SHA lane, never arbitrary executable IPC',()=>{
  assert.match(parent,/mod parent_queue;/);
  assert.match(native,/mod background_os_workers;/);
  assert.match(queue,/fn enqueue_approved_at\(/);
  assert.match(queue,/fn run_next_approved</);
  assert.match(queue,/super::run_trusted_sha256_with_guard\(/);
  assert.doesNotMatch(lib,/async fn enqueue_approved_at|pub async fn run_next_approved/);
  assert.doesNotMatch(queue,/Command::new|cmd\.exe|powershell|taskkill/i);
});
test('M52 rejects replay, unsafe dependencies and forged terminal success',()=>{
  assert.match(queue,/const MAX_PARENTS:usize=48/);
  assert.match(queue,/const MAX_IN_FLIGHT:usize=2/);
  assert.match(queue,/Another Shuvi instance owns parent queue journal/);
  assert.match(queue,/q\.parents\.iter\(\)\.any\(\|p\|p\.parent_id==requested\.id\)/);
  assert.match(queue,/super::admission::checked_input\(requested\.input\)/);
  assert.match(queue,/q\.parents\[index\]\.phase="admitted"/);
  assert.match(queue,/p\.phase="outcome_unknown"/);
  assert.match(queue,/super::hash_readback::verify\(/);
  assert.match(queue,/super::admission::snapshot_detailed_at\(root\)/);
  assert.match(queue,/fn kernel_lock_corrupt_primary_and_interrupted_recovery_fail_closed/);
  assert.match(queue,/fn same_input_stays_serialized_and_unknown_preserves_capacity/);
  assert.match(admission,/pub\(super\) fn checked_input/);
});
test('M52 retains one exclusive GUI lease and never grants owner approval',()=>{
  assert.match(native,/if running>1/);
  assert.match(native,/Another native job already holds the scheduler execution lane/);
  assert.match(queue,/trusted integration MUST check each exact owner approval/);
  assert.match(queue,/No public Tauri dispatch/);
  assert.doesNotMatch(queue,/permission\.grant|ownerApproved:\s*true/);
});
test('M53 launches two separately claimed parent UUIDs with independent real Job Object-backed SHA verification',()=>{
  assert.match(queue,/fn run_two_ready_approved<F>/);
  assert.match(queue,/std::thread::scope\(\|scope\|/);
  assert.match(queue,/scope\.spawn\(\|\|run_next_approved\(root,\|\|host_ram_over_limit\(\)\)\)/);
  assert.match(queue,/fn two_independent_parent_claims_race_safely_under_os_journal_lock/);
  assert.match(queue,/fn bounded_priority_aging_prevents_old_low_priority_parent_starvation/);
  assert.match(queue,/Parent dispatcher panicked|parent dispatcher panicked/);
  assert.match(queue,/first approved parent|First approved parent/);
  assert.match(parent,/const MAX_BACKGROUND_WORKERS:usize=2/);
  assert.match(parent,/READ_ONLY_JOB_CAP:u64=512\*1024\*1024/);
});
test('M53 exact parent Stop refuses foreign/unstaged PID and never reports process termination as success',()=>{
  assert.match(queue,/fn request_exact_parent_stop_at\(/);
  assert.match(queue,/super::request_stop_for_child\(root,id\)/);
  assert.match(queue,/c\.phase=="os_running"/);
  assert.match(queue,/fn parent_stop_cannot_claim_process_termination_without_owned_os_pid/);
  assert.doesNotMatch(queue,/TerminateProcess|taskkill|Command::new/);
});
