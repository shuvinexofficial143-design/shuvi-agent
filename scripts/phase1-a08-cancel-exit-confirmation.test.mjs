import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const stop=rust.slice(rust.indexOf("fn terminate_managed_process_tree("),rust.indexOf("fn terminate_registered_process_tree(",rust.indexOf("fn terminate_managed_process_tree(")));
const cancel=rust.slice(rust.indexOf("fn cancel_running_action("),rust.indexOf("async fn execute_action(",rust.indexOf("fn cancel_running_action(")));
test("A08 all native managed process tree termination commands are bounded",()=>{
 assert.match(stop,/Command::new\("taskkill"\)/);
 assert.match(stop,/Command::new\("kill"\)/);
 assert.match(stop,/\.stdout\(Stdio::piped\(\)\)/);
 assert.match(stop,/bounded_child::collect_with_deadline\(killer, Duration::from_secs\(10\)\)/);
 assert.doesNotMatch(stop,/\.output\(\)/);
});
test("A08 successful cancellation is not inferred from taskkill status alone",()=>{
 assert.match(cancel,/expected_start = state\.managed_process_started_at/);
 assert.match(cancel,/\.get\(&pid\)\.copied\(\)/);
 assert.match(cancel,/if !output\.status\.success\(\)/);
 assert.match(cancel,/for _ in 0\.\.25/);
 assert.match(cancel,/observed_process_start_time\(pid\) != Some\(expected_start\)/);
 const loop=cancel.indexOf("observed_process_start_time(pid) != Some(expected_start)");
 const success=cancel.indexOf("return Ok(true)",loop);
 assert.ok(loop>=0&&success>loop);
 assert.match(cancel,/Cancellation outcome is unknown; inspect before retrying/);
 assert.match(cancel,/Duration::from_millis\(40\)/);
});
