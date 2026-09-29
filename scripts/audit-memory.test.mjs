import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("audit reads keep only a bounded tail in memory",()=>{
  assert.match(rust,/collections::\{HashMap, HashSet, VecDeque\}/);
  const start=rust.indexOf("fn read_audit(");
  const end=rust.indexOf("fn capture_screen_png",start);
  const block=rust.slice(start,end);
  assert.match(block,/let limit = limit\.clamp\(1, 200\)/);
  assert.match(block,/VecDeque::with_capacity\(limit\)/);
  assert.match(block,/if entries\.len\(\) == limit/);
  assert.match(block,/entries\.pop_front\(\)/);
  assert.match(block,/entries\.push_back\(entry\)/);
  assert.match(block,/entries\.into_iter\(\)\.rev\(\)\.collect\(\)/);
  assert.doesNotMatch(block,/\.collect::<Vec<_>>\(\)[\s\S]*entries\.truncate/);
});
