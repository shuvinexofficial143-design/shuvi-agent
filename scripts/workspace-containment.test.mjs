import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("workspace discovery stays inside the canonical selected root",()=>{
  const scan=rust.slice(
    rust.indexOf("fn workspace_scan_recursive"),
    rust.indexOf("fn search_text_recursive")
  );
  const search=rust.slice(
    rust.indexOf("fn search_text_recursive"),
    rust.indexOf("fn run_git(")
  );
  for(const block of [scan,search]){
    assert.match(block,/file_type\.is_symlink\(\)/);
    assert.match(block,/path\.canonicalize\(\)/);
    assert.match(block,/canonical\.starts_with\(root\)/);
  }
  assert.match(scan,/workspace_scan_recursive\(root, &canonical/);
  assert.match(search,/search_text_recursive\(root, &canonical/);
  assert.match(search,/fs::read_to_string\(&canonical\)/);
});

test("workspace and search entry points canonicalize roots before recursion",()=>{
  const scanExec=rust.slice(
    rust.indexOf("ToolAction::WorkspaceScan { path }"),
    rust.indexOf("ToolAction::SearchText { path, query }")
  );
  const searchStart=rust.indexOf("ToolAction::SearchText { path, query }");
  const searchExec=rust.slice(
    searchStart,
    rust.indexOf("ToolAction::ReplaceText",searchStart)
  );
  assert.match(scanExec,/let canonical_root = root\.canonicalize\(\)/);
  assert.match(scanExec,/workspace_scan_recursive\(\s*&canonical_root,\s*&canonical_root/);
  assert.match(searchExec,/let canonical_root = root\.canonicalize\(\)/);
  assert.match(searchExec,/search_text_recursive\(\s*&canonical_root,\s*&canonical_root/);
});
