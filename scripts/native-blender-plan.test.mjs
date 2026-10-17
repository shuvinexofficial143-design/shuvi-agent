import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const py=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const exec=readFileSync(new URL("../src-tauri/src/blender_plan_worker.rs",import.meta.url),"utf8");
const receipt=readFileSync(new URL("../src-tauri/src/blender_artifact_manifest.rs",import.meta.url),"utf8");
const source=readFileSync(new URL("../src-tauri/src/blender_input_checkpoint.rs",import.meta.url),"utf8");
const bundle=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8"));

test("The fixed Blender PlanRunner is bundled, not a provider-supplied Python string",()=>{
  assert.equal(bundle.bundle.resources["../integrations/blender-worker/shuvi_blender_plan.py"],
    "blender-worker/shuvi_blender_plan.py");
  assert.match(py,/from shuvi_blender_agent.plans import Plan, PlanRunner/);
  assert.match(py,/plan = Plan.from_dict\(plan_json\)/);
  assert.match(py,/PlanRunner\(controller\).run\(plan\)/);
  assert.match(exec,/Command::new\(python_exe\)/);
  assert.match(exec,/\.arg\(script\)\.arg\("--python-plan"\)/);
  assert.doesNotMatch(exec,/\.arg\("-c"\)|\.arg\("-m"\)|shell\(/);
});

test("The approved plan has bounded size, steps, deadline and no destructive permission",()=>{
  assert.match(rust,/"blender_run_plan" => \{/);
  assert.match(rust,/ToolAction::BlenderRunPlan/);
  assert.match(rust,/"Run approved verified Blender plan"\.into\(\)/);
  assert.match(rust,/RiskLevel::High/);
  assert.match(rust,/steps\.len\(\)<=6/);
  assert.match(rust,/64\*1024/);
  assert.match(py,/MAX_STEPS = 6/);
  assert.match(py,/plan.timeout_ms > 90_000/);
  assert.match(py,/allow_destructive=False/);
  assert.match(py,/allow_rendering=args.allow_render/);
  assert.match(py,/argparse\.ArgumentParser\(\)/);
  assert.doesNotMatch(py,/\bexec\(|\beval\(|subprocess\.run\(|shell=True/);
});
test("one-shot and persistent Blender paths require the same exact approved source SHA and authenticated loaded path",()=>{
  assert.match(rust,/ToolAction::BlenderRunPlan \{python_exe,blender_exe,blend_file,expected_blend_sha256,output_dir,allow_render,plan\}/);
  assert.match(rust,/blender_input_checkpoint::inspect\(blend_file\.as_deref\(\),expected_blend_sha256\.as_deref\(\)\)/);
  assert.match(exec,/blender_input_checkpoint::inspect\(blend_file,expected_blend_sha256\)\?/);
  assert.match(exec,/blender_input_checkpoint::still_current\(input\)\?/);
  assert.match(exec,/"input_checkpoint":input_proof\.as_ref\(\)/);
  assert.match(py,/inspect_input_source\(args\.blend_file, args\.expected_blend_sha256\)/);
  assert.match(py,/Authenticated one-shot Blender did not open the exact source/);
  assert.match(py,/"input_checkpoint": source_before/);
  assert.match(source,/pub\(crate\) fn still_current\(/);
});

test("The plan must produce an actual verified output, not claim success after partial mutations",()=>{
  for(const expected of ["file.checkpoint","render.execute","Status.VERIFIED","report.completed",
    "read_output(actual", "reread[\"sha256\"] != digest","actual.parent != args.output_dir.resolve"]){
    assert.ok(py.includes(expected),expected);
  }
  for(const token of ["blender_artifact_manifest::build(&value,Path::new(output_dir),action_id,None)?","Sha256::new()",
    "parent!=root.canonicalize()","authenticated_blender_plan","destructive_allowed",
    "render_approved","full_plan_completed"]){
    assert.ok(exec.includes(token),token);
  }
  assert.match(receipt,/verify_output\(output,output_root\)\?/);
  assert.match(receipt,/source_action_id/);
  assert.match(exec,/register_managed_process\(state,pid\)/);
  assert.match(exec,/running_action_children\.lock\(\)/);
  assert.match(exec,/running\.insert\(action_id\.to_string\(\),pid\)/);
  assert.match(exec,/running\.remove\(action_id\)/);
  assert.match(exec,/current_runtime_status\(state\)/);
  assert.match(exec,/hard_limit_triggered/);
  assert.match(exec,/terminate_registered_process_tree\(state,pid\)/);
  assert.match(rust,/&inputs,state,execution_action_id/);
  assert.match(exec,/unregister_managed_process\(state,pid\)/);
  assert.match(exec,/collect_with_deadline\(child,Duration::from_secs\(120\)\)/);
  assert.match(exec,/struct PlanFile\(PathBuf\);/);
  assert.match(exec,/impl Drop for PlanFile/);
});
test("The host never pretends a multi-step plan was completed just because it was dispatched",()=>{
  assert.match(py,/retry_automatically": False/);
  assert.match(py,/status": "outcome_unknown"/);
  assert.match(exec,/inspect before retry/);
  assert.match(rust,/blender_plan_worker::execute\(/);
  assert.doesNotMatch(exec,/unwrap\(\)/);
});


const root=fileURLToPath(new URL("../",import.meta.url));
const candidates=[["python3"],["python"],["py","-3"]];
const python=candidates.find(parts=>{
  const [exe,...args]=parts;
  return spawnSync(exe,[...args,"-c","import ast"],{timeout:5000}).status===0;
});
test("one-off input source checked before launch, authenticated load and post-plan: six Python regressions",{
  skip:python?false:"Python interpreter unavailable on runner"
},()=>{
  const [exe,...args]=python;
  const run=spawnSync(exe,[...args,"-B","-m","unittest","discover",
    "-s","integrations/blender-worker","-p","test_shuvi_blender_plan_input.py"],
    {cwd:root,timeout:30000,encoding:"utf8"});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stderr,/Ran 6 tests/);
});

test("one-off Blender worker refuses reserved material render lacking the persistent scene/material safety preflight",()=>{
  assert.ok(exec.includes("crate::blender_plan_lineage::reserved_output_policy("));
  assert.ok(exec.includes("input_proof.as_ref().map(|x|x.canonical_path.as_str())"));
  assert.ok(exec.includes("allow_render,false"));
});
