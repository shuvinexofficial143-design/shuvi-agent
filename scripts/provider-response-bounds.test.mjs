import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const cargo=readFileSync(new URL("../src-tauri/Cargo.toml",import.meta.url),"utf8");

test("provider JSON bodies are bounded while streaming before deserialization",()=>{
  assert.match(cargo,/features = \["json", "rustls-tls", "stream"\]/);
  const start=rust.indexOf("async fn bounded_provider_json");
  const end=rust.indexOf("fn collect_provider_text",start);
  const helper=rust.slice(start,end);
  assert.match(helper,/response\.chunk\(\)/);
  assert.match(helper,/body\.len\(\)\.saturating_add\(chunk\.len\(\)\) > MAX_PROVIDER_RESPONSE_BYTES as usize/);
  assert.match(helper,/body\.extend_from_slice\(&chunk\)/);
  assert.match(helper,/serde_json::from_slice::<Value>\(&body\)/);
  assert.ok(helper.indexOf("MAX_PROVIDER_RESPONSE_BYTES") < helper.indexOf("serde_json::from_slice"));
});

test("text and vision provider paths use bounded_provider_json",()=>{
  for(const label of ["Provider","Gemini","Anthropic","Gemini vision","Anthropic vision","Vision provider"]){
    assert.ok(rust.includes('bounded_provider_json(response, "'+label+'").await?'));
  }
  const start=rust.indexOf("async fn openai_compatible_chat");
  const end=rust.indexOf("fn current_runtime_status",start);
  const block=rust.slice(start,end);
  assert.doesNotMatch(block,/response\s*\.json\(\)\s*\.await/);
});
