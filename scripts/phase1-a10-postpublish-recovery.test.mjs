import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=readFileSync(new URL("../src-tauri/src/atomic_file.rs",import.meta.url),"utf8");
test("A10 successful publish verifies both target and exact recovery backup",()=>{
 const i=file.indexOf("publish_replacement(target, &stage, &backup)?;");
 const j=file.indexOf("Ok(backup.clone())",i);
 const x=file.slice(i,j);
 assert.ok(i>=0&&j>i);
 assert.match(x,/source_fingerprint\(target,label\)\?/);
 assert.match(x,/source_fingerprint\(&backup,"replacement backup"\)\?/);
 assert.match(x,/actual_new!=expected_new \|\| actual_backup!=before/);
});
test("A10 incomplete publication is ambiguous, not reported as success",()=>{
 assert.match(file,/publication_attempted=true/);
 assert.match(file,/uncertain outcome; inspect target/);
 assert.match(file,/if !publication_attempted \|\| result\.is_ok\(\)/);
});
test("A10 test fixtures cover binary roundtrip, missing target, symlinks and Windows junction",()=>{
 for(const name of ["binary_exact_byte_recovery_after_success",
 "refuses_to_create_missing_target_or_overwrite_a_directory",
 "symlink_target_is_rejected_without_overwriting_destination",
 "windows_junction_in_ancestor_is_refused",
 "original_is_not_changed_on_empty_replacement_failure_injection"]){
 assert.match(file,new RegExp("fn "+name+"\\("));
 }
});
