import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const frameio=fs.readFileSync("src-tauri/src/frame_io.rs","utf8");
const status=fs.readFileSync("docs/FRAME_IO_STATUS.md","utf8");

test("Frame.io 20 percent source tools are registered",()=>{
  for(const name of [
    "frame_io_capability_report",
    "frame_io_readiness_report",
    "frame_io_credential_status",
    "frame_io_identity_preflight"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "FrameIoCapabilityReport",
    "FrameIoReadinessReport",
    "FrameIoCredentialStatus",
    "FrameIoIdentityPreflight"
  ]) assert.match(lib,new RegExp(name));
});

test("Frame.io foundation is pinned to current V4 identity endpoints",()=>{
  assert.match(frameio,/"source_milestone_percent":20/);
  assert.match(frameio,/https:\/\/api\.frame\.io/);
  assert.match(frameio,/\/v4\/me/);
  assert.match(frameio,/\/v4\/accounts/);
  assert.match(frameio,/adobe_ims_oauth2_bearer/);
  assert.doesNotMatch(frameio,/\/v2\//);
});

test("Frame.io token handling does not expose secrets to model tools",()=>{
  assert.match(lib,/integration:frame_io:access_token/);
  assert.match(lib,/set_password/);
  assert.match(lib,/delete_credential/);
  assert.match(lib,/"credential_configured"/);
  assert.doesNotMatch(lib,/"access_token":token/);
  assert.doesNotMatch(lib,/"access_token":access_token/);
});

test("Frame.io 20 percent stays read-only",()=>{
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ME_PATH\)/);
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ACCOUNTS_PATH\)/);
  assert.doesNotMatch(lib,/FrameIoCreateProject/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
  assert.doesNotMatch(lib,/FrameIoComment/);
  assert.doesNotMatch(lib,/FrameIoDelete/);
});

test("Frame.io runtime and production flags remain false",()=>{
  assert.match(frameio,/"source_runtime_verified":false/);
  assert.match(frameio,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
