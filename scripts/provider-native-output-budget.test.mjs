import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("OpenAI-compatible and xKiro/custom chat requests explicitly bound billable output",()=>{
  const from=rust.indexOf("async fn openai_compatible_chat(");
  const to=rust.indexOf("async fn gemini_chat(",from);
  const block=rust.slice(from,to);
  assert.match(rust,/const MAX_PROVIDER_OUTPUT_TOKENS: u32 = 4096/);
  assert.match(block,/"max_completion_tokens"/);
  assert.match(block,/"max_tokens"/);
  assert.match(block,/payload\[output_key\] = json!\(MAX_PROVIDER_OUTPUT_TOKENS\)/);
  assert.match(block,/http_client\(\)\?\.post\(&url\)\.json\(&payload\)/);
});

test("Gemini native chat requests bound output at the provider, not just after receipt",()=>{
  const from=rust.indexOf("async fn gemini_chat(");
  const to=rust.indexOf("async fn anthropic_chat(",from);
  const block=rust.slice(from,to);
  assert.match(block,/"generationConfig": \{ "maxOutputTokens": MAX_PROVIDER_OUTPUT_TOKENS \}/);
});

test("budget cap is explicitly not misrepresented as a monetary spending guarantee",()=>{
  assert.match(rust,/NOT a dollar-denominated spend limit/);
});
