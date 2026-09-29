import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("provider responses reject declared oversized bodies before JSON decoding",()=>{
  assert.match(rust,/const MAX_PROVIDER_RESPONSE_BYTES: u64 = 8 \* 1024 \* 1024/);
  const helper=rust.slice(rust.indexOf("fn ensure_provider_response_size"),rust.indexOf("fn compact_error"));
  assert.match(helper,/response\.content_length\(\)/);
  assert.match(helper,/bytes > MAX_PROVIDER_RESPONSE_BYTES/);
  const checks=[...rust.matchAll(/ensure_provider_response_size\(&response,/g)].length;
  assert.equal(checks,6);
});

test("assistant and vision text is capped before persistent cloning or joining",()=>{
  assert.match(rust,/const MAX_ASSISTANT_RESPONSE_BYTES: usize = 512 \* 1024/);
  assert.match(rust,/fn collect_provider_text<'a>/);
  assert.match(rust,/output\.len\(\)\.saturating_add\(part\.len\(\)\) > MAX_ASSISTANT_RESPONSE_BYTES/);
  assert.match(rust,/fn bounded_provider_text\(value: &str, label: &str\)/);
  assert.match(rust,/value\.len\(\) > MAX_ASSISTANT_RESPONSE_BYTES/);
  assert.match(rust,/bounded_provider_text\([\s\S]*Provider assistant/);
  assert.match(rust,/collect_provider_text\([\s\S]*Gemini assistant/);
  assert.match(rust,/collect_provider_text\([\s\S]*Anthropic assistant/);
  assert.match(rust,/bounded_provider_text\(text, "Vision provider"\)/);
});
