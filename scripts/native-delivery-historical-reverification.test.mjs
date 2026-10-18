import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const backend=read("src-tauri/src/native_task_delivery.rs"),archive=read("src-tauri/src/native_delivery_history.rs");
const lib=read("src-tauri/src/lib.rs"),ui=read("src/main.ts"),contract=read("scripts/phase1-a01-ui-ipc-parity.test.mjs");
test("only an exact archived canonical UUID can trigger bounded read-only reinspection",()=>{
 assert.match(archive,/fn exact_receipt\(/);
 assert.match(archive,/super::valid_uuid\(id\)/);
 assert.match(archive,/exact_archived_uuid_retrieval_rejects_forged_or_nonexistent_actions/);
 assert.match(backend,/pub\(crate\) fn verify_historical\(/);
 assert.match(backend,/history::exact_receipt\(&receipt_path,first_action_id\)\?/);
 assert.match(backend,/receipt_lock::DeliveryReceiptOsLock::take\(&receipt_path\)\?/);
 assert.match(backend,/crate::read_action_audit_receipt\(app,&step.action_id\)\?/);
 assert.match(backend,/global_hash_slots::HashSlot::take\(&root\)\?/);
 assert.match(backend,/check_artifact\(artifact,&step.tool\)\?/);
 assert.match(backend,/verify_blender_certificates\(app,&completed.steps\)\?/);
 assert.doesNotMatch(archive,/tauri::command|Command::new|shell\(/);
});
test("desktop offers explicit click-only rehash instead of presenting historical metadata as fresh success",()=>{
 assert.match(lib,/fn native_task_delivery_verify_history\(/);
 assert.match(lib,/native_task_delivery::verify_historical\(&app,&first_action_id\)/);
 assert.match(lib,/native_task_delivery_verify_history,/);
 assert.match(contract,/"native_task_delivery_verify_history"/);
 assert.match(ui,/Verify files now/);
 assert.match(ui,/invoke<NativeHistoricalDeliveryVerification>/);
 assert.match(ui,/filesVerifiedNow!==true/);
 assert.match(ui,/creative quality still untested/);
});
