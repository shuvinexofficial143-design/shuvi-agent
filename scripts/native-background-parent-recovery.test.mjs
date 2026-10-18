import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const normalize=text=>text.replaceAll('\r\n','\n');
const queue=normalize(readFileSync(new URL('../src-tauri/src/native_background_parent_queue.rs',import.meta.url),'utf8'));
const lib=normalize(readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8'));
const ui=normalize(readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'));
const types=normalize(readFileSync(new URL('../src/types.ts',import.meta.url),'utf8'));

test('M56 restart recovery reads both durable OS and parent ledgers, with no false liveness/progress',()=>{
 assert.match(queue,/fn recovery_snapshot_at\(root:&Path\)/);
 assert.match(queue,/let _os=OsLock::take\(&file\)/);
 assert.match(queue,/let queue=load\(&file\)\?/);
 assert.match(queue,/let os=super::admission::snapshot_detailed_at\(root\)\?/);
 assert.match(queue,/super::hash_readback::verify\(&receipt/);
 assert.match(queue,/owner_review_required:uncertain/);
 assert.match(queue,/holds_resource:active\(parent\)/);
 assert.match(queue,/safe_to_auto_retry:false/);
 assert.match(queue,/application_verified:false/);
 assert.match(queue,/process_liveness_verified:false/);
 assert.match(queue,/fn m56_crash_before_child_admission_is_quarantined_no_automatic_slot_release/);
 assert.match(queue,/fn m56_two_uncertain_parents_preserve_kernel_capacity_and_claimed_inputs/);
});
test('M56 owner recovery requires separately audited inspection and never unlocks held parent',()=>{
 assert.match(lib,/fn review_native_approved_parent_uncertain\(/);
 assert.match(lib,/confirmation!="REVIEW PARENT UNKNOWN"/);
 assert.match(lib,/execution_lease::claim_single_execution\(&state.native_execution_owned\)\?/);
 assert.match(lib,/read_action_audit_receipt\(&app,&parent_id\)\?/);
 assert.match(lib,/original.tool!="queue_readonly_sha_parent"/);
 assert.match(lib,/read_action_audit_receipt\(&app,&inspection_action_id\)\?/);
 assert.match(lib,/inspection.timestamp_ms<=original.timestamp_ms/);
 assert.match(lib,/mark_owner_reviewed_uncertain_at\(&root,&parent_id\)\?/);
 assert.match(lib,/event:"native_parent_owner_reviewed_unknown"/);
 assert.match(queue,/fn mark_owner_reviewed_uncertain_at\(/);
 assert.match(queue,/parent.phase="outcome_unknown"/);
 assert.match(queue,/fn m56_recovery_status_rejects_corrupt_history_before_reporting_any_safe_phase/);
 const review=lib.slice(lib.indexOf('fn review_native_approved_parent_uncertain('),
   lib.indexOf('#[tauri::command]\nfn native_approved_parent_queue_status('));
 assert.doesNotMatch(review,/run_trusted_sha256|Command::new|TerminateProcess|taskkill|safe_to_auto_retry:true/);
});
test('M56 owner UI labels held/quarantine and refuses to forge process or app status',()=>{
 assert.match(ui,/invoke<NativeApprovedParentRecoveryView\[\]>\(/);
 assert.match(ui,/"native_approved_parent_recovery_status"/);
 assert.match(ui,/evidence\?\.holdsResource\?" · RESOURCE HELD"/);
 assert.match(ui,/invoke<boolean>\("review_native_approved_parent_uncertain"/);
 assert.match(ui,/inspectionActionId:inspected.trim\(\)/);
 assert.match(ui,/confirmation:"REVIEW PARENT UNKNOWN"/);
 assert.match(ui,/resource stays HELD/);
 assert.match(types,/export type NativeApprovedParentRecoveryView/);
 assert.match(types,/safeToAutoRetry: false/);
 assert.match(lib,/native_approved_parent_recovery_status,\n/);
 assert.match(lib,/review_native_approved_parent_uncertain,\n/);
});