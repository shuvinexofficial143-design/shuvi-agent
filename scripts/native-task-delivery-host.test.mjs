import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const m=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("final native delivery cannot bypass audit, exclusive lease, or pending approval",()=>{
 assert.match(rust,/fn finalize_native_task_delivery\(/);
 assert.match(rust,/claim_monitored_native_execution\(state.inner\(\),&app\)/);
 assert.match(rust,/native_task_delivery::finalize\(&app,steps\)/);
 assert.match(rust,/native_task_delivery_status/);
 assert.match(m,/schedule\.jobs\.iter\(\)\.any\(\|j\|j.phase!="audited"\)/);
 assert.match(m,/entry\.tool!=step\.tool\|\|entry\.event!="executed"\|\|!entry\.success/);
 assert.match(m,/check_artifact\(a,&step.tool\)/);
 assert.match(m,/fs::symlink_metadata/);
 assert.match(m,/SHA-256 changed/);
 assert.match(m,/exact_multi_worker_audit_receipts_can_be_finalized/);
 assert.match(m,/real_file_hash_is_required_and_detects_changes/);
});
test("last receipt survives clearing chat progress and supports read-only reinspection",()=>{
 const terminal=main.slice(main.indexOf('if (continuation.mode==="complete")'),
   main.indexOf("await clearActiveCheckpoint(true)",main.indexOf('if (continuation.mode==="complete")')));
 assert.match(terminal,/nativeTaskDeliveryClaims\(orchestration.task_graph,schedule\)/);
 assert.match(terminal,/invoke<NativeTaskDelivery>\("finalize_native_task_delivery"/);
 assert.match(main,/invoke<NativeTaskDelivery\|null>\("native_task_delivery_status"\)/);
 assert.match(main,/id="checkNativeTaskDelivery"/);
 assert.ok(terminal.length>0,"verified native finalization block must be nonempty");
 assert.match(terminal,/const checkpointErased=await clearActiveCheckpoint\(true\)/);
 assert.doesNotMatch(terminal,/execute_action/);
});
