import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const py=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const exec=readFileSync(new URL("../src-tauri/src/blender_plan_worker.rs",import.meta.url),"utf8");
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
test("The plan must produce an actual verified output, not claim success after partial mutations",()=>{
  for(const expected of ["file.checkpoint","render.execute","Status.VERIFIED","report.completed",
    "read_output(actual", "reread[\"sha256\"] != digest","actual.parent != args.output_dir.resolve"]){
    assert.ok(py.includes(expected),expected);
  }
  for(const token of ["verify_output(&value,Path::new(output_dir))?","Sha256::new()",
    "parent!=root.canonicalize()","authenticated_blender_plan","destructive_allowed",
    "render_approved","full_plan_completed"]){
    assert.ok(exec.includes(token),token);
  }
  assert.match(exec,/register_managed_process\(state,pid\)/);
  assert.match(exec,/running_action_children\.lock\(\)/);
  assert.match(exec,/running\.insert\(action_id\.to_string\(\),pid\)/);
  assert.match(exec,/running\.remove\(action_id\)/);
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
