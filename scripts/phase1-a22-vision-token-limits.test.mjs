import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const single=rust.slice(rust.indexOf("async fn analyze_png_bytes_with_provider("),rust.indexOf("async fn analyze_png_frames_with_provider("));
const multi=rust.slice(rust.indexOf("async fn analyze_png_frames_with_provider("),rust.indexOf("fn is_ignored_workspace_dir("));
test("A22 vision calls bound user prompt before network request",()=>{
 assert.match(single,/prompt\.len\(\) > MAX_CHAT_MESSAGE_BYTES/);
 assert.match(multi,/prompt\.len\(\)>MAX_CHAT_MESSAGE_BYTES/);
 assert.match(single,/Vision prompt exceeds Shuvi/);
 assert.match(multi,/Multi-frame vision prompt exceeds Shuvi/);
});
test("A22 Gemini single/multiframe vision cap output tokens",()=>{
 for(const region of [single,multi]){
  assert.match(region,/"generationConfig":\s*\{\s*"maxOutputTokens":MAX_PROVIDER_OUTPUT_TOKENS\s*\}/);
 }
});
test("A22 OpenAI and compatible vision cap generated tokens",()=>{
 for(const region of [single,multi]){
  assert.match(region,/max_completion_tokens/);
  assert.match(region,/max_tokens/);
  assert.match(region,/payload\[output_key\]\s*=\s*json!\(MAX_PROVIDER_OUTPUT_TOKENS\)/);
 }
 assert.match(single,/"max_tokens": 1600/);
 assert.match(multi,/"max_tokens":2400/);
});
