import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const checkpoint=readFileSync(new URL("../src-tauri/src/premiere_checkpoint.rs",import.meta.url),"utf8");
const execution=readFileSync(new URL("../src-tauri/src/premiere_acceptance_execution.rs",import.meta.url),"utf8");

test("Premiere acceptance recovery is explicit read-only verification",()=>{
  assert.match(lib,/premiere_acceptance_verify_recovery/);
  assert.match(lib,/PremiereAcceptanceVerifyRecovery/);
  assert.match(lib,/automatic_rollback_performed":false/);
  assert.match(lib,/retry_automatically":false/);
  assert.match(lib,/Scene-marker recovery cannot be verified from timeline state alone/);
  assert.doesNotMatch(lib,/PremiereAcceptanceVerifyRecovery[\s\S]{0,2500}backup_premiere_project\(/);
});

test("checkpoint recovery requires a Shuvi v2 fingerprint receipt",()=>{
  assert.match(checkpoint,/"schema_version": 2/);
  assert.match(checkpoint,/"content_fingerprint_fnv1a64"/);
  assert.match(checkpoint,/accidental_corruption_detection_not_cryptographic_authentication/);
  assert.match(checkpoint,/verify_checkpoint\(checkpoint:&Path,expected_source:&Path\)/);
  assert.match(checkpoint,/Checkpoint content fingerprint changed after creation/);
});

test("recovery reobserves the exact pre-edit timeline state",()=>{
  assert.match(execution,/pub recovery_verified: bool/);
  assert.match(execution,/pub fn verify_recovery\(/);
  assert.match(execution,/Some\(items\.len\(\) as u64\)!=self\.before\.get\("clip_count"\)/);
  assert.match(execution,/targetSignature/);
  assert.match(execution,/exact pre-edit clip\/timeline state/);
  assert.match(execution,/recovery_requires_checkpoint_project_and_exact_pre_edit_state/);
});

test("checkpoint retention scan and reservation are serialized",()=>{
  const create=checkpoint.slice(checkpoint.indexOf("pub fn create_checkpoint("),checkpoint.indexOf("pub fn verify_checkpoint("));
  assert.match(checkpoint,/static CHECKPOINT_IO: std::sync::Mutex<\(\)>/);
  assert.match(create,/CHECKPOINT_IO\.lock\(\)/);
  assert.ok(create.indexOf("CHECKPOINT_IO.lock()") < create.indexOf("fs::read_dir(&directory)"));
  assert.ok(create.indexOf("CHECKPOINT_IO.lock()") < create.indexOf("create_new(true).open(&backup)"));
});
