import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const py=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_acceptance.py",import.meta.url));
const source=readFileSync(py,"utf8");
const broker=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_session.py",import.meta.url),"utf8");

test("model acceptance has a fixed typed workflow without any unsafe Blender launch",()=>{
  for(const op of ["mesh.create","mesh.inspect","mesh.translate_vertices",
    "objects.list","scene.inspect","file.checkpoint","render.configure","render.execute"]){
    assert.ok(source.includes('"'+op+'"'),op);
  }
  for(const label of ["_model1","_model2","_render","source_step","source_path",
    "target_path","expected_scene_revision","PLAN_ONLY_NO_BLENDER_LAUNCH",
    "requires_separate_native_owner_approval","render_action_approval_required"]){
    assert.ok(source.includes(label),label);
  }
  assert.match(broker,/current\.data\.get\("revision"\) != expected_scene_revision/);
  assert.doesNotMatch(source,/\bimport bpy\b|\bfrom bpy\b|\bsubprocess\b|\bexec\(|\beval\(|\blaunch\(/);
});

const candidates=[["python3"],["python"],["py","-3"]];
const python=candidates.find(parts=>{
  const [exe,...args]=parts;
  return spawnSync(exe,[...args,"-c","import ast"],{timeout:5000}).status===0;
});
test("python acceptance scenario is executable in plan-only mode and 11 fixtures pass",{
  skip:python?false:"No Python interpreter on test runner",
},()=>{
  const [exe,...args]=python;
  const compile=spawnSync(exe,[...args,"-B","-c",
    "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf8').read())",py],
    {cwd:root,timeout:5000,encoding:"utf8"});
  assert.equal(compile.status,0,compile.stderr);
  const regressions=spawnSync(exe,[...args,"-B","-m","unittest","discover",
    "-s","integrations/blender-worker","-p","test_shuvi_blender_acceptance.py"],
    {cwd:root,timeout:30000,encoding:"utf8"});
  assert.equal(regressions.status,0,regressions.stderr);
  assert.match(regressions.stderr,/Ran 11 tests/);
  const result=spawnSync(exe,[...args,"-B",py,"--stage","render",
    "--scene-revision","a".repeat(64)],{cwd:root,timeout:5000,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(result.stdout);
  assert.equal(plan.mode,"PLAN_ONLY_NO_BLENDER_LAUNCH");
  assert.equal(plan.render_action_approval_required,true);
  assert.equal(plan.plan.steps.at(-1).request.operation,"render.execute");
});
