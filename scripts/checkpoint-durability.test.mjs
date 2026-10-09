import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("session checkpoint uses durable validated snapshot publisher and keeps the last good backup",()=>{
  const start=rust.indexOf("fn write_session_checkpoint(");
  const end=rust.indexOf("fn read_session_checkpoint",start);
  const block=rust.slice(start,end);
  assert.match(block,/premiere_store::replace\(&path, &content, 2 \* 1024 \* 1024, validate_checkpoint_bytes\)/);
  assert.match(block,/serde_json::from_slice\(bytes\)/);
  assert.match(block,/validate_session_checkpoint_payload\(&checkpoint\)/);
  assert.doesNotMatch(block,/fs::write\(&temp, &content\)/);
  assert.doesNotMatch(block,/fs::remove_file\(&backup\)/);
  const store=readFileSync(new URL("../src-tauri/src/premiere_store.rs",import.meta.url),"utf8");
  assert.match(store,/fs::OpenOptions::new\(\)\.write\(true\)\.create_new\(true\)\.open\(&tmp\)/);
  assert.match(store,/file\.sync_all\(\)/);
  assert.match(store,/Keep the last-good backup/);
  assert.match(store,/No valid Premiere snapshot to recover/);
});

test("session checkpoint loader can recover from backup",()=>{
  const start=rust.indexOf("fn read_session_checkpoint(");
  const end=rust.indexOf("fn remove_session_checkpoint",start);
  const block=rust.slice(start,end);
  assert.match(block,/let backup = path\.with_extension\("json\.bak"\)/);
  assert.match(block,/decode\(&path\)\.or_else/);
  assert.match(block,/if backup\.exists\(\) \{ decode\(&backup\) \}/);
  assert.match(block,/decode\(&backup\)\?/);
});

test("clearing a task removes primary temp and backup checkpoint files",()=>{
  const start=rust.indexOf("fn remove_session_checkpoint(");
  const end=rust.indexOf("fn workspace_config_path",start);
  const block=rust.slice(start,end);
  assert.match(block,/premiere_store::clear_snapshot\(&path\)/);
  const store=readFileSync(new URL("../src-tauri/src/premiere_store.rs",import.meta.url),"utf8");
  assert.match(store,/pub fn clear_snapshot\(path:&Path\)/);
  assert.match(store,/let _write=WRITES\.lock\(\)/);
  assert.match(store,/path\.with_extension\("json\.tmp"\)/);
  assert.match(store,/path\.with_extension\("json\.bak"\)/);
  assert.match(store,/fs::symlink_metadata\(&candidate\)/);
  assert.match(store,/fs::remove_file\(&candidate\)/);
});


test("session checkpoint decode reads through the bounded open-handle helper",()=>{
  const start=rust.indexOf("fn read_session_checkpoint(");
  const end=rust.indexOf("fn remove_session_checkpoint",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_utf8_file_bounded\([\s\S]*2 \* 1024 \* 1024[\s\S]*"saved session checkpoint"/);
  assert.match(block,/serde_json::from_str\(&content\)/);
  assert.match(block,/validate_checkpoint_bytes\(content\.as_bytes\(\)\)\?/);
  assert.doesNotMatch(block,/fs::metadata\(candidate\)/);
  assert.doesNotMatch(block,/fs::read\(candidate\)/);
});
