import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const lib=read("src-tauri/src/lib.rs");
const native=read("src-tauri/src/blender_session_worker.rs");
const broker=read("integrations/blender-worker/shuvi_blender_session.py");
const bundle=JSON.parse(read("src-tauri/tauri.conf.json"));
const input=read("src-tauri/src/blender_input_checkpoint.rs");

test("four persistent-session actions are wired through ordinary audited ToolAction",()=>{
  for(const action of [
    "BlenderSessionStart","BlenderSessionInspect","BlenderSessionPlan","BlenderSessionClose"
  ]) assert.ok(lib.includes("ToolAction::"+action),action);
  for(const action of [
    "blender_session_start","blender_session_inspect","blender_session_plan","blender_session_close"
  ]) assert.match(lib,new RegExp('"'+action+'"'));
  assert.match(lib,/blender_session_worker::start\(&state\.blender_session,state/);
  assert.match(lib,/blender_session_worker::plan\(&state\.blender_session,state/);
  assert.match(lib,/blender_session_worker::close\(&state\.blender_session,state/);
  assert.match(lib,/blender_session: blender_session_worker::SessionRegistry/);
  assert.match(lib,/RiskLevel::High\)/);
  assert.match(lib,/"blender_session_objects" => \{/);
  assert.match(lib,/ToolAction::BlenderSessionObjects/);
  assert.match(lib,/expected_scene_revision=arg_string\(&proposal.arguments,"expected_scene_revision"\)/);
  assert.match(lib,/&plan,allow_render,&expected_scene_revision,execution_action_id/);
  assert.match(lib,/Persist(?:ent)? Blender plan requires 1\.\.6 typed steps/);
  assert.equal(bundle.bundle.resources[
    "../integrations/blender-worker/shuvi_blender_session.py"
  ],"blender-worker/shuvi_blender_session.py");
});

test("native registry checks real managed PID identity, resource limit and aborts on unknown",()=>{
  for(const text of [
    "register_managed_process(state,pid)",
    "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    "AssignProcessToJobObject",
    "SetInformationJobObject",
    "spawn_watchdog(app,id,pid,start_time,watchdog,invalidated)",
    "invalidated.store(true,Ordering::Release)",
    "session.invalidated.load(Ordering::Acquire)",
    "managed_process_identity_matches(state,session.child.id())",
    "current_runtime_status(state)",
    "terminate_managed_process_tree(self.child.id())",
    "retire(state,&mut slot)",
    "recv_timeout(",
    "session_reconnect_allowed",
    "source_action_id",
    "blender_artifact_manifest::build(",
    "blender_input_checkpoint::inspect(blend_file,expected_blend_sha256)?",
    "blender_input_checkpoint::still_current(src)",
    "pub(crate) fn objects(",
    'request(session,state,"objects",Some(&query),false',
    '"requires_new_action_approval_for_mutation":true',
    "input_checkpoint"
  ]) assert.ok(native.includes(text),text);
  assert.match(native,/SESSION_MAX_AGE:Duration=Duration::from_secs\(15\*60\)/);
  assert.match(native,/MAX_FRAME:usize=131072/);
  assert.doesNotMatch(native,/Command::new\("powershell|shell\(|\.arg\("-c"\)/);
});

test("session broker uses fixed authenticated Blender launch and no model Python execution",()=>{
  for(const text of [
    "from shuvi_blender_agent.process import LaunchConfig, launch",
    "from shuvi_blender_agent.client import BlenderController",
    "from shuvi_blender_agent.plans import Plan, PlanRunner",
    "MAX_REQUEST_BYTES = 65536",
    "MAX_COMMANDS = 48",
    'arm != b\'{"version":1,"op":"arm"}\\n\'',
    "allow_destructive=False",
    "status\": \"outcome_unknown",
    "\"retry_automatically\": False",
    "capture_scene(controller, actual, require_saved_file=False)",
    "reopen_checkpoint(blender_exe, actual, before)",
    "if request_allow_render and not args.allow_render",
    'current.data.get("revision") != expected_scene_revision',
    "Stale Blender scene revision: no plan steps dispatched",
    '"objects.list"',
    '"Read-only Blender object query exceeds allowlisted bounds"',
    '"read_only": True',
    "inspect_input_source(args.blend_file, args.expected_blend_sha256)",
    "Authenticated Blender did not load the exact approved checkpoint",
    '"input_checkpoint": source_before'
  ]) assert.ok(broker.includes(text),text);
  assert.doesNotMatch(broker,/\beval\(|\bexec\(|subprocess\.run\(|shell=True/);
  assert.match(input,/pub\(crate\) fn inspect\(/);
  assert.match(input,/pub\(crate\) fn still_current\(/);
});

const candidates=[["python3"],["python"],["py","-3"]];
const python=candidates.find(parts=>{
  const [binary,...args]=parts;
  return spawnSync(binary,[...args,"-c","import ast"],{timeout:5000}).status===0;
});
test("persistent broker parses and fixture session protocol passes",{
  skip:python?false:"No Python interpreter on runner"
},()=>{
  const [exe,...args]=python;
  const source=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_session.py",import.meta.url));
  const parse=spawnSync(exe,[...args,"-B","-c",
    "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf8').read())",source],
    {cwd:root,timeout:5000,encoding:"utf8"});
  assert.equal(parse.status,0,parse.stderr);
  const run=spawnSync(exe,[...args,"-B","-m","unittest","discover",
    "-s","integrations/blender-worker","-p","test_shuvi_blender_session.py"],
    {cwd:root,timeout:30000,encoding:"utf8"});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stderr,/Ran 26 tests/);
});

test("persistent Blender predispatch verifies reserved stage source and exact plan before any broker request",()=>{
  assert.ok(native.includes("crate::blender_plan_lineage::reserved_output_policy("));
  assert.ok(native.includes("session.source_checkpoint.as_ref().map(|x|x.canonical_path.as_str())"));
  assert.ok(native.includes("allow_render,true"));
  const guard=native.indexOf("crate::blender_plan_lineage::reserved_output_policy(");
  const dispatch=native.indexOf('request(session,state,"run_plan"');
  assert.ok(guard>0 && dispatch>guard);
});

test("authenticated material render broker evidence is bound to native startup source and exact session before handoff",()=>{
  assert.ok(broker.includes('result["material_render_preflight"] = preflight'));
  assert.ok(broker.includes('"shader_parameters_independently_verified": False'));
  assert.ok(broker.includes('"approval_reauthenticated_by_preflight": False'));
  assert.ok(native.includes('let material_claim=response.get("material_render_preflight")'));
  assert.ok(native.includes('stage==Some("look_render")'));
  assert.ok(native.includes('proof.get("source_scene_revision").and_then(Value::as_str)!=Some(expected_scene_revision)'));
  assert.ok(native.includes('proof.get("source_sha256").and_then(Value::as_str)!=Some(source.sha256.as_str())'));
  assert.ok(native.includes('return Err("Unrelated Blender plan cannot return material-render preflight."'));
});

test("persistent Blender response cannot promote a differently named PNG or BLEND as the expected approved artifact",()=>{
  assert.ok(broker.includes("actual.name != expected_name"));
  assert.ok(broker.includes('final_step.request.payload.get("name")'));
  assert.ok(native.includes("crate::blender_plan_lineage::verify_final_artifact_binding(plan,&response)?"));
});

test("persistent broker checks complete typed step transcript and emits explicit final operation",()=>{
  for(const x of [
    "def require_complete_step_report(plan, report):",
    'set(results) != set(names)',
    'getattr(report, "unexecuted_steps", ())',
    'executed_steps = require_complete_step_report(plan, report)',
    '"final_operation": final_step.request.operation',
    '"executed_steps": executed_steps'
  ])assert.ok(broker.includes(x),x);
  assert.ok(native.includes("verify_final_artifact_binding(plan,&response)?"));
});

test("persistent Blender read-only objects expose bounded material slots, transforms, modifiers and device snapshots",()=>{
  for(const text of [
    "def bounded_object_details(item: dict)",
    "details_available",
    "shader_nodes_inspected",
    "mesh_topology_inspected",
    "material_slot_count",
    "modifier_count",
    'observed = bounded_object_details(item)',
    '"object_id": obj_id, "name": name'
  ]) assert.ok(broker.includes(text),text);
  for(const guard of [
    "fn verified_object_views(items:&[Value],session_id:&str)",
    "verified_object_views(response[\"objects\"].as_array()",
    "Blender detail material/modifier list invalid.",
    "Blender camera optics invalid.",
    "Blender light properties invalid.",
    "mesh_camera_and_light_details_pass_native_read_only_validation",
    "malformed_details_cannot_be_promoted_to_verified_inspection",
    "historic_minimal_or_truncated_readback_never_claims_details"
  ])assert.ok(native.includes(guard),guard);
});
