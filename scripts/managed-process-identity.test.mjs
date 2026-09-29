import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("managed process ownership is bound to PID plus process start time",()=>{
  assert.match(rust,/managed_process_started_at: Mutex<HashMap<u32, u64>>/);
  assert.match(rust,/fn observed_process_start_time\(pid: u32\) -> Option<u64>/);
  assert.match(rust,/process\.start_time\(\)/);
  assert.match(rust,/fn register_managed_process\(state: &ActionState, pid: u32\)/);
  assert.match(rust,/fn managed_process_identity_matches\(state: &ActionState, pid: u32\)/);
  assert.match(rust,/actual == expected/);
});

test("runtime RAM tracking drops stale or PID-reused managed roots",()=>{
  const start=rust.indexOf("fn current_runtime_status");
  const end=rust.indexOf("fn ensure_memory_budget",start);
  const block=rust.slice(start,end);
  assert.match(block,/let identities = state[\s\S]*managed_process_started_at/);
  assert.match(block,/process\.start_time\(\)/);
  assert.match(block,/identities\.get\(child_pid\)\.copied\(\) == actual/);
  assert.match(block,/stored\.retain\(\|root_pid, _\| live_roots\.contains\(root_pid\)\)/);
});

test("destructive stop and cancellation require the same live process identity",()=>{
  const stopStart=rust.indexOf("ToolAction::StopManagedProcess { pid } =>");
  const stopEnd=rust.indexOf("ToolAction::CaptureScreen",stopStart);
  const stop=rust.slice(stopStart,stopEnd);
  assert.match(stop,/managed_process_identity_matches\(state, pid\)\?/);
  assert.match(stop,/exact live process instance/);

  const cancelStart=rust.indexOf("fn cancel_running_action(");
  const cancelEnd=rust.indexOf("async fn execute_action(",cancelStart);
  const cancel=rust.slice(cancelStart,cancelEnd);
  assert.match(cancel,/managed_process_identity_matches\(state\.inner\(\), pid\)\?/);
  assert.match(cancel,/unregister_managed_process\(state\.inner\(\), pid\)/);
});

test("all long-lived and validation launches register managed process identity",()=>{
  for(const arm of [
    "ToolAction::LaunchApp { program, args } =>",
    "ToolAction::BrowserStart { browser, url } =>",
    "ToolAction::PremiereLaunch { project } =>",
    "ToolAction::RunProjectTask { path, task } =>",
    "ToolAction::PowerShell { command } =>"
  ]){
    const start=rust.indexOf(arm);
    assert.ok(start>=0,arm);
    assert.match(rust.slice(start,start+7000),/register_managed_process\(state, child_pid\)/);
  }
});


test("RAM watchdogs stop only the exact registered process instance",()=>{
  assert.match(rust,/fn terminate_registered_process_tree\(state: &ActionState, pid: u32\)/);
  const helper=rust.slice(
    rust.indexOf("fn terminate_registered_process_tree"),
    rust.indexOf("fn classify_powershell")
  );
  assert.match(helper,/managed_process_identity_matches\(state, pid\)\?/);
  assert.match(helper,/unregister_managed_process\(state, pid\)/);
  assert.match(helper,/terminate_managed_process_tree\(pid\)/);

  for(const arm of [
    "ToolAction::RunProjectTask { path, task } =>",
    "ToolAction::PowerShell { command } =>"
  ]){
    const start=rust.indexOf(arm);
    const next=rust.indexOf("\n        ToolAction::",start+arm.length);
    const block=rust.slice(start,next<0?rust.length:next);
    assert.match(block,/while managed_process_identity_matches\(state, child_pid\)\.unwrap_or\(false\)/);
    assert.match(block,/terminate_registered_process_tree\(state, child_pid\)/);
    assert.doesNotMatch(block,/while process_is_alive\(child_pid\)/);
  }
});
