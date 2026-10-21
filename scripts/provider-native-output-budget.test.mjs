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
  assert.match(block,/payload\[output_key\] = json!\(input\.native_task_output_tokens\.unwrap_or\(MAX_PROVIDER_OUTPUT_TOKENS\)\)/);
  assert.match(rust,/const MAX_NATIVE_TASK_OUTPUT_TOKENS: u32 = 2048/);
  assert.match(block,/http_client\(\)\?\.post\(&url\)\.json\(&payload\)/);
});

test("Gemini native chat requests bound output at the provider, not just after receipt",()=>{
  const from=rust.indexOf("async fn gemini_chat(");
  const to=rust.indexOf("async fn anthropic_chat(",from);
  const block=rust.slice(from,to);
  assert.match(block,/"generationConfig": \{ "maxOutputTokens": input\.native_task_output_tokens\.unwrap_or\(MAX_PROVIDER_OUTPUT_TOKENS\) \}/);
});

test("budget cap is explicitly not misrepresented as a monetary spending guarantee",()=>{
  assert.match(rust,/NOT a dollar-denominated spend limit/);
});

test("native task-only output caps are backend-owned and leave ordinary chat unchanged",()=>{
 assert.match(rust,/const MAX_NATIVE_TASK_OUTPUT_TOKENS: u32 = 2048/);
 assert.match(rust,/#\[serde\(skip\)\]\s*native_task_output_tokens: Option<u32>/);
 const chat=rust.slice(rust.indexOf("async fn chat("),rust.indexOf("fn native_task_ai_usage("));
 const durable=chat.indexOf("native_task_ai_ledger::reserve(");
 const cap=chat.indexOf("input.native_task_output_tokens=Some(MAX_NATIVE_TASK_OUTPUT_TOKENS)");
 const provider=chat.indexOf("let answer=send_chat(input,key).await");
 assert.ok(durable>=0&&cap>durable&&provider>cap,
  "task-only cap must be set AFTER immutable quota and durable request authorization");
 assert.match(rust.slice(rust.indexOf("async fn anthropic_chat("),rust.indexOf("async fn send_chat(")),
  /"max_tokens": input\.native_task_output_tokens\.unwrap_or\(2048\)/);
});
