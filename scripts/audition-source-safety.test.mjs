import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const model=readFileSync(new URL("../src-tauri/src/audition.rs",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/audition_bridge.rs",import.meta.url),"utf8");
const panel=readFileSync(new URL("../integrations/audition-cep/main.js",import.meta.url),"utf8");
const host=readFileSync(new URL("../integrations/audition-cep/jsx/ShuviAudition.jsx",import.meta.url),"utf8");
const manifest=readFileSync(new URL("../integrations/audition-cep/CSXS/manifest.xml",import.meta.url),"utf8");

test("Audition integration stays on CEP plus ExtendScript and localhost",()=>{
  assert.match(manifest,/Host Name="AUDT"/);
  assert.match(manifest,/Shuvi Audition Bridge/);
  assert.match(bridge,/AUDITION_BRIDGE_PORT: u16 = 17_362/);
  assert.match(panel,/http:\/\/127\.0\.0\.1:17362/);
  assert.match(model,/cep_plus_extendscript/);
  assert.match(model,/uxp_host_api/);
});

test("Audition host capability is discovered rather than guessed",()=>{
  assert.match(host,/Application\.reflect\.properties/);
  assert.match(host,/propertyName\.indexOf\("COMMAND_"\)/);
  assert.match(host,/app\.isCommandEnabled/);
  assert.match(host,/app\.invokeCommand/);
  assert.match(panel,/List Audition commands first/);
  assert.match(panel,/inspectedCommands/);
  assert.match(model,/property\.starts_with\("COMMAND_"\)/);
});

test("Audition playhead mutation requires native WaveDocument readback",()=>{
  assert.match(host,/doc\.reflect\.name != "WaveDocument"/);
  assert.match(host,/doc\.playheadPosition = expected/);
  assert.match(host,/Math\.abs\(observed - expected\) <= 1/);
  assert.match(host,/verified_playhead_readback/);
  assert.match(rust,/verificationStatus/);
  assert.match(rust,/verified_playhead_readback/);
});

test("Audition generic command effects never promote to verified state",()=>{
  assert.match(host,/accepted_unverified_command_side_effect/);
  assert.match(host,/retrySafe: false/);
  assert.match(rust,/"side_effect_verified":false/);
  assert.match(rust,/"retry_automatically":false/);
  assert.match(rust,/RiskLevel::High/);
});

test("Audition readiness is fail closed about unimplemented audio edits",()=>{
  assert.match(model,/source_runtime_verified":false/);
  assert.match(model,/production_ready":false/);
  assert.match(model,/noise_reduction_effect_write":"not_claimed"/);
  assert.match(model,/effect_parameter_dom":"not_claimed"/);
  assert.match(model,/multitrack_mix_write":"not_claimed"/);
});

test("Audition bridge uses bounded authenticated request routing",()=>{
  for(const action of ["inspect_context","list_commands","command_enabled","set_playhead_percent","invoke_command"]){
    assert.match(bridge,new RegExp('"' + action + '"'));
  }
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(panel,/deliveredCount >= 1024/);
  assert.match(panel,/body\.length > 220000/);
});


test("Audition Script Dictionary reflection is bounded and read only",()=>{
  assert.match(host,/\$\.dictionary\.getGroups\(\)/);
  assert.match(host,/\$\.dictionary\.getClasses/);
  assert.match(host,/\$\.dictionary\.getClass/);
  assert.match(host,/maxClasses < 1 \|\| maxClasses > 128/);
  assert.match(host,/shuviAuditionDictionaryMembers\(ref\.methods, 64\)/);
  assert.match(host,/readOnly: true/);
  assert.match(panel,/case "script_dictionary"/);
  assert.match(rust,/"audition_script_dictionary"/);
  assert.match(bridge,/"script_dictionary"/);
});

test("Script Dictionary discovery does not promote effect controls",()=>{
  assert.match(model,/effect_parameter_dom":"not_claimed"/);
  assert.match(model,/noise_reduction_effect_write":"not_claimed"/);
  assert.match(model,/multitrack_mix_write":"not_claimed"/);
  assert.doesNotMatch(rust,/AuditionSetEffect/);
});
