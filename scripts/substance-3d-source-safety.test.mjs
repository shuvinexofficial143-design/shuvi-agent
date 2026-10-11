import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const substance=fs.readFileSync("src-tauri/src/substance_3d.rs","utf8");
const status=fs.readFileSync("docs/SUBSTANCE_3D_STATUS.md","utf8");

test("Substance 3D 80 percent source tools are registered",()=>{
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
    "substance_3d_sampler_script_launch",
    "substance_3d_painter_read_only",
    "substance_3d_sampler_verify_receipt"
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
    "Substance3DSamplerScriptLaunch",
    "Substance3DPainterReadOnly",
    "Substance3DSamplerVerifyReceipt"
  ]) assert.match(lib,new RegExp(name));
});

test("Substance 3D foundation is bounded to five recognized desktop apps",()=>{
  assert.match(substance,/"source_milestone_percent":80/);
  for(const app of ["painter","designer","sampler","stager","modeler"]) assert.match(substance,new RegExp('"' + app + '"'));
  assert.match(substance,/Adobe Substance 3D Painter\.exe/);
  assert.match(substance,/Adobe Substance 3D Designer\.exe/);
  assert.match(substance,/Adobe Substance 3D Sampler\.exe/);
  assert.match(substance,/Adobe Substance 3D Stager\.exe/);
  assert.match(substance,/Adobe Substance 3D Modeler\.exe/);
});

test("Substance 3D 80 percent keeps remote reads and receipts bounded",()=>{
  assert.match(substance,/--enable-remote-scripting/);
  assert.match(substance,/python_api_plugins/);
  assert.match(substance,/--run-script/);
  assert.match(substance,/no_authoritative_scripting_surface_verified_in_current_research/);
  assert.match(substance,/"execution_scope":"painter_pid_bound_fixed_read_only_receipt_plus_sampler_hash_bound_launch_and_completion_receipt"/);
  assert.match(substance,/alg\.version\.painter/);
  assert.match(substance,/Get-NetTCPConnection/);
  assert.match(substance,/\/run\.json/);
  assert.match(lib,/SHUVI_SAMPLER_RECEIPT_PATH/);
  assert.match(substance,/script_completion_receipt_verified/);
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
  assert.match(status,/Current declared source milestone: \*\*80%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});

test("Substance 3D 80 percent execution adapters preserve runtime uncertainty",()=>{
  assert.match(lib,/--enable-remote-scripting/);
  assert.match(lib,/--run-script/);
  assert.match(lib,/managed_process_identity_matches\(state,request\.expected_pid\)/);
  assert.match(substance,/"endpoint_process_ownership_verified":false/);
  assert.match(substance,/"endpoint_process_ownership_verified":true/);
  assert.match(substance,/"arbitrary_remote_command_supported":false/);
  assert.match(lib,/"script_effect_verified":false/);
  assert.match(lib,/"script_completion_verified":false/);
  assert.doesNotMatch(lib,/Substance3DPainterRemoteCommand/);
  assert.doesNotMatch(lib,/Substance3DDesignerPluginExecute/);
});

test("Substance 3D 80 percent never exposes arbitrary Painter script input",()=>{
  assert.match(substance,/query!="api_version"/);
  assert.match(substance,/script!="alg\.version\.painter"/);
  assert.doesNotMatch(lib,/painter_script/);
  assert.doesNotMatch(lib,/Substance3DPainterRemoteCommand/);
  assert.match(lib,/RiskLevel::Medium/);
});

test("Substance 3D 80 percent Sampler receipt stays separate from effect proof",()=>{
  assert.match(substance,/status"\)\.and_then\(Value::as_str\)!=Some\("completed"\)/);
  assert.match(substance,/"script_completion_receipt_verified":true/);
  assert.match(substance,/"script_effect_verified":false/);
  assert.match(substance,/"native_sampler_completion_signal_verified":false/);
});
