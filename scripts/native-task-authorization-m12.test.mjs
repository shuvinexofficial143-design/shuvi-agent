import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const kernel=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/native_task_grant.rs",import.meta.url),"utf8");
test("M1.2 is compiled under the existing native Rust grant module, not a frontend bypass",()=>{
 assert.match(bridge,/pub\(crate\) mod task_authorization/);
 assert.match(kernel,/fn reserve_prepared\(/);
 assert.doesNotMatch(kernel,/pub\(crate\) fn reserve_prepared\(/);
 assert.match(kernel,/pub\(crate\) fn reserve_after_native_preflight/);
 assert.match(kernel,/native_worker_job::require_resolved\(app\)/);
 assert.match(kernel,/fn record_audit\(/);
 assert.doesNotMatch(kernel,/pub\(crate\) fn record_audit\(/);
});
test("M1.2 only reconciles from the real exclusive Rust worker journal",()=>{
 assert.match(kernel,/pub\(crate\) fn reconcile_from_rust_journal/);
 assert.match(kernel,/native_worker_job::read\(app\)/);
 assert.match(kernel,/receipt\.action_id/);
 assert.match(kernel,/receipt\.tool/);
 assert.match(kernel,/receipt\.audit_success/);
 assert.match(kernel,/\"owner_reviewed_unknown\",None/);
 assert.match(kernel,/\"audit_verified\",Some\(true\)/);
 assert.match(kernel,/issued_owner_consents/);
 assert.match(kernel,/self\.issued_owner_consents\.insert/);
 assert.match(kernel,/can_resume_without_owner/);
});
test("M1.2 cannot claim one-click execution until the native executor calls its new adapter",()=>{
 const libStat=readFileSync(new URL("../src-tauri/src/native_task_grant.rs",import.meta.url),"utf8");
 assert.match(libStat,/It is not yet an execution grant/);
 assert.match(kernel,/Existing Allow once, exact-file physical checks, UIA root binding and Rust/);
 assert.match(kernel,/action audit remain mandatory until that integration is tested end-to-end/);
});
