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
  assert.match(lib,/Persist(?:ent)? Blender plan requires 1\.\.6 typed steps/);
  assert.equal(bundle.bundle.resources[
    "../integrations/blender-worker/shuvi_blender_session.py"
  ],"blender-worker/shuvi_blender_session.py");
});

test("native registry checks real managed PID identity, resource limit and aborts on unknown",()=>{
  for(const text of [
    "register_managed_process(state,pid)",
    "managed_process_identity_matches(state,session.child.id())",
    "current_runtime_status(state)",
    "terminate_managed_process_tree(self.child.id())",
    "retire(state,&mut slot)",
    "recv_timeout(",
    "session_reconnect_allowed",
    "source_action_id",
    "verify_output(&response"
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
    "allow_destructive=False",
    "status\": \"outcome_unknown",
    "\"retry_automatically\": False",
    "capture_scene(controller, actual, require_saved_file=False)",
    "reopen_checkpoint(blender_exe, actual, before)",
    "if request_allow_render and not args.allow_render"
  ]) assert.ok(broker.includes(text),text);
  assert.doesNotMatch(broker,/\beval\(|\bexec\(|subprocess\.run\(|shell=True/);
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
  assert.match(run.stderr,/Ran 10 tests/);
});
