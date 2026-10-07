import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const frameio=fs.readFileSync("src-tauri/src/frame_io.rs","utf8");
const status=fs.readFileSync("docs/FRAME_IO_STATUS.md","utf8");

test("Frame.io 40 percent source tools are registered",()=>{
  for(const name of [
    "frame_io_capability_report",
    "frame_io_readiness_report",
    "frame_io_credential_status",
    "frame_io_identity_preflight",
    "frame_io_oauth_begin",
    "frame_io_oauth_complete",
    "frame_io_oauth_refresh",
    "frame_io_list_workspaces",
    "frame_io_list_projects"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "FrameIoCapabilityReport",
    "FrameIoReadinessReport",
    "FrameIoCredentialStatus",
    "FrameIoIdentityPreflight",
    "FrameIoOauthBegin",
    "FrameIoOauthComplete",
    "FrameIoOauthRefresh",
    "FrameIoListWorkspaces",
    "FrameIoListProjects"
  ]) assert.match(lib,new RegExp(name));
});

test("Frame.io 40 percent is pinned to current V4 and Adobe IMS Native App PKCE",()=>{
  assert.match(frameio,/"source_milestone_percent":40/);
  assert.match(frameio,/https:\/\/api\.frame\.io/);
  assert.match(frameio,/\/v4\/me/);
  assert.match(frameio,/\/v4\/accounts/);
  assert.match(frameio,/adobe_ims_native_app_pkce/);
  assert.match(frameio,/ims\/authorize\/v2/);
  assert.match(frameio,/ims\/token\/v3/);
  assert.match(frameio,/code_challenge_method/);
  assert.match(frameio,/S256/);
  assert.match(frameio,/offline_access/);
  assert.doesNotMatch(frameio,/\/v2\//);
});

test("Frame.io token handling does not expose secrets to model tools",()=>{
  assert.match(lib,/integration:frame_io:access_token/);
  assert.match(lib,/set_password/);
  assert.match(lib,/delete_credential/);
  assert.match(lib,/"credential_configured"/);
  assert.match(lib,/"refresh_token_exposed":false/);
  assert.match(lib,/"pkce_verifier_exposed":false/);
  assert.match(lib,/integration:frame_io:oauth_pending/);
  assert.doesNotMatch(lib,/"access_token":token/);
  assert.doesNotMatch(lib,/"access_token":access_token/);
});

test("Frame.io 40 percent project discovery stays read-only",()=>{
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ME_PATH\)/);
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ACCOUNTS_PATH\)/);
  assert.doesNotMatch(lib,/FrameIoCreateProject/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
  assert.doesNotMatch(lib,/FrameIoComment/);
  assert.match(lib,/\.get\(frame_io::workspaces_url/);
  assert.match(lib,/\.get\(frame_io::projects_url/);
  assert.match(frameio,/"pagination_auto_followed":false/);
  assert.doesNotMatch(lib,/FrameIoCreateProject/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
  assert.doesNotMatch(lib,/FrameIoComment/);
  assert.doesNotMatch(lib,/FrameIoDelete/);
});

test("Frame.io runtime and production flags remain false",()=>{
  assert.match(frameio,/"source_runtime_verified":false/);
  assert.match(frameio,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*40%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});

test("Frame.io 40 percent OAuth never requires or exposes a client secret",()=>{
  assert.match(frameio,/"client_secret_required":false/);
  assert.match(lib,/client_secret_used/);
  assert.doesNotMatch(lib,/frame_io_client_secret/);
  assert.doesNotMatch(frameio,/client_secret:String/);
});

test("Frame.io 40 percent callback is state-bound and expiring",()=>{
  assert.match(frameio,/MAX_PENDING_AGE_SECONDS:u64=15\*60/);
  assert.match(frameio,/state mismatch/);
  assert.match(frameio,/code_verifier/);
  assert.match(frameio,/pending request expired/);
});
