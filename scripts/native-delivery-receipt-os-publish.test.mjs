import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
const lock=readFileSync(new URL("../src-tauri/src/native_delivery_receipt_lock.rs",import.meta.url),"utf8");
test("cross-instance last receipt is serialized and unchanged repeated action is idempotent",()=>{
 assert.match(src,/mod receipt_lock/);
 assert.match(src,/receipt_lock::DeliveryReceiptOsLock::take\(&receipt_path\)\?/g);
 assert.match(src,/fn publish_at\(/);
 assert.match(src,/if old\.objective==receipt\.objective &&old\.revision==receipt\.revision/);
 assert.match(src,/old\.steps==receipt\.steps/);
 assert.match(src,/return Ok\(old\)/);
 assert.match(src,/A prior delivered native action UUID cannot be republished/);
 assert.match(src,/duplicate_delivery_exact_action_proof_is_idempotent_and_preserves_time/);
 assert.match(src,/cross_process_receipt_lock_blocks_both_publish_and_inspection/);
 assert.match(lock,/share_mode\(0\)/);
 assert.match(lock,/flock\(file\.as_raw_fd\(\),2\|4\)/);
 assert.match(lock,/forged_directory_at_receipt_lock_path_is_not_silently_bypassed/);
});
test("long verification cannot commit task delivery after scheduler changed",()=>{
 assert.match(src,/latest\.objective!=schedule\.objective/);
 assert.match(src,/latest\.revision!=schedule\.revision/);
 assert.match(src,/latest\.jobs!=schedule\.jobs/);
 assert.match(src,/publish_at\(&receipt_path,&receipt\)/);
 assert.match(src,/verify_blender_certificates\(app,&receipt\.steps\)\?/);
 assert.doesNotMatch(lock,/tauri::command|Command::new|spawn\(/);
});
