import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundle the real native UI transport; stub ONLY the DOM-heavy model picker.
// Provider Chat and Windows tool preparation are independently mocked, with
// no HTTP calls, paid provider requests or desktop actions.
const entry = fileURLToPath(new URL("../web-dashboard/src/native-agent.ts", import.meta.url));
const { outputFiles } = await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "esm",
  write: false, target: "node22", plugins: [{
    name: "settings-picker-stub",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/native-model-setup$/ }, () =>
        ({ path: "picker", namespace: "test-stub" }));
      builder.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: 'export function mountNativeModelSetup(){return {current:()=>({provider:"xkiro",base_url:"",roles:{chat:"openai/gpt-5.6-sol",master:"openai/gpt-5.6-sol"}})}}',
        loader: "js"
      }));
    }
  }]
});
const { mountNativeAgent } = await import(
  "data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64")
);
function el() {
  return {
    textContent: "", hidden: false, disabled: false, value: "",
    setAttribute() {}, append() {}, addEventListener() {}, insertBefore() {},
    parentElement: { insertBefore() {} }
  };
}
async function mount(invoke) {
  globalThis.document = {
    createElement: () => el(),
    getElementById: id => id === "chatWorkspaceLayout" ? el() : null
  };
  globalThis.window = { __TAURI_INTERNALS__: { invoke } };
  const transport = mountNativeAgent(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(transport?.connected(), true, "native IPC preflight must finish");
  return transport;
}
function nativeInvoke(chatResult, prepareFails) {
  const calls = [];
  const invoke = async (command) => {
    calls.push(command);
    switch (command) {
      case "runtime_status": return { shuvi_memory_mb: 45, managed_children_count: 0 };
      case "list_providers": return [{ id:"xkiro", name:"xKiro", api_key_required:true }];
      case "remote_agent_status": return { enabled: false };
      case "chat": return chatResult;
      case "prepare_tool":
        if (prepareFails) throw Error("Windows local prepare failed");
        return { id:"task-123", kind:"test", summary:"Action requires approval", risk:"low", detail:"test" };
      default: throw Error("Unexpected command: " + command);
    }
  };
  return { invoke, calls };
}

test("successful paid AI reply remains acknowledged when tool prepare fails", async () => {
  const mock = nativeInvoke({
    content: "I can help with that.", provider: "xkiro",
    model: "openai/gpt-5.6-sol", tool_proposal: { kind: "desktop" }
  }, true);
  const transport = await mount(mock.invoke);
  const result = await transport.send("Open Notepad", "thread-1", 0);
  assert.equal(result.ok, true, "AI success must never become a draft after tool failure");
  assert.match(result.reply, /I can help with that/);
  assert.match(result.reply, /tool preparation failed or its outcome is unknown/);
  assert.match(transport.getReplies("thread-1")[0], /Do not resend this paid AI message/);
  assert.equal(mock.calls.filter(c => c === "chat").length, 1);
  assert.equal(mock.calls.filter(c => c === "prepare_tool").length, 1);
  assert.equal(mock.calls.includes("execute_action"), false);
});

test("successful AI reply without tool still completes normally", async () => {
  const mock = nativeInvoke({
    content: "Hello from Shuvi.", provider: "xkiro",
    model: "openai/gpt-5.6-sol", tool_proposal: null
  }, false);
  const transport = await mount(mock.invoke);
  const result = await transport.send("Hello", "thread-2", 0);
  assert.deepEqual(result, { ok: true, reply: "Hello from Shuvi." });
  assert.equal(transport.getReplies("thread-2")[0], "Hello from Shuvi.");
  assert.equal(mock.calls.includes("prepare_tool"), false);
});

test("native chat labels are updated only after confirmed native connection", () => {
  const source = readFileSync(new URL("../web-dashboard/src/chat-workspace.ts", import.meta.url), "utf8");
  assert.match(source, /remote\?\.kind === "native" && remote\.connected\(\)/);
  assert.match(source, /submit\.textContent = nativeConnected \? "Send to Shuvi/);
  assert.match(source, /"Save locally ↗"/);
  assert.match(source, /Windows tool actions need separate approval/);
});
