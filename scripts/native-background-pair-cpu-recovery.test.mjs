import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const win=read("src-tauri/src/native_windows_job.rs");
const owned=read("src-tauri/src/native_background_os_workers.rs");
const admission=read("src-tauri/src/native_background_admission.rs");
const scheduler=read("src-tauri/src/native_scheduler.rs");
const lib=read("src-tauri/src/lib.rs");
test("read-only Windows process trees have a pre-spawn 25 percent OS CPU hard cap",()=>{
  assert.match(win,/const JOB_CPU_RATE_CONTROL:u32=15/);
  assert.match(win,/const CPU_RATE_HARD_CAP:u32=0x4/);
  assert.match(win,/const READ_ONLY_CPU_HARD_RATE:u32=2500/);
  assert.match(win,/Self::spawn_capped_with_cpu\(exe,args,cwd,cap,Some\(READ_ONLY_CPU_HARD_RATE\)\)/);
  assert.match(owned,/OwnedChild::spawn_readonly_capped\(exe,args,cwd,READ_ONLY_JOB_CAP\)/);
  assert.ok(win.indexOf("SetInformationJobObject(job.0,JOB_CPU_RATE_CONTROL")<
    win.indexOf("CreateProcessW(app.as_ptr()"));
  assert.ok(win.includes('if ok==0{return Err(error("Cannot enforce read-only worker CPU hard cap"));}'));
  assert.match(win,/cpu_rate_structure_is_exact_windows_eight_bytes/);
  assert.match(win,/Self::spawn_capped\(exe,args,cwd,MAX_JOB_MEMORY_BYTES\)/);
});
test("two separately authenticated read-only OS workers have individually durable SHA outcomes",()=>{
  assert.match(owned,/pub\(crate\) fn run_internal_readonly_pair</);
  assert.match(owned,/std::thread::scope\(\|scope\|/);
  assert.match(owned,/run_trusted_sha256_with_guard\(/);
  assert.match(owned,/let left=a.join\(\)/);
  assert.match(owned,/let right=b.join\(\)/);
  assert.match(owned,/first.action_id==second.action_id/);
  assert.match(owned,/first.input==second.input/);
  assert.match(owned,/host_over_limit:\&F/);
  assert.match(owned,/Fn\(\)->Result<bool,String>\+Sync/);
  assert.match(owned,/batch_pair_rejects_duplicate_uuid_without_starting_or_reusing_a_worker/);
  assert.match(owned,/two_background_workers_cannot_bypass_fail_closed_shared_memory_guard/);
  // The pair is reachable ONLY from the existing owner-approved execute_action branch.
  assert.match(lib,/let execution=if let ToolAction::VerifyReadOnlyShaPair/);
  assert.match(lib,/native_scheduler::background_os_workers::run_internal_readonly_pair/);
});
test("read-only restart projections never trust stale SHA files or reclassify OS exit as app success",()=>{
  assert.match(admission,/snapshot_detailed_at/);
  assert.match(owned,/pub\(crate\) fn inspect_readonly_health/);
  assert.match(owned,/hash_readback::verify\(/);
  assert.match(owned,/recorded_phase:claim.phase/);
  assert.match(owned,/current_file_rehashed:reverified/);
  assert.match(owned,/safe_to_auto_retry:false/);
  assert.match(owned,/cross_checked_terminal_sha_snapshot_rehashes_current_bytes_and_flags_tamper/);
  assert.match(owned,/read_only_snapshot_never_promotes_crash_pending/);
  assert.match(scheduler,/More than one native action has claimed the shared desktop/);
  assert.doesNotMatch(owned,/tauri::command/);
});
