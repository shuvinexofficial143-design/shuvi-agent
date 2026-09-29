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
