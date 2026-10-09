import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (name) => readFileSync(new URL("../src/" + name, import.meta.url), "utf8");

test("remote guard is wired into dashboard after initial native status", () => {
  const main = src("main.ts");
  assert.match(main, /import \{ mountRemoteRuntimeNotice \} from "\.\/remote-runtime-notice";/);
  assert.match(main, /renderNativeConnection\(readOnlyBridge\.state\(\)\);\s*mountRemoteRuntimeNotice\(\);/);
});

test("public Vercel origin does not accept or retain native pairing code", () => {
  const notice = src("remote-runtime-notice.ts");
  const native = src("local-runtime.ts");
  assert.match(notice, /if \(localDashboardOrigin\(window\.location\.origin\)\) return;/);
  assert.match(notice, /code\.value = "";/);
  assert.match(notice, /code\.disabled = true;/);
  assert.match(notice, /pair\.disabled = true;/);
  assert.match(notice, /disconnect\.disabled = true;/);
  assert.match(native, /return origin==="http:\/\/127\.0\.0\.1:1423";/);
  assert.doesNotMatch(notice, /localStorage|sessionStorage|fetch\(/);
});

test("remote runtime labels are honest and keep pairing local", () => {
  const notice = src("remote-runtime-notice.ts");
  assert.match(notice, /Remote relay not configured/);
  assert.match(notice, /Remote control is not enabled/);
  assert.doesNotMatch(notice, /Telegram/);
  assert.match(notice, /Shuvi Desktop on Windows/);
  assert.match(notice, /\[data-action="connect-local"\]/);
  assert.match(notice, /Runtime setup/);
  assert.doesNotMatch(notice, /Connected successfully|Remote agent online/);
});

test("remote disabled button is not shown as a pending connection", () => {
  const css = src("runtime-status.css");
  assert.match(css, /#bridgeConnect\[data-remote-blocked="true"\]:disabled/);
  assert.match(css, /cursor:not-allowed/);
});
