import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const job=readFileSync(new URL("../src-tauri/src/native_worker_job.rs",import.meta.url),"utf8");
const child=readFileSync(new URL("../src-tauri/src/bounded_child.rs",import.meta.url),"utf8");
test("BUG-003: OS helper timeout is explicitly UNKNOWN, never generic FAILED",()=>{
 assert.match(child,/timed out\. The outcome of any external action is unknown/);
 const classifier=lib.slice(lib.indexOf("fn native_external_outcome_unknown("),lib.indexOf("fn audit_safe_action_detail("));
 assert.match(classifier,/outcome of any external action is unknown/);
 assert.match(classifier,/text\.contains\("timed out"\)/);
 const executor=lib.slice(lib.indexOf("async fn execute_action("),lib.indexOf("async fn execute_powershell("));
 const err=executor.slice(executor.lastIndexOf("        Err(error) => {"));
 assert.match(err,/let uncertain=native_external_outcome_unknown\(&error\)/);
 assert.match(err,/if uncertain\{"outcome_unknown"\}else\{"failed"\}/);
 assert.match(err,/if uncertain \{[\s\S]*native_worker_job::record_outcome_unknown\(&app,&action_id,now_ms\(\)\)\?/);
 assert.ok(err.indexOf("return Err(format!(")<err.indexOf("native_worker_job::audit(&app,&action_id,false"));
 assert.match(err,/Native action outcome UNKNOWN; do not retry automatically/);
});
test("BUG-003: native worker persists distinct unknown until exact owner review, no release or second job",()=>{
 assert.match(job,/\("outcome_unknown",None\)=>Ok\(\)/);
 assert.match(job,/fn outcome_unknown_at\(/);
 assert.match(job,/record\.phase="outcome_unknown"\.into\(\)/);
 assert.match(job,/record\.audit_success=None/);
 assert.match(job,/if !matches!\(job\.phase\.as_str\(\),"running"\|"outcome_unknown"\)/);
 assert.match(job,/if !matches!\(existing\.phase\.as_str\(\),"running"\|"outcome_unknown"\)/);
 assert.match(job,/pub\(crate\) fn record_outcome_unknown\(/);
 const record=job.slice(job.indexOf("pub(crate) fn record_outcome_unknown("),job.indexOf("pub(crate) fn audit("));
 assert.doesNotMatch(record,/crate::native_scheduler::resource_lanes::release_after_verified_audit\(/);
 assert.match(job,/unknown_native_side_effect_is_durable_and_requires_exact_owner_reconciliation/);
});

test("BUG-003: owner recovery reads exact native UNKNOWN receipt, requires explicit review, UI exposes a safe button",()=>{
 const reader=lib.slice(lib.indexOf("fn read_action_audit_receipt("),lib.indexOf("fn premiere_checkpoint_from_audit("));
 assert.match(reader,/"denied" \| "outcome_unknown"/);
 const reconcile=lib.slice(lib.indexOf("fn reconcile_native_worker_job("),lib.indexOf("fn native_worker_history("));
 assert.match(reconcile,/if !matches!\(job\.phase\.as_str\(\),"running"\|"outcome_unknown"\)/);
 assert.match(reconcile,/receipt\.event=="outcome_unknown"/);
 assert.match(reconcile,/if receipt\.event=="outcome_unknown" \{[\s\S]*?None/);
 assert.match(reconcile,/confirmation!="REVIEW UNKNOWN"/);
 const status=readFileSync(new URL("../src-tauri/src/native_worker_status.rs",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(status,/else if job\.phase=="outcome_unknown"/);
 assert.match(status,/status\.requires_owner_review=true/);
 assert.match(ui,/"running","outcome_unknown"\]\.includes\(nativeHostStatus\.durableJobPhase/);
});
