import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function loadPanel() {
  const panel = { document: { getElementById: () => null }, require: name => {
    if (name === "./project-diagnostics.js" || name === "./transcript-rebuild.js") return {};
    if (name === "./caption-workflows.js" || name === "./mogrt-workflows.js" || name === "./graphics-batch.js") return {};
    if (name === "./audio-plans.js") return {};
    if (name === "./recipe-plans.js") return {};
    if (name === "uxp") return { entrypoints: { setup() {} } };
    if (name === "premierepro" || name === "./speed-workflows.js") return {};
    throw new Error(name);
  } };
  vm.createContext(panel);
  vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8"), panel);
  vm.runInContext('bridgeToken = "pairing"; bridgeSessionToken = "initial";', panel);
  return panel;
}

test("failed result delivery neither repeats edit nor posts a conflicting failure", async () => {
  const panel = loadPanel();
  let edits = 0;
  let posts = 0;
  panel.executeCommand = async () => { edits++; return { edited: true }; };
  panel.bridgeFetch = async (path, options, timeout, token) => {
    assert.equal(token, "initial");
    if (path === "/command") return { id: "one", action: "test" };
    posts++;
    assert.equal(JSON.parse(options.body).success, true);
    throw new Error("Connection lost");
  };
  await panel.pollBridge();
  assert.equal(edits, 1);
  assert.equal(posts, 1);
});

test("session token changes during execution cannot submit results to a new session", async () => {
  const panel = loadPanel();
  panel.executeCommand = async () => {
    vm.runInContext('bridgeSessionToken = "replacement";', panel);
    return { edited: true };
  };
  panel.bridgeFetch = async (path, options, timeout, token) => {
    assert.equal(token, "initial");
    if (path === "/command") return { id: "one", action: "test" };
  };
  await panel.pollBridge();
});

test("unpair while polling prevents execution of fetched command", async () => {
  const panel = loadPanel();
  panel.executeCommand = async () => assert.fail("Must not edit after unpair");
  panel.bridgeFetch = async () => {
    vm.runInContext('bridgeSessionToken = "";', panel);
    return { id: "one", action: "test" };
  };
  await panel.pollBridge();
});

test("oversized Unicode and cyclic results return bounded uncertainty", async () => {
  const panel = loadPanel();
  const cyclic = {}; cyclic.self = cyclic;
  panel.bridgeFetch = async (path, options) => {
    assert.equal(path, "/result");
    const payload = JSON.parse(options.body);
    assert.equal(payload.success, false);
    assert.match(payload.error, /may have completed/);
    assert.ok(Buffer.byteLength(options.body) < 1024);
  };
  await panel.postResult({ id: "one" }, true, "🎬".repeat(70000), null, "initial");
  await panel.postResult({ id: "two" }, true, cyclic, null, "initial");
  assert.equal(panel.utf8ByteLength("aé🎬"), Buffer.byteLength("aé🎬"));
});

test("duplicate deliveries cannot execute twice even after lost result acknowledgement", async () => {
  const panel = loadPanel();
  let edits = 0;
  panel.executeCommand = async () => { edits++; return {}; };
  panel.bridgeFetch = async path => {
    if (path === "/command") return {id: "same", action: "trim_clip"};
    throw Error("lost acknowledgement");
  };
  await panel.pollBridge();
  await panel.pollBridge();
  assert.equal(edits, 1);
});

test("delivery history fails closed at capacity and only a new session resets it", () => {
  const panel = loadPanel();
  for (let i = 0; i < 1024; i++) panel.claimCommand({id: String(i), action: "trim_clip"}, "a");
  assert.throws(() => panel.claimCommand({id: "extra", action: "trim_clip"}, "a"), /budget exhausted/);
  assert.throws(() => panel.claimCommand({id: "0", action: "delete_clip"}, "a"), /Duplicate/);
  panel.claimCommand({id: "extra", action: "trim_clip"}, "b");
});

test("result envelope echoes action and rejects oversized structure before JSON serialization", async () => {
  const panel = loadPanel();
  panel.bridgeFetch = async (path, options) => {
    assert.deepEqual(JSON.parse(options.body), {id:"one", action:"trim_clip", success:true, data:{ok:true}, error:null});
  };
  await panel.postResult({id:"one", action:"trim_clip"}, true, {ok:true}, null, "initial");
  const sparse = []; sparse.length = 100000000;
  assert.throws(() => panel.boundedResultJson(sparse), /array exceeds/);
  let deep = {};
  for (let i = 0; i < 40; i++) deep = {deep};
  assert.throws(() => panel.boundedResultJson(deep), /structure exceeds/);
});
