import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("diagnostics retention is bounded to Shuvi-owned JSON files",()=>{
  assert.match(rust,/const MAX_DIAGNOSTIC_FILES: usize = 16/);
  const start=rust.indexOf("fn prune_diagnostics_dir");
  const end=rust.indexOf("#[tauri::command]\nfn export_diagnostics",start);
  const block=rust.slice(start,end);
  assert.match(block,/name\.starts_with\("shuvi-diagnostics-"\)/);
  assert.match(block,/name\.ends_with\("\.json"\)/);
  assert.match(block,/keep\.truncate\(keep_existing\)/);
  assert.match(block,/keep_paths\.contains\(&path\)/);
  assert.match(block,/fs::remove_file\(path\)/);
  assert.doesNotMatch(block,/remove_dir_all/);
});

test("diagnostics export reserves one slot before writing collision-resistant file",()=>{
  const start=rust.indexOf("fn export_diagnostics(");
  const end=rust.indexOf("#[cfg_attr",start);
  const block=rust.slice(start,end);
  assert.match(block,/prune_diagnostics_dir\(&dir, MAX_DIAGNOSTIC_FILES\.saturating_sub\(1\)\)/);
  assert.match(block,/shuvi-diagnostics-\{\}-\{\}\.json/);
  assert.match(block,/Uuid::new_v4\(\)/);
});
