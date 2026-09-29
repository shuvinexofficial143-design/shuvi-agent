import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("ui_set_value preserves exact text and permits clearing a field",()=>{
  const start=rust.indexOf('"ui_set_value" => {');
  const end=rust.indexOf('"ui_focus" =>',start);
  const block=rust.slice(start,end);
  assert.match(block,/arg_raw_string\(&proposal\.arguments, "value"\)\?/);
  assert.doesNotMatch(block,/arg_string\(&proposal\.arguments, "value"\)/);
  assert.match(block,/value\.len\(\) > 20_000/);
  assert.match(block,/value_length=\{\}/);
});
