import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("xKiro is a dedicated provider with fixed endpoint and vendor-prefixed default model", () => {
  const providersStart = rust.indexOf("fn providers()");
  const providersEnd = rust.indexOf("fn provider_ids()", providersStart);
  const providers = rust.slice(providersStart, providersEnd);
  assert.match(providers, /id: "xkiro"/);
  assert.match(providers, /name: "xKiro"/);
  assert.match(providers, /default_model: "openai\/gpt-5\.6-sol"/);
  assert.match(providers, /api_key_required: true/);
  assert.match(providers, /custom_base_url: false/);

  const openaiStart = rust.indexOf("async fn openai_compatible_chat");
  const openaiEnd = rust.indexOf("async fn gemini_chat", openaiStart);
  const openai = rust.slice(openaiStart, openaiEnd);
  assert.match(openai, /"xkiro" => "https:\/\/api\.xkiro\.com\/v1\/chat\/completions"/);
  assert.match(openai, /"deepseek" \| "openai" \| "openrouter" \| "xkiro" \| "custom"/);
});

test("xKiro model IDs fail closed unless they use vendor/model form", () => {
  const start = rust.indexOf("fn validate_provider_fields(");
  const end = rust.indexOf("fn key_entry", start);
  const block = rust.slice(start, end);
  assert.match(block, /if provider == "xkiro"/);
  assert.match(block, /model\.split_once\('\/'\)/);
  assert.match(block, /xKiro model IDs must include the vendor prefix/);
  assert.match(block, /model ID must use the vendor\/model form/);
});

test("xKiro sends one native Shuvi bridge function while local validation remains authoritative", () => {
  const schemaStart = rust.indexOf("fn xkiro_shuvi_tool_definition()");
  const schemaEnd = rust.indexOf("fn native_tool_proposal", schemaStart);
  const schema = rust.slice(schemaStart, schemaEnd);
  assert.match(schema, /"name": "shuvi_tool"/);
  assert.match(schema, /"required": \["tool", "arguments"\]/);
  assert.match(schema, /Shuvi locally validates the tool name, arguments, task dependencies, permissions and execution evidence/);

  const openaiStart = rust.indexOf("async fn openai_compatible_chat");
  const openaiEnd = rust.indexOf("async fn gemini_chat", openaiStart);
  const openai = rust.slice(openaiStart, openaiEnd);
  assert.match(openai, /if input\.provider == "xkiro"/);
  assert.match(openai, /payload\["tools"\] = json!\(\[xkiro_shuvi_tool_definition\(\)\]\)/);
  assert.match(openai, /payload\["tool_choice"\] = Value::String\("auto"\.into\(\)\)/);
});

test("xKiro wrapper is revalidated through the existing Shuvi proposal allowlist", () => {
  const start = rust.indexOf("fn native_tool_proposal");
  const end = rust.indexOf("fn openai_compatible_native_tool_call", start);
  const block = rust.slice(start, end);
  assert.match(block, /if name == "shuvi_tool"/);
  assert.match(block, /parse_tool_proposal\(&raw\.to_string\(\)\)\?/);
  assert.match(block, /xKiro emitted a native Shuvi tool request/);
});
