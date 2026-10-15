import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync("src-tauri/src/lib.rs","utf8");
const handoff=readFileSync("src-tauri/src/premiere_mogrt_handoff.rs","utf8");
const artifact=readFileSync("src-tauri/src/premiere_media_relink.rs","utf8");
const uxp=readFileSync("integrations/premiere-uxp/main.js","utf8");
const slice=(start,end)=>{
  const i=rust.indexOf(start),j=rust.indexOf(end,i);
  assert.ok(i>=0&&j>i,"Expected exact Premiere action boundaries");
  return rust.slice(i,j);
};
const insert=slice(
  "ToolAction::PremiereInsertVerifiedMogrt{request} => {",
  "ToolAction::PremiereInsertMogrtPath { path, seconds, video_track, audio_track } => {"
);
const inspect=slice(
  "ToolAction::PremiereInspectMogrtArtifact{path} => {",
  "ToolAction::PremiereInsertVerifiedMogrt{request} => {"
);

test("approved MOGRT handoff is its own high-risk action with an exact sequence expectation",()=>{
  assert.match(rust,/"premiere_insert_verified_mogrt" =>/);
  assert.match(rust,/ToolAction::PremiereInsertVerifiedMogrt\{request:request\.clone\(\)\}/);
  const parser=slice('"premiere_insert_verified_mogrt" => {','"premiere_insert_mogrt_path" => {');
  assert.match(parser,/expected=premiere_expectation\.as_ref\(\)/);
  assert.match(parser,/expected\.validate\(\)\?/);
  assert.match(parser,/expected\.sequence_guid\.is_none\(\)/);
  assert.match(parser,/RiskLevel::High/);
  assert.match(rust,/premiere_insert_verified_mogrt: \{"request":/);
});
test("read-only MOGRT artifact inspection never modifies Adobe or a project",()=>{
  assert.match(rust,/"premiere_inspect_mogrt_artifact" =>/);
  assert.match(inspect,/premiere_mogrt_handoff::inspect\(&path\)/);
  assert.match(inspect,/"read_only":true/);
  assert.match(inspect,/"after_effects_origin_verified":false/);
  assert.doesNotMatch(inspect,/premiere_bridge\.request/);
  assert.doesNotMatch(inspect,/backup_premiere_project/);
});
test("MOGRT path/content gates prohibit path tricks, symlink and unbound sources",()=>{
  assert.match(handoff,/MAX_MOGRT_BYTES:u64=256\*1024\*1024/);
  assert.match(handoff,/extension\(\)/);
  assert.match(handoff,/file_type\(\)\.is_symlink\(\)/);
  assert.match(handoff,/expected_sha256\.len\(\)!=64/);
  assert.match(handoff,/self\.seconds\.is_finite\(\)/);
  assert.match(handoff,/self\.video_track>128/);
  assert.match(artifact,/Sha256::new\(\)/);
  assert.match(handoff,/SHA-256 differs from the approved artifact/);
});
test("checkpoint and SHA256 double-check happen before native Premiere MOGRT insert",()=>{
  const before=insert.indexOf("request.verify_source()?");
  const backup=insert.indexOf("backup_premiere_project(&premiere_bridge).await?");
  const rechecked=insert.indexOf("let rechecked=request.verify_source()?");
  const mutation=insert.indexOf('.request("insert_mogrt_path"');
  assert.ok(before>=0&&backup>before&&rechecked>backup&&mutation>rechecked);
  assert.match(insert,/expected\.project_path\.as_deref\(\)/);
  assert.match(insert,/expected\.sequence_guid\.as_deref\(\)/);
});
test("host creates an actual graphics clip and checks before/after native track identity",()=>{
  const start=uxp.indexOf("async function insertMogrtFromPath(argumentsValue)");
  const end=uxp.indexOf("async function insertMogrtFromLibrary",start);
  const handler=uxp.slice(start,end);
  assert.match(handler,/graphicsTrackSnapshot/);
  assert.match(handler,/editor\.insertMogrtFromPath/);
  assert.match(handler,/verifyDirectMogrtInsertion/);
  assert.match(handler,/insertedClipIdentityVerified:verification\.insertedClipIdentityVerified/);
  assert.match(handler,/templateSourceIdentityVerified:false/);
});
test("unknown insertion or changed source prevents automatic project save",()=>{
  assert.match(insert,/if !inserted\|\|!still_exact/);
  assert.match(insert,/"post_insert_save_started":false/);
  assert.match(insert,/"retry_safe":false/);
  const check=insert.indexOf("if !inserted||!still_exact");
  const save=insert.indexOf('.request("save_project"');
  assert.ok(check>=0&&save>check);
});
test("accepted inserted clip is not declared durable before independent save and project fingerprint",()=>{
  assert.match(insert,/premiere_project_persistence::fingerprint\(&project_path\)/);
  assert.match(insert,/premiere_project_persistence::assess\(/);
  assert.match(insert,/premiere_mogrt_handoff::assess_receipt\(/);
  assert.match(handoff,/insertion\.get\("verificationStatus"\)/);
  assert.match(handoff,/Some\("verified_creation_identity"\)/);
  assert.match(handoff,/let verified=source_unchanged&&clip_identity&&saved&&same_project&&project_persisted/);
});
test("AE provenance and MOGRT visual accuracy remain unverified even with matching bytes",()=>{
  assert.match(handoff,/"after_effects_producer_verified":false/);
  assert.match(handoff,/"mogrt_template_semantics_verified":false/);
  assert.match(handoff,/"video_playback_verified":false/);
  assert.match(handoff,/"retry_safe":false/);
  assert.match(handoff,/exact_mogrt_hash_and_changed_bytes/);
  assert.match(handoff,/invalid_mogrt_requests_fail_before_host/);
});
