import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const frameio=fs.readFileSync("src-tauri/src/frame_io.rs","utf8");
const status=fs.readFileSync("docs/FRAME_IO_STATUS.md","utf8");

test("Frame.io 80 percent source tools are registered",()=>{
  for(const name of [
    "frame_io_capability_report",
    "frame_io_readiness_report",
    "frame_io_credential_status",
    "frame_io_identity_preflight",
    "frame_io_oauth_begin",
    "frame_io_oauth_complete",
    "frame_io_oauth_refresh",
    "frame_io_list_workspaces",
    "frame_io_list_projects",
    "frame_io_list_folder_children",
    "frame_io_show_file",
    "frame_io_list_comments",
    "frame_io_show_comment"
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
    "FrameIoListProjects",
    "FrameIoListFolderChildren",
    "FrameIoShowFile",
    "FrameIoListComments",
    "FrameIoShowComment"
  ]) assert.match(lib,new RegExp(name));
});

test("Frame.io 80 percent is pinned to current V4 and Adobe IMS Native App PKCE",()=>{
  assert.match(frameio,/"source_milestone_percent":80/);
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
  assert.match(lib,/frame_io_entry\("access_token"\)/);
  assert.match(lib,/set_password/);
  assert.match(lib,/delete_credential/);
  assert.match(lib,/"credential_configured"/);
  assert.match(lib,/"refresh_token_exposed":false/);
  assert.match(lib,/"pkce_verifier_exposed":false/);
  assert.match(lib,/frame_io_entry\("oauth_pending"\)/);
  assert.doesNotMatch(lib,/"access_token":token/);
  assert.doesNotMatch(lib,/"access_token":access_token/);
});

test("Frame.io 80 percent project and asset inspection stays read-only",()=>{
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ME_PATH\)/);
  assert.match(lib,/\.get\(frame_io::api_url\(frame_io::ACCOUNTS_PATH\)/);
  assert.match(lib,/\.get\(frame_io::workspaces_page_url/);
  assert.match(lib,/\.get\(frame_io::projects_page_url/);
  assert.match(lib,/\.get\(frame_io::folder_children_page_url/);
  assert.match(lib,/\.get\(frame_io::file_url/);
  assert.match(lib,/\.get\(frame_io::comments_url/);
  assert.match(lib,/\.get\(frame_io::comment_url/);
  assert.match(frameio,/"pagination_auto_followed":false/);
  assert.match(frameio,/"media_links_exposed":false/);
  assert.match(frameio,/"view_url_exposed":false/);
  assert.doesNotMatch(lib,/FrameIoCreateProject/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
  assert.doesNotMatch(lib,/FrameIoCreateComment/);
  assert.doesNotMatch(lib,/FrameIoDelete/);
});

test("Frame.io runtime and production flags remain false",()=>{
  assert.match(frameio,/"source_runtime_verified":false/);
  assert.match(frameio,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*80%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});

test("Frame.io 80 percent OAuth never requires or exposes a client secret",()=>{
  assert.match(frameio,/"client_secret_required":false/);
  assert.match(lib,/client_secret_used/);
  assert.doesNotMatch(lib,/frame_io_client_secret/);
  assert.doesNotMatch(frameio,/client_secret:String/);
});

test("Frame.io 80 percent callback is state-bound and expiring",()=>{
  assert.match(frameio,/MAX_PENDING_AGE_SECONDS:u64=15\*60/);
  assert.match(frameio,/state mismatch/);
  assert.match(frameio,/code_verifier/);
  assert.match(frameio,/pending request expired/);
});

test("Frame.io 80 percent tracks expiry and auto-refreshes bounded reads",()=>{
  assert.match(lib,/frame_io_entry\("access_expires_at"\)/);
  assert.match(frameio,/TOKEN_REFRESH_SKEW_SECONDS:u64=60/);
  assert.match(frameio,/access_token_needs_refresh/);
  assert.match(lib,/load_frame_io_fresh_access_token/);
  assert.match(lib,/refresh_frame_io_stored_access_token/);
  assert.match(lib,/"access_token_auto_refreshed"/);
});

test("Frame.io 80 percent asset summaries omit signed download surfaces",()=>{
  assert.match(frameio,/folder_children_url/);
  assert.match(frameio,/summarize_folder_children/);
  assert.match(frameio,/summarize_file/);
  assert.match(frameio,/"media_links_exposed":false/);
  assert.match(frameio,/"view_url_exposed":false/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
  assert.doesNotMatch(lib,/FrameIoDelete/);
});

test("Frame.io 80 percent comments stay read-only and pagination is cursor-bound",()=>{
  assert.match(frameio,/comments_url/);
  assert.match(frameio,/comment_url/);
  assert.match(frameio,/summarize_comments/);
  assert.match(frameio,/summarize_comment/);
  assert.match(frameio,/explicit_cursor_pagination/);
  assert.match(frameio,/pagination_after/);
  assert.match(frameio,/MAX_PAGINATION_AFTER_BYTES/);
  assert.match(frameio,/"attachments_exposed":false/);
  assert.match(frameio,/"external_links_exposed":false/);
  assert.doesNotMatch(lib,/FrameIoCreateComment/);
  assert.doesNotMatch(lib,/FrameIoDeleteComment/);
  assert.doesNotMatch(lib,/FrameIoUpload/);
});
