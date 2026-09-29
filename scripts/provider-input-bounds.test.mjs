import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("provider identity fields are bounded and validated in Rust",()=>{
  assert.match(rust,/const MAX_PROVIDER_MODEL_BYTES: usize = 256/);
  assert.match(rust,/const MAX_PROVIDER_BASE_URL_BYTES: usize = 4 \* 1024/);
  const start=rust.indexOf("fn validate_provider_fields(");
  const end=rust.indexOf("fn key_entry",start);
  const block=rust.slice(start,end);
  assert.match(block,/provider_ids\(\)\.contains\(provider\)/);
  assert.match(block,/model\.len\(\) > MAX_PROVIDER_MODEL_BYTES/);
  assert.match(block,/model\.chars\(\)\.any\(char::is_control\)/);
  assert.match(block,/provider == "custom" && base_url\.is_none\(\)/);
  assert.match(block,/url\.len\(\) > MAX_PROVIDER_BASE_URL_BYTES/);
  assert.match(block,/https:\/\//);
  assert.match(block,/http:\/\//);
});

test("chat and tool preparation both enforce provider field validation",()=>{
  const chat=rust.slice(rust.indexOf("async fn chat("),rust.indexOf("fn runtime_status",rust.indexOf("async fn chat(")));
  assert.match(chat,/validate_provider_fields\([\s\S]*input\.provider\.as_str\(\)[\s\S]*input\.model\.as_str\(\)/);
  const prep=rust.slice(rust.indexOf("fn prepare_tool("),rust.indexOf("fn prepare_powershell",rust.indexOf("fn prepare_tool(")));
  assert.match(prep,/validate_provider_fields\(provider\.as_str\(\), model\.as_str\(\), base_url\.as_deref\(\)\)/);
});

test("credential storage rejects oversized or control-character API keys",()=>{
  assert.match(rust,/const MAX_API_KEY_BYTES: usize = 16 \* 1024/);
  const start=rust.indexOf("fn save_api_key(");
  const end=rust.indexOf("fn delete_api_key",start);
  const block=rust.slice(start,end);
  assert.match(block,/api_key\.len\(\) > MAX_API_KEY_BYTES/);
  assert.match(block,/api_key\.chars\(\)\.any\(char::is_control\)/);
});
