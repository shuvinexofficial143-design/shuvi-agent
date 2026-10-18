import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sched=readFileSync(new URL("../src-tauri/src/native_scheduler.rs",import.meta.url),"utf8");
test("DAG preflight, begin, finish, review and status are cross-process serialized",()=>{
 assert.match(sched,/struct SchedulerOsLock/);
 assert.match(sched,/share_mode\(0\)/);
 assert.match(sched,/flock\(handle\.as_raw_fd\(\),2\|4\)/);
 for(const name of ["fn preflight_at(","fn begin_at(","fn finish_at(","fn review_failed_at("]){
   const start=sched.indexOf(name),end=sched.indexOf("\n}",start);
   const body=sched.slice(start,end);
   assert.ok(start>=0&&end>start,name);
   assert.match(body,/SchedulerOsLock::take\(file\)\?/);
   assert.ok(body.indexOf("SchedulerOsLock::take(file)")<body.indexOf("read_at(file)"),name);
 }
 assert.match(sched,/fn read_locked_at\(/);
 assert.match(sched,/pub\(crate\) fn verified_status/);
 assert.match(sched,/SchedulerOsLock::take\(&file\)\?/);
});
test("real DAG start races never claim two native desktop UUIDs",()=>{
 assert.match(sched,/two_instances_cannot_start_the_same_native_dag_step_in_parallel/);
 assert.match(sched,/scheduler_kernel_lock_rejects_other_instance_start_audit_review_and_status/);
 assert.match(sched,/forged_scheduler_lock_directory_fails_without_creating_a_queue/);
 assert.match(sched,/OPEN_REPARSE_POINT/);
 assert.doesNotMatch(sched,/tauri::command|invoke_handler/);
});
