import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("existing file mutations open only after repeated link checks",()=>{
  const checkStart=rust.indexOf("fn reject_existing_symlink_target");
  const checkEnd=rust.indexOf("fn open_existing_file_for_mutation",checkStart);
  const check=rust.slice(checkStart,checkEnd);
  assert.match(check,/fs::symlink_metadata\(path\)/);
  assert.match(check,/metadata\.file_type\(\)\.is_symlink\(\)/);
  assert.match(check,/ErrorKind::NotFound/);

  const openStart=rust.indexOf("fn open_existing_file_for_mutation");
  const openEnd=rust.indexOf("fn read_utf8_open_file_bounded",openStart);
  const open=rust.slice(openStart,openEnd);
  assert.equal((open.match(/reject_existing_symlink_target\(path, label\)/g)??[]).length,2);
  assert.match(open,/OpenOptions::new\(\)[\s\S]*\.read\(true\)[\s\S]*\.write\(true\)[\s\S]*\.open\(path\)/);
  assert.match(open,/\.metadata\(\)[\s\S]*\.is_file\(\)/);
});

test("write_file creates new targets exclusively and mutates existing targets by handle",()=>{
  const start=rust.indexOf("ToolAction::WriteFile { path, content }",rust.indexOf("async fn execute_tool_with_action_id"));
  const end=rust.indexOf("ToolAction::CreateDirectory",start);
  const block=rust.slice(start,end);
  assert.match(block,/create_new\(true\)/);
  assert.match(block,/ErrorKind::AlreadyExists/);
  assert.match(block,/open_existing_file_for_mutation\(target, "write_file"\)/);
  assert.match(block,/overwrite_open_file\(&mut file, content\.as_bytes\(\), "write_file"\)/);
  assert.doesNotMatch(block,/fs::write\(&path/);
});

test("replace_text reads and overwrites the same opened file handle",()=>{
  const start=rust.indexOf("ToolAction::ReplaceText { path, old, new_value }",rust.indexOf("async fn execute_tool_with_action_id"));
  const end=rust.indexOf("ToolAction::ApplyPatch",start);
  const block=rust.slice(start,end);
  assert.match(block,/open_existing_file_for_mutation\(Path::new\(&path\), "replace_text"\)/);
  assert.match(block,/read_utf8_open_file_bounded\(/);
  assert.match(block,/overwrite_open_file\(&mut file, updated\.as_bytes\(\), "replace_text"\)/);
  assert.doesNotMatch(block,/fs::write\(&path/);
});
