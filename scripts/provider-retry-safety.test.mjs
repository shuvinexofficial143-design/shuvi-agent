import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("custom text provider requires its saved API key",()=>{
  const start=rust.indexOf("async fn openai_compatible_chat");
  const end=rust.indexOf("async fn gemini_chat",start);
  const block=rust.slice(start,end);
  assert.match(block,/matches!\(input\.provider\.as_str\(\), "xkiro" \| "deepseek" \| "openai" \| "openrouter" \| "custom"\)/);
  assert.match(block,/No API key saved for this provider/);
  assert.ok(block.indexOf("No API key saved for this provider") < block.indexOf("bearer_auth"));
});

test("provider generation retries do not retry ambiguous gateway failures",()=>{
  const start=rust.indexOf("async fn send_with_retry");
  const end=rust.indexOf("fn ensure_provider_response_size",start);
  const block=rust.slice(start,end);
  assert.match(block,/let retryable = status\.as_u16\(\) == 429/);
  assert.doesNotMatch(block,/502 \| 503/);
  assert.match(block,/duplicate billed generation/);
  assert.match(block,/let retryable = error\.is_connect\(\)/);
});
