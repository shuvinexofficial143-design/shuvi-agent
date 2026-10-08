import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const main = read("src/main.ts");
const shell = read("src/ui/workspace-ui.ts");
const store = read("src/ui/chat-store.ts");
const catalog = read("src/ui/control-center.ts");

test("control center retains real desktop chat and approval execution", () => {
  assert.match(main, /mountWorkspaceUI\(/);
  assert.match(main, /invoke<ActionResult>\("execute_action", \{ actionId \}\)/);
  assert.match(main, /invoke\("deny_action", \{ actionId \}\)/);
  assert.match(main, /renderChatPermission\(/);
  assert.match(shell, /options\.isTaskLocked\(\)/);
  assert.doesNotMatch(shell, /invoke\(["']execute_action/);
  assert.doesNotMatch(shell, /invoke\(["']deny_action/);
});

test("multi-chat history is bounded and strips internal tool results", () => {
  assert.match(store, /MAX_THREADS = 24/);
  assert.match(store, /MAX_MESSAGES = 45/);
  assert.match(store, /MAX_MESSAGE_CHARS = 3000/);
  assert.match(store, /!message\.content\.startsWith\("\[SHUVI_TOOL_RESULT\]"\)/);
  assert.match(store, /original === "running" \|\| original === "approval" \? "paused"/);
  assert.match(shell, /Concurrent execution is not enabled yet/);
});

test("dashboard and apps do not falsely present source as runtime verified", () => {
  for (const item of ["Premiere Pro","Blender","After Effects","Photoshop","Audition","Illustrator","Media Encoder","Frame.io"]) {
    assert.ok(catalog.includes(item), item + " missing from catalog");
  }
  assert.match(catalog, /Separate repository/);
  assert.match(catalog, /Source available/);
  assert.match(catalog, /queue scheduler is not active yet/);
  assert.match(catalog, /memoryMB == null \? "Not available"/);
});

test("new navigation preserves existing task and connection sections", () => {
  for (const name of ["dashboard","chat","apps","approvals","actions","workspace","premiere","provider"]) {
    assert.ok(shell.includes('data-view="' + name + '"'), name + " route missing");
  }
  assert.match(main, /premiere_bridge_start/);
  assert.match(main, /renderPremiereBridgeStatus/);
  assert.match(main, /saveActiveCheckpoint/);
});
