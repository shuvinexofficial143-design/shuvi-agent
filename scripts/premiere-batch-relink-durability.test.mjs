import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync("src-tauri/src/lib.rs","utf8");
const batch=readFileSync("src-tauri/src/premiere_batch_relink.rs","utf8");
const uxp=readFileSync("integrations/premiere-uxp/main.js","utf8");
const grab=(s,a,b)=>{
  const i=s.indexOf(a),j=s.indexOf(b,i);
  assert.ok(i>=0&&j>i,"Required exact functional section: "+a);
  return s.slice(i,j);
};
const parser=grab(rust,'"premiere_batch_relink" => {','"premiere_batch_attach_proxy" => {');
const runtime=grab(rust,"ToolAction::PremiereBatchRelink { items } => {",
  "ToolAction::PremiereBatchAttachProxy { items } => {");

test("batch relink is a typed high-risk operation with no defaulted source path",()=>{
  assert.match(parser,/serde_json::from_value\(item\.clone\(\)\)/);
  assert.match(parser,/premiere_batch_relink::validate_entries\(&entries\)/);
  assert.match(parser,/premiere_batch_relink::Entry/);
  assert.match(parser,/RiskLevel::High/);
  assert.match(batch,/pub expected_previous_path:String/);
  assert.match(batch,/pub new_path:String/);
  assert.match(batch,/deny_unknown_fields/);
});
test("batch requires clean absolute original paths and rejects repeated target native item IDs",()=>{
  assert.match(batch,/const MAX_ITEMS:usize=24/);
  assert.match(batch,/entries\.len\(\)>MAX_ITEMS/);
  assert.match(batch,/Path::new\(path\)\.is_absolute\(\)/);
  assert.match(batch,/ids\.insert\(entry\.item_id\.to_ascii_lowercase\(\)\)/);
  assert.match(batch,/Duplicate native Premiere item IDs/);
  assert.match(batch,/normalized\(&self\.expected_previous_path\)==normalized\(&self\.new_path\)/);
});
test("source files are regular and capped by aggregate bytes before any Adobe changes",()=>{
  assert.match(batch,/MAX_BATCH_BYTES:u64=4\*1024\*1024\*1024/);
  assert.match(batch,/fs::symlink_metadata/);
  assert.match(batch,/file_type\(\)\.is_symlink\(\)/);
  assert.match(batch,/bytes=bytes\.checked_add\(meta\.len\(\)\)/);
  assert.match(batch,/premiere_media_relink::fingerprint\(&item\.new_path\)/);
  const proof=runtime.indexOf("premiere_batch_relink::fingerprint_sources(&entries)?");
  const backup=runtime.indexOf("backup_premiere_project(&premiere_bridge).await?");
  const mutation=runtime.indexOf('.request("relink_media"');
  assert.ok(proof>=0 && backup>proof && mutation>backup);
});
test("UXP request sends the exact expected previous path and not an unguarded relink",()=>{
  assert.match(batch,/"expectedPreviousPath":self\.expected_previous_path/);
  assert.match(runtime,/entry\.uxp_args\(\)/);
  const relink=grab(uxp,"async function relinkMedia(argumentsValue)","async function attachProxy(argumentsValue)");
  assert.match(relink,/normalizeMediaPath\(previousPath\) !== normalizeMediaPath\(expectedPreviousPath\)/);
  assert.match(relink,/freshClipBefore\.changeMediaFilePath\(newPath, overrideCompatibility\)/);
});
test("each item verifies exact native item ID, new path, source hash and offline false",()=>{
  assert.match(batch,/pub fn host_verified/);
  assert.match(batch,/observedId/);
  assert.match(batch,/observedOffline/);
  assert.match(batch,/observedPath/);
  assert.match(batch,/pub fn post_save_verified/);
  assert.match(batch,/mediaPath/);
  assert.match(runtime,/let verified=entry\.host_verified\(&result\)/);
  assert.match(runtime,/premiere_batch_relink::same_source\(entry,&proofs\[index\]\)/);
});
test("prior verified clip edits are saved once even after a later item fails",()=>{
  assert.match(runtime,/let save=if changed_indices\.is_empty\(\)\{None\}else\{/);
  assert.match(runtime,/request\("save_project"/);
  assert.match(runtime,/project_save_attempted":save\.is_some\(\)/);
  assert.match(runtime,/partial_host_mutations_possible":!completed/);
  assert.match(runtime,/state\.media_prep_cancelled\.load/);
  assert.match(runtime,/if !verified/);
});
test("post-save project fingerprint and all previously relinked native items are reread",()=>{
  assert.match(runtime,/premiere_project_persistence::fingerprint\(&project_path\)/);
  assert.match(runtime,/premiere_project_persistence::assess\(/);
  assert.match(runtime,/request\("inspect_media_interpretation"/);
  assert.match(runtime,/entry\.post_save_verified\(value\)/);
  assert.match(runtime,/let durable=completed&&saved&&identity_retained&&after_save_verified/);
  assert.match(runtime,/persistence_verified/);
});
test("uncertain batches stop without auto retry, silent rollback or false durable success",()=>{
  assert.match(runtime,/if !verified/);
  assert.match(runtime,/"uncertain":!verified/);
  assert.match(runtime,/"retry_safe":false/);
  assert.match(runtime,/"batch_durable_verified":durable/);
  assert.match(runtime,/success:durable/);
  assert.doesNotMatch(runtime,/rollback|undo\(/i);
});
