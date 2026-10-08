import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("provider HTTP client refuses automatic redirects",()=>{
  const start=rust.indexOf("fn http_client()");
  const end=rust.indexOf("async fn send_with_retry",start);
  const block=rust.slice(start,end);
  assert.match(block,/\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(block,/\.timeout\(Duration::from_secs\(120\)\)/);
});

test("all provider text requests use hardened shared clients",()=>{
  const start=rust.indexOf("async fn openai_compatible_chat");
  const end=rust.indexOf("fn current_runtime_status",start);
  const block=rust.slice(start,end);
  assert.match(block,/let client = if input\.provider == "xkiro"[\s\S]*streaming_http_client\(\)\?[\s\S]*http_client\(\)\?/);
  assert.match(block,/let mut request = client\.post\(&url\)\.json\(&payload\)/);
  assert.doesNotMatch(block,/Client::new\(\)/);
  const streamStart=rust.indexOf("fn streaming_http_client()");
  const streamEnd=rust.indexOf("async fn send_with_retry",streamStart);
  const streaming=rust.slice(streamStart,streamEnd);
  assert.match(streaming,/\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(streaming,/\.connect_timeout\(Duration::from_secs\(20\)\)/);
});
