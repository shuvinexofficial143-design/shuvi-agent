import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(new URL("../src-tauri/src/premiere_bridge.rs", import.meta.url), "utf8");
const uxp = readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8");

test("persisted Premiere pairing keeps an absolute issued timestamp", () => {
  assert.match(bridge, /const PREMIERE_PAIRING_TTL_MS: u64 = 8 \* 60 \* 60 \* 1000/);
  assert.match(bridge, /struct PersistedPairing[\s\S]*issued_at_ms: u64/);
  assert.match(bridge, /fn pairing_is_current\(issued_at_ms: u64\)/);
  assert.match(bridge, /issued_at_ms <= now/);
  assert.match(bridge, /now\.saturating_sub\(issued_at_ms\) < PREMIERE_PAIRING_TTL_MS/);
  assert.match(bridge, /serde_json::to_string\(pairing\)/);
});

test("legacy raw token migration persists the migration timestamp", () => {
  assert.match(bridge, /One-time migration for the legacy raw 32-hex token format/);
  assert.match(bridge, /issued_at_ms: now_ms\(\)/);
  assert.match(bridge, /Self::persist_pairing\(&pairing\)/);
});

test("manual bridge stop revokes the OS credential", () => {
  const start = bridge.indexOf("pub fn stop(&self)");
  const end = bridge.indexOf("pub fn status(&self)", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = bridge.slice(start, end);
  assert.match(block, /Self::revoke_persisted_pairing\(\)\?/);
  assert.match(bridge, /delete_credential\(\)/);
  assert.match(bridge, /Err\(keyring::Error::NoEntry\) => Ok\(\(\)\)/);
});

test("Premiere panel disconnect revokes Shuvi before clearing its local token", () => {
  assert.match(bridge, /\("POST", "\/disconnect"\)/);
  assert.match(uxp, /async function disconnectBridge\(\)/);
  const start = uxp.indexOf("async function disconnectBridge()");
  const end = uxp.indexOf("entrypoints.setup", start);
  const block = uxp.slice(start, end);
  assert.match(block, /bridgeFetch\([\s\S]*"\/disconnect"/);
  assert.match(block, /clearSavedBridgeToken\(\)/);
  assert.ok(block.indexOf('"/disconnect"') < block.indexOf("clearSavedBridgeToken()"));
});
