import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("file-tool paths reject ambiguous dot segments before staging",()=>{
  assert.match(rust,/path::\{Component, Path\}/);
  const start=rust.indexOf("fn absolute_path");
  const end=rust.indexOf("fn safe_web_url",start);
  const block=rust.slice(start,end);
  assert.match(block,/value\.len\(\) as u64 > MAX_WORKSPACE_PATH_BYTES/);
  assert.match(block,/value\.chars\(\)\.any\(char::is_control\)/);
  assert.match(block,/path\.is_absolute\(\)/);
  assert.match(block,/Component::CurDir \| Component::ParentDir/);
  assert.match(block,/must not contain '\.' or '\.\.' path segments/);
});
