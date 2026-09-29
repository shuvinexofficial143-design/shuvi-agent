import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("bounded UTF-8 reader caps actual bytes read from the open handle",()=>{
  assert.match(rust,/io::\{BufRead, BufReader, Read, Write\}/);
  const start=rust.indexOf("fn read_utf8_file_bounded");
  const end=rust.indexOf("fn safe_web_url",start);
  const block=rust.slice(start,end);
  assert.match(block,/fs::File::open\(path\)/);
  assert.match(block,/let limit = \(max_bytes as u64\)\.saturating_add\(1\)/);
  assert.match(block,/file\.take\(limit\)/);
  assert.match(block,/\.read_to_end\(&mut bytes\)/);
  assert.match(block,/bytes\.len\(\) > max_bytes/);
  assert.match(block,/String::from_utf8\(bytes\)/);
});

test("read_file replace_text and search use the bounded reader",()=>{
  const readStart=rust.indexOf("ToolAction::ReadFile { path }",rust.indexOf("async fn execute_tool_with_action_id"));
  const readEnd=rust.indexOf("ToolAction::WriteFile",readStart);
  assert.match(rust.slice(readStart,readEnd),/read_utf8_file_bounded/);
  assert.doesNotMatch(rust.slice(readStart,readEnd),/fs::read_to_string/);

  const replaceStart=rust.indexOf("ToolAction::ReplaceText { path, old, new_value }",rust.indexOf("async fn execute_tool_with_action_id"));
  const replaceEnd=rust.indexOf("ToolAction::ApplyPatch",replaceStart);
  assert.match(rust.slice(replaceStart,replaceEnd),/read_utf8_file_bounded/);
  assert.doesNotMatch(rust.slice(replaceStart,replaceEnd),/fs::read_to_string/);

  const searchStart=rust.indexOf("fn search_text_recursive");
  const searchEnd=rust.indexOf("fn run_git(",searchStart);
  assert.match(rust.slice(searchStart,searchEnd),/read_utf8_file_bounded\(&canonical, 768 \* 1024, "search candidate"\)/);
  assert.doesNotMatch(rust.slice(searchStart,searchEnd),/fs::read_to_string/);
});


test("workspace config uses the bounded open-handle reader",()=>{
  const start=rust.indexOf("fn read_workspace(");
  const end=rust.indexOf("fn write_workspace",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_utf8_file_bounded\([\s\S]*MAX_WORKSPACE_PATH_BYTES as usize[\s\S]*"workspace setting"/);
  assert.doesNotMatch(block,/fs::metadata\(&path\)/);
  assert.doesNotMatch(block,/fs::read_to_string/);
});
