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
  assert.match(main,/boundedMessageBytes\(message\.content, encoder\)/);
  assert.match(main,/encoder\.encode\(content\)\.byteLength/);
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

test("provider context starts at the latest real user task, not prior chat history",()=>{
  assert.match(main,/function currentTaskMessages\(source: ChatMessage\[\]\)/);
  assert.match(main,/message\.role === "user" && !isProviderToolEnvelope\(message\)/);
  assert.match(main,/const taskMessages = currentTaskMessages\(source\)/);
  assert.match(main,/index = taskMessages\.length - 1/);
});

test("tool receipts use a tighter provider-only ceiling than visible chat messages",()=>{
  assert.match(main,/const MAX_PROVIDER_TOOL_ENVELOPE_BYTES = 64 \* 1024/);
  assert.match(main,/function boundedToolEnvelopeBytes/);
  assert.match(main,/bytes <= MAX_PROVIDER_TOOL_ENVELOPE_BYTES/);
  const start=main.indexOf("function providerToolEnvelope");
  const end=main.indexOf("function toolResultMessage",start);
  const block=main.slice(start,end);
  assert.match(block,/boundedToolEnvelopeBytes\(content\) != null/);
});

test("recovery checkpoint stores only the active task slice",()=>{
  const start=main.indexOf("function currentCheckpoint()");
  const end=main.indexOf("function renderOrchestrationStatus",start);
  const block=main.slice(start,end);
  assert.match(block,/messages: currentTaskMessages\(messages\)/);
});
