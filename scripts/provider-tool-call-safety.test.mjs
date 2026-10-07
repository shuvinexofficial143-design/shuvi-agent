import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("provider tool-call batches fail closed instead of taking the first call", () => {
  assert.match(rust, /fn single_tagged_batch_call/);
  assert.match(rust, /Never silently[\s\S]*discard later calls/);
  assert.match(rust, /if items\.len\(\) != 1/);
  assert.match(rust, /Provider emitted \{\} native tool calls; Shuvi accepts exactly one approved tool call at a time/);
  assert.match(rust, /Provider emitted \{\} Responses API function calls; Shuvi accepts exactly one approved tool call at a time/);
});

test("provider tool-call arguments stay object-shaped and duplicate tagged keys fail", () => {
  assert.match(rust, /parsed\.is_object\(\)\.then_some\(parsed\)/);
  assert.match(rust, /if !proposal\.arguments\.is_object\(\)/);
  assert.match(rust, /if arguments\.contains_key\(key\)[\s\S]*return None/);
});

test("native tool intent wins over mixed prose for OpenAI-compatible providers", () => {
  const start = rust.indexOf("fn openai_compatible_assistant_or_tool");
  const end = rust.indexOf("fn openai_compatible_assistant_text", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = rust.slice(start, end);
  assert.ok(block.indexOf("openai_compatible_native_tool_call") < block.indexOf("openai_compatible_assistant_text"));
  assert.match(rust, /let assistant_text = openai_compatible_assistant_or_tool\(&body\)\?/);
});
