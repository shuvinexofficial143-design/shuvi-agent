import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const body=readFileSync(new URL("../src-tauri/src/native_resource_lanes.rs",import.meta.url),"utf8");
test("ledger writers acquire a real OS cross-process lock around read/update/persist",()=>{
 assert.match(body,/struct CrossProcessLedgerLock/);
 assert.match(body,/share_mode\(0\)/);
 assert.match(body,/flock\(handle\.as_raw_fd\(\),2\|4\)/);
 assert.match(body,/Another Shuvi process owns the native resource ledger/);
 const reserve=body.slice(body.indexOf("fn reserve_at("),body.indexOf("pub(crate) fn reserve_blender_plan("));
 const release=body.slice(body.indexOf("fn release_at("),body.indexOf("pub(crate) fn release_after_verified_audit("));
 assert.match(reserve,/CrossProcessLedgerLock::take\(file\)\?/);
 assert.match(release,/CrossProcessLedgerLock::take\(file\)\?/);
 assert.match(body,/competing_writer_threads_cannot_both_claim_the_same_output/);
 assert.match(body,/another_native_process_lock_cannot_commit_resource_claims/);
});
test("lock never releases an uncertain action claim or changes desktop OS lease",()=>{
 assert.match(body,/no manual deletion of retained resource claims/i);
 assert.match(body,/version:1,held:Vec::new\(\)/);
 assert.match(body,/job\.phase!="audit_verified"/);
 assert.match(body,/read_verified\(app,action\)/);
 assert.doesNotMatch(body,/tauri::command|invoke_handler|taskkill/);
});
