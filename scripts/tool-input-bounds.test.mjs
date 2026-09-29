import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("generic model string arrays are bounded before cloning",()=>{
  assert.match(rust,/const MAX_TOOL_STRING_ARRAY_ITEMS: usize = 256/);
  assert.match(rust,/const MAX_TOOL_STRING_ARRAY_ITEM_BYTES: usize = 16 \* 1024/);
  assert.match(rust,/const MAX_TOOL_STRING_ARRAY_BYTES: usize = 512 \* 1024/);
  const start=rust.indexOf("fn arg_string_array(");
  const end=rust.indexOf("fn absolute_path",start);
  const block=rust.slice(start,end);
  assert.match(block,/items\.len\(\) > MAX_TOOL_STRING_ARRAY_ITEMS/);
  assert.ok(block.indexOf("items.len() > MAX_TOOL_STRING_ARRAY_ITEMS") < block.indexOf("Vec::with_capacity"));
  assert.match(block,/value\.len\(\) > MAX_TOOL_STRING_ARRAY_ITEM_BYTES/);
  assert.match(block,/total_bytes > MAX_TOOL_STRING_ARRAY_BYTES/);
});

test("launch_app has stricter argument count and aggregate bounds",()=>{
  const start=rust.indexOf('"launch_app" => {');
  const end=rust.indexOf('"open_url" => {',start);
  const block=rust.slice(start,end);
  assert.match(block,/program\.len\(\) > 4_096/);
  assert.match(block,/args\.len\(\) > MAX_LAUNCH_ARGS/);
  assert.match(block,/arg\.len\(\) > MAX_LAUNCH_ARG_BYTES/);
  assert.match(block,/sum::<usize>\(\) > MAX_LAUNCH_ARGS_BYTES/);
});
