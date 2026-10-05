import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(path,"utf8");

test("Remotion runtime pins one exact aligned Remotion release",()=>{
  const pkg=JSON.parse(read("remotion-runtime/package.json"));
  assert.equal(pkg.dependencies.remotion,"4.0.532");
  assert.equal(pkg.dependencies["@remotion/bundler"],"4.0.532");
  assert.equal(pkg.dependencies["@remotion/renderer"],"4.0.532");
  for(const value of Object.values(pkg.dependencies)){
    assert.doesNotMatch(value,/^[~^]/);
  }
});

test("Remotion runtime is fixed-code and fail-closed around manifest evidence",()=>{
  const renderer=read("remotion-runtime/render.mjs");
  const runtime=read("remotion-runtime/src/runtime.mjs");
  const entry=read("remotion-runtime/src/index.mjs");
  assert.match(renderer,/renderer_candidate!=="remotion"/);
  assert.match(renderer,/unknown blocker/);
  assert.match(renderer,/arbitrary_provider_code_executed:false/);
  assert.match(renderer,/alpha_channel_probe_verified:false/);
  assert.match(renderer,/codec:transparent\?"prores":"h264"/);
  assert.match(renderer,/renderOptions\.pixelFormat="yuva444p10le"/);
  assert.match(renderer,/renderOptions\.proResProfile="4444"/);
  assert.doesNotMatch(renderer,/child_process|eval\s*\(|new Function|Function\s*\(/);
  assert.doesNotMatch(runtime,/eval\s*\(|new Function|Function\s*\(/);
  assert.match(entry,/registerRoot\(Root\)/);
});

test("Rust planner exports bounded review samples to the fixed runtime",()=>{
  const source=read("src-tauri/src/motion_graphics.rs");
  assert.match(source,/"review":self\.plan\.review/);
  assert.match(source,/remotion_runtime_execution_required/);
  assert.doesNotMatch(source,/remotion_runtime_renderer_not_implemented/);
});
