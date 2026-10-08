import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/telegram_control.rs", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const telegram = readFileSync(new URL("../src/telegram-ui.ts", import.meta.url), "utf8");

test("Telegram is registered only through Shuvi native runtime and owner pairing", () => {
  assert.match(lib, /mod telegram_control;/);
  assert.match(lib, /\.manage\(telegram_state\)/);
  for (const command of ["telegram_control_status","telegram_control_start","telegram_control_stop",
    "telegram_save_bot_token","telegram_delete_bot_token","telegram_unpair","telegram_send_message"]) {
    assert.ok(lib.includes("telegram_control::" + command), command);
  }
  assert.match(rust, /message\.chat\.kind != "private"/);
  assert.match(rust, /paired != Some\(message\.chat\.id\)/);
  assert.match(rust, /keyring::Entry/);
  assert.doesNotMatch(telegram, /localStorage|sessionStorage|document\.cookie/);
});

test("Telegram controls require exact pending action code and native approval flow", () => {
  assert.match(rust, /code\.len\(\) == 8/);
  assert.match(rust, /code\.chars\(\)\.all\(\|ch\| ch\.is_ascii_hexdigit\(\)\)/);
  assert.match(frontend, /pendingChatProposal/);
  assert.match(frontend, /action\.id\.slice\(0, 8\)\.toLowerCase\(\) !== code\.toLowerCase\(\)/);
  assert.match(frontend, /button\.click\(\); \/\/ Existing Shuvi Rust permission gate/);
  assert.match(telegram, /\/approve CODE/);
  assert.doesNotMatch(telegram, /invoke\("execute_action"/);
  assert.doesNotMatch(rust, /execute_action\s*\(/);
});

test("Telegram prompt uses the existing Desktop chat form and replies are one-way by default", () => {
  assert.match(frontend, /requestSubmit\(\)/);
  assert.match(frontend, /if \(busy \|\| pendingAction \|\| manualActionRunning/);
  assert.match(frontend, /if \(!response\.tool_proposal\) telegramUI\?\.assistantAnswer/);
  assert.match(telegram, /if \(!telegramOrigin\) return;/);
  assert.match(telegram, /assistantAnswer\(reply\)/);
  assert.match(telegram, /approvalPending\(summary, risk, actionCode\)/);
});

test("Remote Telegram polling skips stale queued commands and checks stop generation", () => {
  assert.match(rust, /"offset", "-1"/);
  assert.match(rust, /if !valid_bootstrap/);
  assert.match(rust, /generation\.load\(Ordering::Acquire\) != generation/);
  assert.match(rust, /"allowed_updates", r#"\["message"\]"#/);
  assert.match(telegram, /await listen<Command>\("shuvi:\/\/telegram-control"/);
  assert.match(rust, /"\/resume"/);
  assert.match(telegram, /command === "resume"/);
});

test("Telegram cannot be mistaken for a fake always-on cloud runtime", () => {
  assert.match(telegram, /Bot stopped/);
  assert.match(telegram, /Telegram native commands unavailable/);
  assert.match(telegram, /The matching pending action was/);
});
