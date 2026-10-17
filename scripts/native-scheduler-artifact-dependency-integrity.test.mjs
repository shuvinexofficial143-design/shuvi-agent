import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=(name)=>readFileSync(new URL("../src-tauri/src/"+name,import.meta.url),"utf8");
const scheduler=load("native_scheduler.rs");
const journal=load("native_worker_job.rs");
test("before every DAG admission, transitive audited Blender ancestors are rehashed",()=>{
 assert.match(scheduler,/fn verify_dependency_artifacts/);
 assert.match(scheduler,/fn visit<F>/);
 assert.match(scheduler,/for parent in &step\.depends_on/);
 assert.match(scheduler,/verify_dependency_artifacts\(&merged,step,/);
 assert.match(scheduler,/verify_dependency_artifacts\(&schedule,step,/);
 assert.match(scheduler,/native_blender_action_artifact::read_verified\(app,parent\)/);
 assert.match(scheduler,/transitive_blender_dependency_requires_fresh_exact_artifact_evidence/);
});
test("restart recovery and final audit cannot promote tampered Blender outputs",()=>{
 assert.match(scheduler,/fn verify_blender_recovery/);
 assert.match(scheduler,/verify_blender_recovery\(&schedule,audit\.as_ref\(\),/);
 assert.match(scheduler,/verify_blender_recovery\(schedule,journal\.as_ref\(\),/);
 assert.match(scheduler,/post_crash_blender_success_requires_verified_output_before_dag_recovery/);
 const target=journal.slice(journal.indexOf("pub(crate) fn audit("),journal.indexOf("pub(crate) fn read("));
 assert.match(target,/native_blender_action_artifact::read_verified\(app,id\)\?/);
 assert.ok(target.indexOf("native_blender_action_artifact::read_verified(app,id)")
    <target.indexOf("audited_at("));
 assert.doesNotMatch(scheduler,/tauri::command|unrestricted_shell_execute/);
});
