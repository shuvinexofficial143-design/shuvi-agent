import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("dead managed browser roots are removed from session state",()=>{
  const start=rust.indexOf("fn current_runtime_status");
  const end=rust.indexOf("fn ensure_memory_budget",start);
  const block=rust.slice(start,end);
  assert.match(block,/state\.browser_sessions\.lock\(\)/);
  assert.match(block,/sessions\.retain\(\|root_pid, _\| live_roots\.contains\(root_pid\)\)/);
});

test("inactive browser profiles are bounded without deleting active session profiles",()=>{
  assert.match(rust,/const MAX_STALE_BROWSER_PROFILES: usize = 8/);
  const start=rust.indexOf("fn prune_inactive_browser_profiles");
  const end=rust.indexOf("fn browser_session",start);
  const block=rust.slice(start,end);
  assert.match(block,/active_profiles\.contains\(&path\)/);
  assert.match(block,/stale\.sort_by/);
  assert.match(block,/skip\(MAX_STALE_BROWSER_PROFILES\)/);
  assert.match(block,/fs::remove_dir_all\(path\)/);
});

test("browser start prunes stale profiles before creating a collision-resistant active profile",()=>{
  const first=rust.indexOf("ToolAction::BrowserStart { browser, url }");
  const start=rust.indexOf("ToolAction::BrowserStart { browser, url }",first+1);
  const end=rust.indexOf("ToolAction::BrowserNavigate",start);
  const block=rust.slice(start,end);
  assert.match(block,/prune_inactive_browser_profiles\(state, &profiles_root\)/);
  assert.match(block,/format!\("\{\}-\{\}-\{\}", browser, now_ms\(\), Uuid::new_v4\(\)\)/);
  assert.ok(block.indexOf("prune_inactive_browser_profiles") < block.indexOf("fs::create_dir_all(&profile_dir)"));
});
