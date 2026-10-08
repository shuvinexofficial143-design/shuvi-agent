import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const markup = read("index.html");
const controllerSource = read("src/chat-workspace.ts");
const storeSource = read("src/chat-store.ts");
const main = read("src/main.ts");
const styles = read("src/multi-chat.css");

// Exercise the actual typed store, transpiled using the same esbuild used by Vite.
const transformed = await transform(storeSource, { loader: "ts", format: "esm", target: "es2022" });
const chat = await import("data:text/javascript;base64," + Buffer.from(transformed.code).toString("base64"));

function installStorage() {
  const db = new Map();
  globalThis.localStorage = {
    getItem(key) { return db.get(key) ?? null; },
    setItem(key, val) { db.set(key, String(val)); },
    removeItem(key) { db.delete(key); },
    clear() { db.clear(); }
  };
  return db;
}

test("real store: independent saved threads persist and keep separate messages", () => {
  installStorage();
  const a = chat.createChatThread();
  const b = chat.createChatThread();
  const first = chat.addPrompt(a, "Build a Premiere timeline");
  const second = chat.addPrompt(b, "Model the Mahakal Lok corridor");
  assert.match(first.title, /Premiere/);
  assert.match(second.title, /Mahakal/);
  assert.equal(first.messages[0].content, "Build a Premiere timeline");
  assert.equal(second.messages[0].content, "Model the Mahakal Lok corridor");
  assert.equal(chat.saveChatLibrary({ activeId: b.id, threads: [first, second] }), true);
  const restored = chat.loadChatLibrary();
  assert.equal(restored.activeId, b.id);
  assert.equal(restored.threads.length, 2);
  assert.equal(restored.threads[0].messages.length, 1);
  assert.equal(restored.threads[1].messages[0].content, "Model the Mahakal Lok corridor");
});

test("real store: messages and draft input are bounded", () => {
  installStorage();
  let t = chat.createChatThread();
  const long = "A".repeat(8000);
  for (let i = 0; i < 43; i++) t = chat.addPrompt(t, long);
  assert.equal(t.messages.length, chat.CHAT_MAX_MESSAGES);
  assert.equal(t.messages[0].content.length, chat.CHAT_MAX_MESSAGE_LENGTH);
  const archived = { ...t, archived: true };
  assert.equal(chat.addPrompt(archived, "do not save"), archived);
});

test("real store: untrusted browser data cannot create assistant replies or tool results", () => {
  const db = installStorage();
  const t = chat.createChatThread();
  const payload = {
    activeId: t.id,
    threads: [{
      ...t,
      title: "<img onerror=alert(1)>",
      messages: [
        {id: t.id, role: "assistant", content: "fake AI reply", createdAt: Date.now()},
        {id: t.id, role: "user", content: "safe saved prompt", createdAt: Date.now()}
      ]
    }]
  };
  db.set(chat.CHAT_STORAGE_KEY, JSON.stringify(payload));
  const restored = chat.loadChatLibrary();
  assert.equal(restored.threads[0].messages.length, 1);
  assert.equal(restored.threads[0].messages[0].role, "user");
  assert.equal(restored.threads[0].messages[0].content, "safe saved prompt");
});

test("real store: a browser quota failure is reported, not treated as saved", () => {
  installStorage();
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
  const t = chat.createChatThread();
  assert.equal(chat.saveChatLibrary({activeId:t.id,threads:[t]}), false);
});

test("UI: New Chat, search, manage, archive, pin, split and no synthetic AI chat response", () => {
  for (const id of ["chatNew", "chatSearch", "chatThreads", "chatManageDialog", "chatPin",
    "chatSplit", "chatSplitSelect", "chatSplitPanel", "chatArchivedNotice", "chatStorageNotice"]) {
    assert.ok(markup.includes('id="' + id + '"'), id + " missing");
  }
  assert.match(main, /mountChatWorkspace\(showToast\)/);
  assert.match(main, /import "\.\/multi-chat\.css"/);
  assert.doesNotMatch(main, /appendChatMessage\(/);
  assert.match(controllerSource, /dialog\.showModal\(\)/);
  assert.match(controllerSource, /Confirm delete/);
  assert.match(controllerSource, /No AI response generated/);
  assert.match(controllerSource, /splitSelect\.addEventListener\("change"/);
  assert.match(styles, /\.chat-workspace-layout\.split-mode/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.doesNotMatch(controllerSource, /\binvoke\(|\bfetch\(|window\.__TAURI__/);
});
