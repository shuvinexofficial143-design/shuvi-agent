import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../src-tauri/src/native_worker_status.rs",import.meta.url),"utf8");
const receipt=readFileSync(new URL("../src-tauri/src/native_process_receipt.rs",import.meta.url),"utf8");
test("real read-only Tauri worker status includes persisted OS process evidence",()=>{
 assert.match(lib,/native_scheduler::owned_process::process_receipt::read\(&app\)\?/);
 assert.match(lib,/native_worker_status::attach_owned_process_receipt\(/);
 assert.match(status,/process_receipt_phase/);
 assert.match(status,/process_pid/);
 assert.match(status,/process_os_liveness_verified:false/);
 assert.match(status,/process_app_progress_verified:false/);
 assert.match(receipt,/pub\(crate\) fn read\(app:&AppHandle\)/);
});
test("unknown OS launch or mismatched UUID forces Recovery Required, never retry",()=>{
 assert.match(status,/status\.state="recovery_required"/);
 assert.match(status,/status\.requires_owner_review=true/);
 assert.match(status,/status\.safe_to_auto_retry=false/);
 assert.match(status,/unresolved_or_foreign_os_process_record/);
 assert.match(status,/persisted_pid_without_host_lease_requires_owner_review_not_liveness/);
 assert.match(status,/clean_os_exit_zero_is_not_accepted_as_application_task_completion/);
 assert.doesNotMatch(status,/fn\s+(?:dispatch|execute_tool|claim_single_execution)\(/);
});
