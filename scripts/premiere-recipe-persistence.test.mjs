import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("Premiere recipe reads use the bounded open-handle helper",()=>{
  const start=rust.indexOf("fn read_premiere_recipes(");
  const end=rust.indexOf("fn write_premiere_recipes(",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_file_bytes_bounded\([\s\S]*2 \* 1024 \* 1024[\s\S]*"Premiere recipe library"/);
  assert.match(block,/decode_premiere_recipes\(&bytes\)/);
  assert.match(block,/let backup = path\.with_extension\("json\.bak"\)/);
  assert.match(block,/decode\(&path\)\.or_else/);
  assert.match(block,/decode\(&backup\)/);
  assert.doesNotMatch(block,/fs::metadata\(&path\)/);
  assert.doesNotMatch(block,/fs::read\(&path\)/);
});

test("Premiere recipe replacement delegates to bounded validated atomic store",()=>{
  const start=rust.indexOf("fn write_premiere_recipes(");
  const end=rust.indexOf("fn session_checkpoint_path",start);
  const block=rust.slice(start,end);
  assert.match(block,/serde_json::to_vec_pretty\(recipes\)/);
  assert.match(block,/content\.len\(\) > 2 \* 1024 \* 1024/);
  assert.match(block,/decode_premiere_recipes\(&content\)/);
  assert.match(block,/premiere_store::replace\(&path, &content, 2 \* 1024 \* 1024/);
  assert.match(block,/decode_premiere_recipes\(bytes\)\.map\(\|_\| \(\)\)/);
});
