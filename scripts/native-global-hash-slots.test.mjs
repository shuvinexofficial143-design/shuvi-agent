import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=p=>readFileSync(new URL("../src-tauri/src/"+p,import.meta.url),"utf8");
const delivery=load("native_task_delivery.rs"), slots=load("native_global_hash_slots.rs");
test("production final delivery uses kernel-budgeted read-only hash pool",()=>{
 assert.match(delivery,/mod global_hash_slots/);
 assert.match(delivery,/fn verify_with_pool/);
 assert.match(delivery,/global_hash_slots::HashSlot::take\(dir\)\?/);
 assert.match(delivery,/verify_with_pool\(&schedule,&receipt\.steps/);
 assert.match(delivery,/Some\(&global_pool\)\)\?/);
 assert.match(slots,/const SLOTS:usize=2/);
 assert.match(slots,/share_mode\(0\)/);
 assert.match(slots,/flock\(file\.as_raw_fd\(\),2\|4\)/);
 assert.match(slots,/real_kernel_handles_reject_a_third_hash_worker/);
 assert.match(slots,/concurrent_threads_respect_two_global_worker_slots/);
 assert.match(slots,/forged_lock_directory_fails_closed/);
});
test("no new GUI or shell command is introduced by OS-backed hash slots",()=>{
 assert.match(delivery,/verify_artifacts_bounded\(steps,\|artifact,tool\|/);
 assert.match(delivery,/check_artifact\(artifact,tool\)/);
 assert.doesNotMatch(slots,/tauri::command|shell\(|Command::new|spawn_for_active_action/);
});
