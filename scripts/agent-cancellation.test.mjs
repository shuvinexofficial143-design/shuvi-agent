import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("running project task is correlated to the exact prepared action ID",()=>{
  assert.match(rust,/running_action_children: Mutex<HashMap<String, u32>>/);
  assert.match(rust,/running_action_tools: Mutex<HashMap<String, String>>/);
  assert.match(rust,/async fn execute_tool_with_action_id\(/);
  assert.match(rust,/execution_action_id: Option<&str>/);
  const run=rust.slice(rust.indexOf("ToolAction::RunProjectTask { path, task }"),rust.indexOf("ToolAction::GitStatus { path }"));
  assert.match(run,/running\.insert\(action_id\.to_string\(\), child_pid\)/);
  assert.match(run,/running\.remove\(action_id\)/);
  const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell"));
  assert.match(execute,/execute_tool_with_action_id\([\s\S]*?action,[\s\S]*?state\.inner\(\),[\s\S]*?&app,[\s\S]*?Some\(action_id\.as_str\(\)\),?[\s\S]*?\)\.await/);
});

test("cancel_running_action only denies or stops the exact run_project_task action UUID",()=>{
  const cancel=rust.slice(rust.indexOf("fn cancel_running_action("),rust.indexOf("async fn execute_action("));
  assert.match(cancel,/Uuid::parse_str\(&action_id\)/);
  assert.match(cancel,/action\.tool == "run_project_task"/);
  assert.match(cancel,/event: "denied"/);
  assert.match(cancel,/running_action_tools/);
  assert.match(cancel,/Some\("run_project_task"\)/);
  assert.match(cancel,/for _ in 0\.\.50/);
  assert.match(cancel,/Duration::from_millis\(20\)/);
  assert.match(cancel,/running_action_children/);
  assert.match(cancel,/managed_children[\s\S]*contains\(&pid\)/);
  assert.match(cancel,/taskkill/);
  assert.doesNotMatch(cancel,/arg_u32/);
  assert.match(rust,/cancel_running_action,[\s\S]*execute_action/);
});


test("Stop button requests cancellation by exact executing action ID",()=>{
  assert.match(main,/let executingActionId: string \| null = null/);
  assert.match(main,/let executingCancellation: \{ actionId: string; promise: Promise<boolean> \} \| null = null/);
  const execute=main.slice(main.indexOf("async function executePendingProposal"),main.indexOf("function renderChatPermission"));
  assert.match(execute,/executingActionId = actionId/);
  assert.match(execute,/await actionCancellationConfirmed\(actionId\)/);
  assert.match(execute,/cancelledByUser \? "denied"/);
  assert.match(execute,/cancelledByUser \? false : !result\.success && receiptMatches/);
  assert.match(execute,/cancelled_by_user: true/);
  assert.match(execute,/finally \{/);
  const stop=main.slice(main.indexOf('el<HTMLButtonElement>("#stopButton")'),main.indexOf("document.querySelectorAll<HTMLButtonElement>"));
  assert.match(stop,/if \(executingActionId\)/);
  assert.match(stop,/invoke<boolean>\("cancel_running_action", \{ actionId \}\)/);
  assert.match(stop,/executingCancellation = \{ actionId, promise \}/);
  assert.match(stop,/cannot race ahead of cancellation confirmation/);
});

test("user-cancelled execution is not counted as a confirmed real tool failure",()=>{
  const execute=main.slice(main.indexOf("async function executePendingProposal"),main.indexOf("function renderChatPermission"));
  assert.match(execute,/cancelledByUser \? false : confirmedFailure/);
  assert.match(execute,/execution_failure_audit_confirmed: cancelledByUser \? false : confirmedFailure/);
  assert.match(execute,/retry_automatically: false/);
});


test("cancellation classification awaits the exact in-flight cancellation promise",()=>{
  assert.match(main,/async function actionCancellationConfirmed\(actionId: string\): Promise<boolean>/);
  assert.match(main,/request\.actionId !== actionId/);
  assert.match(main,/return await request\.promise/);
  const stop=main.slice(main.indexOf('el<HTMLButtonElement>("#stopButton")'),main.indexOf("document.querySelectorAll<HTMLButtonElement>"));
  assert.match(stop,/const promise = invoke<boolean>\("cancel_running_action", \{ actionId \}\)/);
  assert.ok(stop.indexOf("executingCancellation = { actionId, promise }") < stop.indexOf("await promise"));
  const execute=main.slice(main.indexOf("async function executePendingProposal"),main.indexOf("function renderChatPermission"));
  assert.match(execute,/const cancelledByUser = await actionCancellationConfirmed\(actionId\)/);
  assert.match(execute,/executingCancellation\?\.actionId === actionId/);
});


test("execute_action has no pending-to-active cancellation gap",()=>{
  const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell"));
  const getPending=execute.indexOf(".get(&action_id)");
  const register=execute.indexOf("running_action_tools");
  const removePending=execute.indexOf(".remove(&action_id)",register);
  assert.ok(getPending>=0);
  assert.ok(register>getPending);
  assert.ok(removePending>register);
  assert.match(execute,/running\.remove\(&action_id\)/);
  assert.match(execute,/children\.remove\(&action_id\)/);
});
