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

test("all provider text requests use the hardened shared client",()=>{
  const start=rust.indexOf("async fn openai_compatible_chat");
  const end=rust.indexOf("fn current_runtime_status",start);
  const block=rust.slice(start,end);
  assert.match(block,/http_client\(\)\?\.post/);
  assert.doesNotMatch(block,/Client::new\(\)/);
});
