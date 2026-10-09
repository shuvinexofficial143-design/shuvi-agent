import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const mod=readFileSync(new URL("../src-tauri/src/blender_worker.rs",import.meta.url),"utf8");
const py=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_bridge.py",import.meta.url),"utf8");
const conf=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8"));

test("the official Blender agent is contacted only via a fixed bundled Python adapter",()=>{
  assert.equal(conf.bundle.resources["../integrations/blender-worker/shuvi_blender_bridge.py"],
    "blender-worker/shuvi_blender_bridge.py");
  assert.match(rust,/mod blender_worker;/);
  assert.match(rust,/blender_worker::inspect\(/);
  assert.match(mod,/Command::new\(python_exe\)/);
  assert.match(mod,/command\.arg\("-B"\)\.arg\(script\)/);
  assert.doesNotMatch(mod,/shell\(|-c"|Command::new\("powershell/);
});
test("Blender agent approval is explicit and read-only, no unrestricted operation/permission",()=>{
  assert.match(rust,/"blender_inspect" => \{/);
  assert.match(rust,/ToolAction::BlenderInspect/);
  assert.match(rust,/"scene\.inspect"\|"system\.capabilities"/);
  assert.match(rust,/"Inspect Blender through authenticated worker"\.into\(\),detail,RiskLevel::Medium/);
  assert.match(py,/choices=\("scene.inspect", "system.capabilities"\)/);
  assert.match(py,/policy=SafetyPolicy\(\)/);
  assert.doesNotMatch(py,/allow_mutations=True|allow_rendering=True|exec\(|eval\(/);
  assert.match(py,/from shuvi_blender_agent\.client import BlenderController/);
  assert.match(py,/from shuvi_blender_agent\.process import LaunchConfig, launch/);
});
test("native Blender worker never reports success without an authenticated host roundtrip",()=>{
  assert.match(mod,/register_managed_process\(state,pid\)/);
  assert.match(mod,/unregister_managed_process\(state,pid\)/);
  assert.match(mod,/collect_with_deadline\(child,Duration::from_secs\(45\)\)/);
  for(const needle of ["protocol_version","authenticated_bridge_roundtrip","mutations_allowed","rendering_allowed","operation","status"])
    assert.ok(mod.includes(needle),needle);
  assert.match(py,/authenticated_bridge_roundtrip": True/);
  assert.match(py,/mutations_allowed": False/);
  assert.match(py,/rendering_allowed": False/);
  assert.match(mod,/value\.get\("status"\)\.and_then\(Value::as_str\)!=Some\("succeeded"\)/);
});
test("Blender mutation/render APIs are not added to the model allowlist",()=>{
  const allowlist=rust.split("fn parse_tool_proposal(")[1].split("fn chat_response(")[0];
  assert.match(allowlist,/\| "blender_inspect"/);
  assert.doesNotMatch(allowlist,/\| "blender_(?:run|render|save|mutate)"/);
  assert.match(py,/only read-only/);
});
