import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const talking = readFileSync(new URL("../src-tauri/src/premiere_talking_head.rs", import.meta.url), "utf8");

test("W2 exposes separate plan and apply tools", () => {
  assert.match(rust, /- premiere_plan_transcript_cuts:/);
  assert.match(rust, /- premiere_apply_transcript_cuts:/);
  assert.match(rust, /"premiere_plan_transcript_cuts" =>/);
  assert.match(rust, /"premiere_apply_transcript_cuts" =>/);
});

test("explicit transcript actions are bounded", () => {
  assert.match(talking, /keep" \| "remove" \| "chapter" \| "highlight/);
  assert.match(talking, /1–128 explicit transcript selections/);
  assert.match(talking, /MAX_PADDING_SECONDS: f64 = 2\.0/);
});

test("transcript snapshot is deterministic and required before apply", () => {
  assert.match(talking, /fnv1a64:/);
  assert.match(rust, /Transcript changed since planning; inspect and plan again before editing/);
  assert.match(rust, /transcript_snapshot\.starts_with\("fnv1a64:"\)/);
});

test("mid-clip removal fails closed until a verified split exists", () => {
  assert.match(talking, /interior hole; a verified split path is required/);
  assert.match(rust, /"interior_split_supported": false/);
});

test("linked media is never inferred", () => {
  assert.match(talking, /linked_media_inferred: false/);
  assert.match(talking, /native linked membership is unverified/);
  assert.match(rust, /"linked_media_inferred": false/);
});

test("separate A V targets forbid ripple", () => {
  assert.match(talking, /self\.ripple && self\.audio\.is_some\(\)/);
  assert.match(talking, /Ripple transcript deletion is not allowed with separate video\+audio targets/);
});

test("apply requires exact video and optional audio expectations", () => {
  assert.match(rust, /Transcript cut execution requires one exact expectation for every explicit video\/audio target/);
  assert.match(rust, /expected\.clips\.iter\(\)\.any\(\|clip\| clip\.kind == "video"/);
  assert.match(rust, /clip\.kind == "audio"/);
});

test("real edits reuse existing trim and delete native routes", () => {
  assert.match(rust, /EditOperation::Trim \{ \.\. \} => \("trim_clip"/);
  assert.match(rust, /EditOperation::Delete \{ \.\. \} => \("delete_clip"/);
});

test("apply takes a project checkpoint before mutation", () => {
  const arm = rust.slice(rust.indexOf("ToolAction::PremiereTranscriptCuts"));
  assert.match(arm, /backup_premiere_project\(&premiere_bridge\)\.await\?/);
});

test("chapter and highlight selections map to existing markers", () => {
  assert.match(talking, /"Chapter"/);
  assert.match(talking, /"Comment"/);
  assert.match(rust, /client\.request\("add_marker"/);
});

test("uncertain bridge delivery stops the workflow", () => {
  assert.match(rust, /error\.contains\("unknown"\) \|\| error\.contains\("timed out"\) \|\| error\.contains\("timeout"\)/);
  assert.match(rust, /if !uncertain && edits\.iter\(\)\.all/);
});

test("post-edit timeline is reinspected without stale clip guards", () => {
  assert.match(rust, /clips: Vec::new\(\)/);
  assert.match(rust, /"post_timeline_inspected": post_timeline\.is_some\(\)/);
});
