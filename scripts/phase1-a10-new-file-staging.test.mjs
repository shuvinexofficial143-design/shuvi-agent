import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const atomic=readFileSync(new URL("../src-tauri/src/atomic_file.rs",import.meta.url),"utf8");
test("A10 new file publication uses same-directory fsynced staging and no-overwrite hard link",()=>{
 const begin=atomic.indexOf("fn create_new_impl(");
 const end=atomic.indexOf("pub(crate) fn create_new_verified(",begin);
 const body=atomic.slice(begin,end);
 assert.ok(begin>=0&&end>begin);
 assert.match(body,/ensure_real_directory_ancestors\(parent\)\?/);
 assert.match(body,/OpenOptions::new\(\)\.write\(true\)\.create_new\(true\)\.open\(&stage\)/);
 assert.match(body,/file\.sync_all\(\)/);
 assert.match(body,/fs::hard_link\(&stage,target\)/);
 assert.doesNotMatch(body,/fs::rename\(&stage,target\)/);
 assert.match(body,/source_fingerprint\(target,label\)\?/);
 assert.match(body,/if !published \|\| result\.is_ok\(\)/);
});
test("A10 write_file has two distinct fail-closed paths for existing and new targets",()=>{
 const start=native.indexOf("ToolAction::WriteFile { path, content } =>",native.indexOf("async fn execute_tool_with_action_id("));
 const end=native.indexOf("ToolAction::CreateDirectory",start);
 const body=native.slice(start,end);
 assert.match(body,/fs::symlink_metadata\(target\)/);
 assert.match(body,/atomic_file::replace_existing\(/);
 assert.match(body,/atomic_file::create_new_verified\(/);
 assert.doesNotMatch(body,/\.write_all\(/);
});
test("A10 disposable Rust fixtures cover full file, injected failure, concurrent destination and reparse paths",()=>{
 for(const name of [
  "new_file_is_published_only_after_complete_binary_write",
  "new_file_injected_failure_never_publishes_partial_target",
  "new_file_refuses_to_overwrite_concurrent_existing_target",
  "new_file_rejects_symlinked_ancestor",
  "new_file_rejects_windows_junction_ancestor"]){
  assert.ok(atomic.includes("fn "+name+"("),name+" fixture missing");
 }
});
