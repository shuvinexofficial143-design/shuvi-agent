import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("browser session lookup revalidates exact managed process identity",()=>{
  const start=rust.indexOf("fn browser_session(");
  const end=rust.indexOf("fn cdp_command(",start);
  const block=rust.slice(start,end);
  assert.match(block,/!managed_process_identity_matches\(state, pid\)\?/);
  assert.match(block,/unregister_managed_process\(state, pid\)/);
  assert.match(block,/sessions\.remove\(&pid\)/);
  assert.match(block,/fs::remove_dir_all\(session\.profile_dir\)/);
  assert.match(block,/exact live process instance that was launched/);
});

test("all browser DOM and navigation actions go through browser_session",()=>{
  for(const arm of [
    "ToolAction::BrowserNavigate { pid, url } =>",
    "ToolAction::BrowserDomRead { pid, selector } =>",
    "ToolAction::BrowserDomClick { pid, selector } =>",
    "ToolAction::BrowserDomSetValue { pid, selector, value } =>"
  ]){
    const start=rust.indexOf(arm);
    assert.ok(start>=0,arm);
    assert.match(rust.slice(start,start+3600),/let session = browser_session\(state, pid\)\?/);
  }
});


test("runtime refresh removes stale browser profile directories",()=>{
  const start=rust.indexOf("fn current_runtime_status");
  const end=rust.indexOf("fn ensure_memory_budget",start);
  const block=rust.slice(start,end);
  assert.match(block,/let stale_profiles = sessions/);
  assert.match(block,/!live_roots\.contains\(root_pid\)/);
  assert.match(block,/session\.profile_dir\.clone\(\)/);
  assert.match(block,/sessions\.retain\(\|root_pid, _\| live_roots\.contains\(root_pid\)\)/);
  assert.match(block,/fs::remove_dir_all\(profile_dir\)/);
});


test("failed managed browser startup tears down the spawned tree and reaps the root",()=>{
  const start=rust.indexOf("ToolAction::BrowserStart { browser, url } =>");
  const end=rust.indexOf("ToolAction::BrowserNavigate",start);
  const block=rust.slice(start,end);

  for(const failure of [
    "Managed browser started, but its local DevTools endpoint did not become ready within 5 seconds.",
    "Managed browser started, but no stable page target became available for Shuvi to bind."
  ]){
    const failureIndex=block.indexOf(failure);
    assert.ok(failureIndex>=0,failure);
    const cleanup=block.slice(Math.max(0,failureIndex-500),failureIndex);
    assert.match(cleanup,/terminate_managed_process_tree\(child_pid\)/);
    assert.match(cleanup,/child\.kill\(\)/);
    assert.match(cleanup,/child\.wait\(\)/);
    assert.match(cleanup,/fs::remove_dir_all\(&profile_dir\)/);
  }
});
