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


test("UI batch 2 uses searchable conversations and an explicit delete confirmation", () => {
  assert.match(shell, /id="chatSearch"/);
  assert.match(shell, /id="threadDialog"/);
  assert.match(shell, /dialog\.showModal\(\)/);
  assert.match(shell, /Confirm delete/);
  assert.doesNotMatch(shell, /window\.prompt\(/);
  assert.match(catalog, /renderThreadList\(container: HTMLElement, threads: ChatThread\[\], activeId: string, search = ""\)/);
  assert.match(catalog, /task-inspector/);
  assert.match(main, /steps: progress\.steps/);
});

test("Vercel preview is stand-alone, clearly marked and cannot execute computer commands", async () => {
  const html = read("preview/index.html");
  assert.match(html, /UI PREVIEW · SAMPLE DATA/);
  assert.match(html, /browser-only demonstration/);
  assert.match(html, /All workflow metrics in the browser preview are fictional/);
  assert.match(html, /AI execution is not connected/);
  assert.doesNotMatch(html, /@tauri-apps\/api|window\.__TAURI__|fetch\s*\(/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, "Preview must have an inline script");
  const { Script } = await import("node:vm");
  new Script(script[1], { filename: "preview-script.js" });
});
