import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync("src-tauri/src/premiere_selective_captions.rs","utf8");
const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const old=readFileSync("src-tauri/src/premiere_subtitles.rs","utf8");
const host=readFileSync("integrations/premiere-uxp/main.js","utf8");

function region(begin,end) {
  const i=desktop.indexOf(begin),j=desktop.indexOf(end,i);
  assert.ok(i>=0 && j>i,"Expected existing exact Rust action boundaries: "+begin);
  return desktop.slice(i,j);
}

test("separate caption source route preserves existing Adobe native caption source import and SRT conversion",()=>{
  assert.match(desktop,/mod premiere_selective_captions;/);
  assert.match(desktop,/PremiereCreateSelectiveSrt \{request:premiere_selective_captions::Request\}/);
  assert.match(desktop,/"premiere_create_selective_srt"/);
  assert.match(old,/pub fn serialize\(/);
  assert.match(old,/pub fn write\(/);
  assert.match(host,/async function importCaptionSource\(/);
  assert.match(host,/captionTrackCreated:false/);
});
test("typed SRT creation requires an owner-approved, high-risk, bounded manifest",()=>{
  const parse=region('"premiere_create_selective_srt" => {','"premiere_import_caption_source" => {');
  assert.match(parse,/premiere_selective_captions::Request/);
  assert.match(parse,/request\.validate\(\)\?/);
  assert.match(parse,/RiskLevel::High/);
  assert.match(source,/#\[serde\(deny_unknown_fields\)\]/);
  assert.match(source,/self\.cues\.len\(\)>MAX_CUES/);
  assert.match(source,/seen_selected==0\|\|seen_selected>MAX_SELECTED/);
  assert.match(source,/source_transcript_sha256/);
});
test("selectivity and readable two-line cues enforce millisecond non-overlap",()=>{
  assert.match(source,/if !cue\.selected\{continue;\}/);
  assert.match(source,/if start<previous_end/);
  assert.match(source,/if start>=end\|\|end>max_ms/);
  assert.match(source,/cue\.text\.lines\(\)\.count\(\)>2/);
  assert.match(source,/cue\.text\.lines\(\)\.any/);
  assert.match(source,/selected_source_indexes/);
  assert.match(source,/replace\('\\n',"\\r\\n"\)/);
});
test("path preflight blocks relative traversal, symlink parents and reserved Windows device names",()=>{
  assert.match(source,/path\.is_absolute\(\)/);
  assert.match(source,/Component::ParentDir\|Component::CurDir/);
  assert.match(source,/meta\.file_type\(\)\.is_symlink\(\)/);
  assert.match(source,/meta\.file_attributes\(\) & 0x400/);
  assert.match(source,/"CON"\|"PRN"\|"AUX"\|"NUL"/);
  assert.match(source,/file_name\(\)/);
  assert.match(source,/eq_ignore_ascii_case\("srt"\)/);
});
test("source creation is atomic non-overwrite and persisted bytes SHA256 are independently reread",()=>{
  assert.match(source,/OpenOptions::new\(\)\.write\(true\)\.create_new\(true\)/);
  assert.match(source,/file\.write_all\(&expected\)/);
  assert.match(source,/file\.sync_all\(\)/);
  assert.match(source,/File::open\(path\)/);
  assert.match(source,/actual!=expected/);
  assert.match(source,/Sha256::digest\(&actual\)/);
  assert.doesNotMatch(source,/\.truncate\(true\)/);
  assert.doesNotMatch(source,/remove_file\(/);
});
test("creation result cannot pretend Premiere project import or styled caption track",()=>{
  const handler=region("ToolAction::PremiereCreateSelectiveSrt {request} => {","ToolAction::PremiereImportCaptionSource {path,expected_sha256} => {");
  assert.match(handler,/premiere_selective_captions::publish\(&request\)/);
  assert.match(handler,/premiere_caption_track_created":false/);
  assert.match(handler,/adobe_live_tested":false/);
  assert.match(handler,/requires_separate_import_approval":true/);
  assert.match(handler,/retry_automatically":false/);
  assert.match(source,/"caption_track_created":false/);
  assert.match(source,/"premiere_project_item_imported":false/);
});
test("separately approved Adobe source import checks SHA before and after host mutation",()=>{
  const parser=region('"premiere_import_caption_source" => {','"premiere_insert_media" => {');
  const execute=region("ToolAction::PremiereImportCaptionSource {path,expected_sha256} => {","ToolAction::PremiereImportMedia {");
  assert.match(parser,/expected_sha256/);
  assert.match(parser,/v\.len\(\)!=64/);
  assert.match(parser,/RiskLevel::High/);
  assert.match(execute,/premiere_media_relink::fingerprint\(&path\)/);
  assert.match(execute,/expected_sha256\.as_ref\(\)\.is_some_and/);
  assert.match(execute,/backup_premiere_project\(&premiere_bridge\)/);
  assert.match(execute,/premiere_bridge\.request\("import_caption_source"/);
  assert.match(execute,/premiere_media_relink::same_file\(&before,after\)/);
  assert.match(execute,/native_project_item_observed/);
  assert.match(execute,/premiere_project_save_verified":false/);
  assert.match(execute,/retry_safe":false/);
});
test("Rust executable unit tests cover selective Unicode CRLF, overlap, no overwrite and hash",()=>{
  assert.match(source,/fn produces_exact_selective_srt_with_unicode_and_stable_crlf/);
  assert.match(source,/fn rejects_overlap_invalid_timing_and_unsafe_names/);
  assert.match(source,/fn create_new_persists_exact_file_hash_and_never_overwrites/);
  assert.match(source,/fs::read\(&file\)/);
  assert.match(source,/Sha256::digest\(&data\)/);
});
