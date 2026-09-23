import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function loadPanel() {
  const panel = { document: { getElementById: () => null }, require: name => {
    if (name === "./audio-plans.js") return {};
    if (name === "./recipe-plans.js") return {};
    if (name === "uxp") return { entrypoints: { setup() {} } };
    if (name === "premierepro" || name === "./speed-workflows.js") return {};
    throw new Error(name);
  } };
  vm.createContext(panel);
  vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8"), panel);
  vm.runInContext('bridgeToken = "initial";', panel);
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

test("token changes during execution cannot submit results to new pairing", async () => {
  const panel = loadPanel();
  panel.executeCommand = async () => {
    vm.runInContext('bridgeToken = "replacement";', panel);
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
    vm.runInContext('bridgeToken = "";', panel);
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
