import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const job=readFileSync(new URL("../src-tauri/src/native_worker_job.rs",import.meta.url),"utf8");
test("all four native journal mutations take the kernel lock across read-modify-write",()=>{
 assert.match(job,/struct CrossProcessNativeJobLock/);
 assert.match(job,/share_mode\(0\)/);
 assert.match(job,/flock\(handle\.as_raw_fd\(\),2\|4\)/);
 for(const marker of ["fn begin_at(", "fn tick_at(", "fn audited_at(", "fn reconcile_at("]){
   const start=job.indexOf(marker),end=job.indexOf("\n}",start);
   assert.ok(start>=0&&end>start,marker);
   const body=job.slice(start,end);
   assert.match(body,/let _lock=JOB_LOCK.lock\(\)/,marker);
   assert.match(body,/CrossProcessNativeJobLock::take\(path\)\?/,marker);
   assert.ok(body.indexOf("CrossProcessNativeJobLock::take(path)")<body.indexOf("read_at(path)"),marker);
 }
 assert.match(job,/fn read_locked_at\(/);
 assert.match(job,/pub\(crate\) fn read\(app:&AppHandle\)/);
 assert.match(job,/read_locked_at\(&journal_path\(app\)\?\)/);
});
test("real-file lock contentions, racing start/audit and malicious lock directory all fail safe",()=>{
 assert.match(job,/other_instance_lock_blocks_all_mutations_and_status_read/);
 assert.match(job,/independent_threads_cannot_both_begin_durable_native_job/);
 assert.match(job,/supervisor_tick_cannot_reopen_already_audited_job/);
 assert.match(job,/native_job_lock_path_directory_never_admits_new_action/);
 assert.match(job,/OPEN_REPARSE_POINT/);
 assert.doesNotMatch(job,/tauri::command|invoke_handler/);
});
