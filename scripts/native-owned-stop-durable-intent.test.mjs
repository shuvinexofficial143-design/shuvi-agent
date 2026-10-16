import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const owned=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
const receipt=readFileSync(new URL("../src-tauri/src/native_process_receipt.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../src-tauri/src/native_worker_status.rs",import.meta.url),"utf8");
test("owner Stop persists exact action UUID before returning its acknowledgement",()=>{
 assert.match(lib,/request_cancel_exact_persisted\(&app,&action_id\)/);
 assert.match(owned,/fn request_cancel_exact_persisted\(app:&AppHandle,id:&str\)/);
 assert.match(owned,/mark_cancel_requested_at\(&path,id\)/);
 assert.match(owned,/owner\.cancel_requested=true/);
 assert.match(owned,/durable\.map\(\|_\|true\)/);
 assert.match(receipt,/fn mark_cancel_requested_at\(file:&Path,id:&str\)/);
 assert.match(receipt,/current\.action_id!=id/);
});
test("persisted Stop cannot fake clean exit or automatic retry after restart",()=>{
 assert.match(receipt,/#\[serde\(default\)\]\s+pub cancel_requested:bool/);
 assert.match(receipt,/r\.phase=="exited"&&r\.cancel_requested/);
 assert.match(receipt,/owner_cancel_persists_through_restart_and_prevents_forged_clean_exit/);
 assert.match(status,/pub process_cancel_requested:bool/);
 assert.match(status,/owner_stop_requested_os_outcome_unverified/);
 assert.match(status,/stopped_on_previous_host_is_a_recovery_case_not_a_verified_process_exit/);
 assert.match(status,/status\.safe_to_auto_retry=false/);
});
