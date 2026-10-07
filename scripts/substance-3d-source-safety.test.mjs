import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const substance=fs.readFileSync("src-tauri/src/substance_3d.rs","utf8");
const status=fs.readFileSync("docs/SUBSTANCE_3D_STATUS.md","utf8");

test("Substance 3D 60 percent source tools are registered",()=>{
  for(const name of [
    "substance_3d_capability_report",
    "substance_3d_readiness_report",
    "substance_3d_detect",
    "substance_3d_launch",
    "substance_3d_automation_catalog",
    "substance_3d_plan_automation",
    "substance_3d_painter_remote_launch",
    "substance_3d_painter_remote_preflight",
    "substance_3d_sampler_script_fingerprint",
    "substance_3d_sampler_script_launch"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "Substance3DCapabilityReport",
    "Substance3DReadinessReport",
    "Substance3DDetect",
    "Substance3DLaunch",
    "Substance3DAutomationCatalog",
    "Substance3DPlanAutomation",
    "Substance3DPainterRemoteLaunch",
    "Substance3DPainterRemotePreflight",
    "Substance3DSamplerScriptFingerprint",
    "Substance3DSamplerScriptLaunch"
  ]) assert.match(lib,new RegExp(name));
});

test("Substance 3D foundation is bounded to five recognized desktop apps",()=>{
  assert.match(substance,/"source_milestone_percent":60/);
  for(const app of ["painter","designer","sampler","stager","modeler"]) assert.match(substance,new RegExp('"' + app + '"'));
  assert.match(substance,/Adobe Substance 3D Painter\.exe/);
  assert.match(substance,/Adobe Substance 3D Designer\.exe/);
  assert.match(substance,/Adobe Substance 3D Sampler\.exe/);
  assert.match(substance,/Adobe Substance 3D Stager\.exe/);
  assert.match(substance,/Adobe Substance 3D Modeler\.exe/);
});

test("Substance 3D 60 percent keeps documented surfaces bounded",()=>{
  assert.match(substance,/--enable-remote-scripting/);
  assert.match(substance,/python_api_plugins/);
  assert.match(substance,/--run-script/);
  assert.match(substance,/no_authoritative_scripting_surface_verified_in_current_research/);
  assert.match(substance,/"execution_scope":"painter_remote_launch_and_connectivity_preflight_plus_sampler_hash_bound_script_launch"/);
  assert.match(substance,/"mutation_performed":false/);
  assert.match(substance,/PAINTER_REMOTE_PORT:u16=60041/);
  assert.match(substance,/TcpStream::connect_timeout/);
  assert.match(substance,/expected_script_sha256/);
  assert.match(substance,/verify_sampler_script_binding/);
  assert.doesNotMatch(lib,/Substance3DProjectContext/);
  assert.doesNotMatch(lib,/Substance3DMaterialWrite/);
  assert.doesNotMatch(lib,/Substance3DRenderExecute/);
});

test("Substance 3D runtime and production flags remain false",()=>{
  assert.match(substance,/"source_runtime_verified":false/);
  assert.match(substance,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*60%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});

test("Substance 3D 60 percent execution adapters preserve runtime uncertainty",()=>{
  assert.match(lib,/--enable-remote-scripting/);
  assert.match(lib,/--run-script/);
  assert.match(lib,/managed_process_identity_matches\(state,request\.expected_pid\)/);
  assert.match(substance,/"endpoint_process_ownership_verified":false/);
  assert.match(substance,/"remote_command_dispatch_supported":false/);
  assert.match(lib,/"script_effect_verified":false/);
  assert.match(lib,/"script_completion_verified":false/);
  assert.doesNotMatch(lib,/Substance3DPainterRemoteCommand/);
  assert.doesNotMatch(lib,/Substance3DDesignerPluginExecute/);
});
