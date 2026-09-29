import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("write_file preserves exact caller bytes instead of trimming text",()=>{
  const start=rust.indexOf('"write_file" => {');
  const end=rust.indexOf('"create_directory" =>',start);
  const block=rust.slice(start,end);
  assert.match(block,/arg_raw_string\(&proposal\.arguments, "content"\)\?/);
  assert.doesNotMatch(block,/arg_string\(&proposal\.arguments, "content"\)/);
  assert.match(block,/content\.len\(\) > MAX_WRITE_BYTES/);
});

test("raw string helper permits intentional empty and whitespace-only file content",()=>{
  const start=rust.indexOf("fn arg_raw_string(");
  const end=rust.indexOf("fn arg_optional_string",start);
  const block=rust.slice(start,end);
  assert.match(block,/\.and_then\(Value::as_str\)/);
  assert.match(block,/\.map\(str::to_string\)/);
  assert.doesNotMatch(block,/str::trim/);
  assert.doesNotMatch(block,/!value\.is_empty/);
});
