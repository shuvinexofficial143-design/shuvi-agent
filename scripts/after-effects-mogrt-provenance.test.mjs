import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const proof=readFileSync("src-tauri/src/after_effects_mogrt_provenance.rs","utf8");
const ae=readFileSync("src-tauri/src/after_effects_runtime.rs","utf8");
const premiere=readFileSync("src-tauri/src/lib.rs","utf8");
const insert=readFileSync("src-tauri/src/premiere_mogrt_handoff.rs","utf8");
function segment(source,a,b){
  const i=source.indexOf(a),j=source.indexOf(b,i);
  assert.ok(i>=0&&j>i, "Expected a bounded source section: "+a);
  return source.slice(i,j);
}
test("AE only publishes a receipt-bound proof after a native verified MOGRT export",()=>{
  assert.match(ae,/request\.action=="export_mogrt"/);
  assert.match(ae,/receipt\.ok&&!cancel_verified/);
  assert.match(ae,/verification=="verified_mogrt_file_readback"/);
  assert.match(ae,/mogrt_verified/);
  assert.match(ae,/after_effects_mogrt_provenance::publish/);
  assert.match(ae,/"ae_export_receipt_binding_verified"/);
  assert.match(ae,/"mogrt_provenance_error"/);
});
test("AE evidence and persisted receipt are bound to exact request ID and output byte hash",()=>{
  assert.match(proof,/request\.validate\(\)\?/);
  assert.match(proof,/parse_export_receipt\(&raw,&request\.request_id\)/);
  assert.match(proof,/persisted\.result!=receipt\.result/);
  assert.match(proof,/receipt_sha256:hash\(&raw\)/);
  assert.match(proof,/premiere_mogrt_handoff::inspect\(output\)/);
  assert.match(proof,/file\.size_bytes!=proof\.output_size_bytes\|\|file\.sha256!=proof\.output_sha256/);
});
test("AE handoff files are bounded, non-symlink and create-new without overwriting evidence",()=>{
  assert.match(proof,/const MAX_PROOF_BYTES:usize=8192/);
  assert.match(proof,/const MAX_RECEIPT_BYTES:u64=512\*1024/);
  assert.match(proof,/fs::symlink_metadata\(path\)/);
  assert.match(proof,/file_type\(\)\.is_symlink\(\)/);
  assert.match(proof,/\.create_new\(true\)/);
  assert.match(proof,/out\.write_all\(&bytes\)\.and_then\(\|_\|out\.sync_all\(\)\)/);
  assert.match(proof,/AE provenance is not at the exact request-bound file name/);
});
test("unmodified MOGRT file and exact stored native AE receipt must both remain valid at use time",()=>{
  const verify=proof.slice(proof.indexOf("pub fn verify("));
  assert.match(verify,/if hash\(&raw\)!=proof\.receipt_sha256/);
  assert.match(verify,/parse_export_receipt\(&raw,&proof\.request_id\)/);
  assert.match(verify,/result\.get\("output_file"\)/);
  assert.match(verify,/premiere_mogrt_handoff::inspect\(expected_output\)/);
  assert.match(verify,/"immutable_origin_attestation":false/);
});
test("read-only host tool inspects AE export proof without touching a desktop timeline",()=>{
  assert.match(premiere,/"premiere_inspect_ae_mogrt_provenance" =>/);
  const arm=segment(premiere,
    "ToolAction::PremiereInspectAeMogrtProvenance{proof_file,output_file,expected_sha256} => {",
    "ToolAction::PremiereInspectMogrtArtifact{path} => {");
  assert.match(arm,/after_effects_mogrt_provenance::verify/);
  assert.match(arm,/"read_only":true/);
  assert.doesNotMatch(arm,/premiere_bridge\.request/);
});
test("AE proof is opt-in and required at both start and conclusion of an approved MOGRT insertion",()=>{
  assert.match(insert,/pub ae_provenance_file:Option<String>/);
  assert.match(insert,/#\[serde\(default,skip_serializing_if="Option::is_none"\)\]/);
  const action=segment(premiere,
    "ToolAction::PremiereInsertVerifiedMogrt{request} => {",
    "ToolAction::PremiereInsertMogrtPath { path, seconds, video_track, audio_track } => {");
  const before=action.indexOf("let ae_pre=if let Some(path)");
  const editing=action.indexOf('.request("insert_mogrt_path"');
  const after=action.indexOf("let ae_post=if let Some(path)");
  assert.ok(before>=0&&editing>before&&after>editing);
  assert.match(action,/&&\(ae_pre\.is_none\(\)\|\|ae_receipt_bound\)/);
  assert.match(action,/"ae_origin_cryptographically_attested":false/);
  assert.match(action,/"retry_safe":false/);
});
test("Rust proof tests include tampered MOGRT and mismatched AE receipt identity",()=>{
  assert.match(proof,/provenance_requires_real_receipt_and_unchanged_mogrt_bytes/);
  assert.match(proof,/mismatched_receipt_identity_rejected/);
  assert.match(proof,/assert!\(verify\(filename,output,hash\)\.is_err\(\)\)/);
});
