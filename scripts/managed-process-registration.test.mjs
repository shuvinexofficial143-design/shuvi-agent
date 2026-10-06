import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("launch_app fails closed if its PID cannot be registered",()=>{
  const start=rust.indexOf("ToolAction::LaunchApp { program, args } =>");
  const end=rust.indexOf("ToolAction::OpenUrl",start);
  const block=rust.slice(start,end);
  assert.match(block,/let mut child = Command::new/);
  assert.match(block,/register_managed_process\(state, child_pid\)/);
  assert.match(block,/terminate_managed_process_tree\(child_pid\)/);
  assert.match(block,/child\.wait\(\)/);
  assert.match(block,/stopped before it could remain untracked/);
});

test("managed browser rolls back both process and profile on registration failure",()=>{
  const start=rust.indexOf("ToolAction::BrowserStart { browser, url } =>");
  const end=rust.indexOf("ToolAction::BrowserNavigate",start);
  const block=rust.slice(start,end);
  assert.match(block,/register_managed_process\(state, child_pid\)/);
  assert.match(block,/match state\.browser_sessions\.lock\(\)/);
  assert.match(block,/unregister_managed_process\(state, child_pid\)/);
  assert.match(block,/terminate_managed_process_tree\(child_pid\)/);
  assert.match(block,/fs::remove_dir_all\(&profile_dir\)/);
  assert.match(block,/partial registration could remain active/);
});
