import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
test("authorized DAG audits precede bounded two-way read-only SHA-256 workers",()=>{
 assert.match(source,/fn verify_artifacts_bounded/);
 assert.match(source,/std::thread::scope\(/);
 assert.match(source,/let left=scope\.spawn/);
 assert.match(source,/let right=scope\.spawn/);
 assert.match(source,/a\?\?;b\?\?/);
 assert.match(source,/verify_artifacts_bounded\(steps,\|artifact,tool\|/);
 assert.match(source,/global_hash_slots::HashSlot::take\(dir\)\?/);
 assert.match(source,/check_artifact\(artifact,tool\)/);
 assert.ok(source.indexOf("let entry=audit(")<source.indexOf("verify_artifacts_bounded(steps,|artifact,tool|"));
});
test("duplicate file alias and mutation still fail safely; no unpermissioned GUI execution",()=>{
 assert.match(source,/if first_path==second_path/);
 assert.match(source,/candidate=Some\(i\)/);
 assert.match(source,/queue_skips_aliased_head_and_runs_next_disjoint_output_in_parallel/);
 assert.match(source,/fs::canonicalize\(&first\.0\.path\)/);
 assert.match(source,/if size!=a\.bytes\|\|hash!=a\.sha256/);
 assert.match(source,/independent_artifacts_use_two_bounded_read_only_verification_threads/);
 assert.match(source,/aliased_output_is_not_read_in_parallel_and_tamper_fails_closed/);
 assert.doesNotMatch(source,/tauri::command|std::process::Command|execute_model_shell/);
});
