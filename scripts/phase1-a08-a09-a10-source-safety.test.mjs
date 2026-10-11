import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const bounded=readFileSync(new URL("../src-tauri/src/bounded_child.rs",import.meta.url),"utf8");
const atomic=readFileSync(new URL("../src-tauri/src/atomic_file.rs",import.meta.url),"utf8");
const lease=readFileSync(new URL("../src-tauri/src/execution_lease.rs",import.meta.url),"utf8");
test("A08 aborts a helper when output exceeds 8 MiB instead of draining indefinitely",()=>{
  assert.match(bounded,/checked_add\(n\)/);
  assert.match(bounded,/Err\("UI helper output exceeded/);
  assert.match(bounded,/rx\.try_recv\(\)/);
  assert.match(bounded,/terminate_owned_child\(&mut child\)/);
  assert.match(bounded,/excessive_output_is_rejected_before_process_deadline/);
});
test("A08 has one absolute child-exit and output-pipe deadline",()=>{
  assert.match(bounded,/start\.elapsed\(\)>=deadline/);
  assert.doesNotMatch(bounded,/recv_timeout\(Duration::from_secs\(2\)\)/);
  assert.doesNotMatch(bounded,/child\.wait\(\)/);
});
test("A10 checks ancestor links and Windows reparse entries before replacement",()=>{
  assert.match(atomic,/fn ensure_real_directory_ancestors/);
  assert.match(atomic,/for ancestor in parent\.ancestors\(\)/);
  assert.match(atomic,/FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.match(atomic,/is_link_or_reparse\(&metadata\)/);
  assert.match(atomic,/intermediate_symlink_directory_is_rejected/);
});
test("A10 does not silently discard staged data when OS replacement outcome is uncertain",()=>{
  assert.match(atomic,/publication_attempted=true/);
  assert.match(atomic,/if !publication_attempted \|\| result\.is_ok\(\)/);
  assert.match(atomic,/uncertain outcome; inspect target/);
});
test("A09 tests real concurrent ownership rejection",()=>{
  assert.match(lease,/two_real_threads_cannot_both_edit_desktop_at_once/);
  assert.match(lease,/std::thread::spawn/);
  assert.match(lease,/Barrier::new\(2\)/);
  assert.match(lease,/claim_single_execution\(&lock\)\.is_err\(\)/);
});

test("A08 the overflow integration fixture is small and shares the production stream-limited collector",()=>{
 assert.match(bounded,/collect_with_deadline_capped\(child,deadline,MAX_UI_HELPER_STREAM_BYTES\)/);
 assert.match(bounded,/drain_limited\(stdout,max_stream_bytes\)/);
 assert.match(bounded,/drain_limited\(stderr,max_stream_bytes\)/);
 assert.match(bounded,/collect_with_deadline_capped\(child,Duration::from_secs\(15\),256\)/);
 assert.doesNotMatch(bounded,/Console\]::Out\.Write\('x' \* 9000000\)/);
});
