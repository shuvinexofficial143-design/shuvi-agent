import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("session checkpoint replacement preserves the last good snapshot",()=>{
  const start=rust.indexOf("fn write_session_checkpoint(");
  const end=rust.indexOf("fn read_session_checkpoint",start);
  const block=rust.slice(start,end);
  assert.match(block,/let backup = path\.with_extension\("json\.bak"\)/);
  assert.match(block,/fs::rename\(&path, &backup\)/);
  assert.match(block,/if let Err\(error\) = fs::rename\(&temp, &path\)/);
  assert.match(block,/fs::rename\(&backup, &path\)/);
  assert.match(block,/fs::remove_file\(&backup\)/);
  assert.doesNotMatch(block,/remove_file\(&path\)/);
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
  assert.match(block,/path\.with_extension\("json\.tmp"\)/);
  assert.match(block,/path\.with_extension\("json\.bak"\)/);
  assert.match(block,/fs::remove_file\(&candidate\)/);
});


test("session checkpoint decode reads through the bounded open-handle helper",()=>{
  const start=rust.indexOf("fn read_session_checkpoint(");
  const end=rust.indexOf("fn remove_session_checkpoint",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_utf8_file_bounded\([\s\S]*2 \* 1024 \* 1024[\s\S]*"saved session checkpoint"/);
  assert.match(block,/serde_json::from_str\(&content\)/);
  assert.doesNotMatch(block,/fs::metadata\(candidate\)/);
  assert.doesNotMatch(block,/fs::read\(candidate\)/);
});
