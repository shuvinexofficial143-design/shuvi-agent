import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("custom provider credentials require HTTPS off loopback",()=>{
  assert.match(rust,/net::IpAddr/);
  assert.match(rust,/fn url_host_is_loopback\(parsed: &Url\) -> bool/);
  assert.match(rust,/host\.eq_ignore_ascii_case\("localhost"\)/);
  assert.match(rust,/host\.parse::<IpAddr>\(\)\.is_ok_and\(\|ip\| ip\.is_loopback\(\)\)/);
  const start=rust.indexOf("fn validate_provider_fields");
  const end=rust.indexOf("fn key_entry",start);
  const block=rust.slice(start,end);
  assert.match(block,/provider == "custom" && parsed\.scheme\(\) != "https" && !url_host_is_loopback\(&parsed\)/);
  assert.match(block,/must use HTTPS unless the endpoint is loopback-only/);
});

test("custom request attaches saved key only after provider validation gate",()=>{
  const chat=rust.slice(
    rust.indexOf("async fn chat("),
    rust.indexOf("#[tauri::command]\nfn runtime_status")
  );
  assert.match(chat,/validate_provider_fields\(/);
  assert.ok(chat.indexOf("validate_provider_fields(") < chat.indexOf("load_api_key(&input.provider)"));
  const openai=rust.slice(
    rust.indexOf("async fn openai_compatible_chat"),
    rust.indexOf("async fn gemini_chat")
  );
  assert.match(openai,/request = request\.bearer_auth\(key\)/);
});
