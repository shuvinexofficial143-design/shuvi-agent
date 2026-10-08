import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(new URL("../src-tauri/src/premiere_bridge.rs", import.meta.url), "utf8");
const uxp = readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8");

test("persistent pairing is separated from a bounded command session", () => {
  assert.match(bridge, /const PREMIERE_SESSION_TTL_MS: u64 = 8 \* 60 \* 60 \* 1000/);
  assert.match(bridge, /struct PersistedPairing[\s\S]*issued_at_ms: u64/);
  assert.match(bridge, /pairing_secret: Mutex<Option<String>>/);
  assert.match(bridge, /session_token: Mutex<Option<String>>/);
  assert.match(bridge, /session_created_ms: Mutex<Option<u64>>/);
  assert.match(bridge, /fn session_is_current\(&self\)/);
  assert.match(bridge, /now\.saturating_sub\(created\) < PREMIERE_SESSION_TTL_MS/);
  assert.match(bridge, /fn issue_session\(&self, supplied_pairing: Option<&str>\)/);
});

test("legacy raw pairing migration persists the credential once", () => {
  assert.match(bridge, /One-time migration for the legacy raw 32-hex pairing token format/);
  assert.match(bridge, /issued_at_ms: now_ms\(\)/);
  assert.match(bridge, /Self::persist_pairing\(&pairing\)/);
});

test("session rotation fails closed on unconfirmed queued work", () => {
  const start = bridge.indexOf("fn rotate_session(&self)");
  const end = bridge.indexOf("fn activate_pairing", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = bridge.slice(start, end);
  assert.match(block, /\.clear\(\)/);
  assert.match(block, /session_token/);
  assert.match(block, /session_created_ms/);
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

test("saved Premiere pairing automatically renews a bounded session", () => {
  assert.match(bridge, /route == "\/session"/);
  assert.match(uxp, /let bridgeSessionToken = ""/);
  assert.match(uxp, /async function refreshBridgeSession\(\)/);
  assert.match(uxp, /bridgeRequest\([\s\S]*"\/session"[\s\S]*bridgeToken/);
  assert.match(uxp, /async function ensureBridgeSession\(\)/);
  const refreshStart = uxp.indexOf("async function refreshBridgeSession()");
  const refreshEnd = uxp.indexOf("async function ensureBridgeSession()", refreshStart);
  const refreshBlock = uxp.slice(refreshStart, refreshEnd);
  assert.match(refreshBlock, /HTTP 401/);
  assert.match(refreshBlock, /clearSavedBridgeToken\(\)/);
  assert.match(uxp, /const sessionToken = await ensureBridgeSession\(\)/);
  assert.match(uxp, /bridgeSessionToken !== sessionToken/);
  assert.doesNotMatch(uxp, /bridgeToken !== sessionToken/);
});

test("Premiere panel disconnect revokes Shuvi before clearing its local pairing", () => {
  assert.match(bridge, /route == "\/disconnect"/);
  assert.match(uxp, /async function disconnectBridge\(\)/);
  const start = uxp.indexOf("async function disconnectBridge()");
  const end = uxp.indexOf("entrypoints.setup", start);
  const block = uxp.slice(start, end);
  assert.match(block, /bridgeRequest\([\s\S]*"\/disconnect"/);
  assert.match(block, /clearSavedBridgeToken\(\)/);
  assert.ok(block.indexOf('"/disconnect"') < block.indexOf("clearSavedBridgeToken()"));
});
