import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("frontend provider context is bounded separately from visible chat history",()=>{
  assert.match(main,/const MAX_PROVIDER_MESSAGES = 80/);
  assert.match(main,/const MAX_PROVIDER_MESSAGE_BYTES = 256 \* 1024/);
  assert.match(main,/const MAX_PROVIDER_CONTEXT_BYTES = 1_500_000/);
  assert.match(main,/function providerMessageWindow\(source: ChatMessage\[\]\)/);
  assert.match(main,/selected\.length < MAX_PROVIDER_MESSAGES/);
  assert.match(main,/encoder\.encode\(message\.content\)\.byteLength/);
  assert.match(main,/messages: providerMessageWindow\(messages\)/);
  assert.doesNotMatch(main,/messages = providerMessageWindow/);
});

test("Rust independently rejects oversized provider chat payloads",()=>{
  assert.match(rust,/const MAX_CHAT_MESSAGES: usize = 120/);
  assert.match(rust,/const MAX_CHAT_MESSAGE_BYTES: usize = 256 \* 1024/);
  assert.match(rust,/const MAX_CHAT_CONTEXT_BYTES: usize = 2 \* 1024 \* 1024/);
  const start=rust.indexOf("async fn chat(");
  const end=rust.indexOf("#[tauri::command]\nfn runtime_status",start);
  const block=rust.slice(start,end);
  assert.match(block,/input\.messages\.len\(\) > MAX_CHAT_MESSAGES/);
  assert.match(block,/message\.content\.len\(\)/);
  assert.match(block,/message_bytes > MAX_CHAT_MESSAGE_BYTES/);
  assert.match(block,/chat_bytes > MAX_CHAT_CONTEXT_BYTES/);
  assert.match(block,/unsupported chat role/);
});
