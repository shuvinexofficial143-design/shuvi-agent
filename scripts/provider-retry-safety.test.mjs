import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("provider retries exclude ambiguous timeout and server-completion cases",()=>{
  const start=rust.indexOf("async fn send_with_retry");
  const end=rust.indexOf("fn ensure_provider_response_size",start);
  const block=rust.slice(start,end);
  assert.match(block,/status\.as_u16\(\) == 429/);
  assert.match(block,/matches!\(status\.as_u16\(\), 502 \| 503\)/);
  assert.doesNotMatch(block,/500 \| 502/);
  assert.doesNotMatch(block,/503 \| 504/);
  assert.match(block,/let retryable = error\.is_connect\(\)/);
  assert.doesNotMatch(block,/error\.is_timeout\(\)/);
  assert.doesNotMatch(block,/error\.is_request\(\)/);
  assert.match(block,/duplicate cost/);
});

test("retry attempt count and backoff remain finite",()=>{
  const start=rust.indexOf("async fn send_with_retry");
  const end=rust.indexOf("fn ensure_provider_response_size",start);
  const block=rust.slice(start,end);
  assert.match(block,/for attempt in 0\.\.3_u32/);
  assert.match(block,/attempt < 2/);
  assert.match(block,/350_u64\.saturating_mul\(1_u64 << attempt\)/);
});
