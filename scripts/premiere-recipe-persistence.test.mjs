import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("Premiere recipe reads use the bounded open-handle helper",()=>{
  const start=rust.indexOf("fn read_premiere_recipes(");
  const end=rust.indexOf("fn write_premiere_recipes(",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_utf8_file_bounded\([\s\S]*2 \* 1024 \* 1024[\s\S]*"Premiere recipe library"/);
  assert.match(block,/serde_json::from_str\(&content\)/);
  assert.doesNotMatch(block,/fs::metadata\(&path\)/);
  assert.doesNotMatch(block,/fs::read\(&path\)/);
});

test("Premiere recipe replacement preserves and restores the previous good library",()=>{
  const start=rust.indexOf("fn write_premiere_recipes(");
  const end=rust.indexOf("fn session_checkpoint_path",start);
  const block=rust.slice(start,end);
  assert.match(block,/let backup = path\.with_extension\("json\.bak"\)/);
  assert.match(block,/fs::rename\(&path, &backup\)/);
  assert.match(block,/if let Err\(error\) = fs::rename\(&temp, &path\)/);
  assert.match(block,/fs::rename\(&backup, &path\)/);
  assert.match(block,/fs::remove_file\(&backup\)/);
  assert.doesNotMatch(block,/remove_file\(&path\)/);
});
