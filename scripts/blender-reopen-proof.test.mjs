import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const plan=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url));
const helper=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_reopen.py",import.meta.url));
const rust=readFileSync(new URL("../src-tauri/src/blender_plan_worker.rs",import.meta.url),"utf8");
const bundle=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8"));

test("saved Blender checkpoint requires independent read-only reopen evidence",()=>{
  const py=readFileSync(plan,"utf8");
  const check=readFileSync(helper,"utf8");
  assert.match(py,/original_scene = capture_scene\(controller, actual, require_saved_file=False\)/);
  assert.match(py,/checkpoint_reopen = reopen_checkpoint\(args\.blender_exe, actual, original_scene\)/);
  assert.match(py,/reread = read_output\(actual, "BLEND"\)/);
  assert.match(py,/"checkpoint_reopen": checkpoint_reopen/);
  assert.match(check,/policy=SafetyPolicy\(\)/);
  assert.match(check,/blend_file=saved/);
  assert.match(check,/if reopened != original:/);
  assert.match(check,/call\("mesh.inspect", \{"object_id": object_id\}\)/);
  assert.match(check,/digest != geometry.get\("geometry_revision"\)/);
  assert.match(check,/mesh_fingerprint/);
  assert.match(rust,/proof.get\("mesh_fingerprint"\)/);
  assert.match(check,/scene changed during geometry proof/);
  assert.match(rust,/proof.get\("mesh_geometry_verified"\)/);
  assert.match(check,/require_saved_file and Path\(scene\["file"\]\)\.resolve/);
  assert.equal(bundle.bundle.resources["../integrations/blender-worker/shuvi_blender_reopen.py"],
    "blender-worker/shuvi_blender_reopen.py");
  assert.match(rust,/checkpoint_reopen/);
  assert.match(rust,/proof\.get\("read_only"\)/);
  assert.match(rust,/proof\.get\("verified"\)/);
  assert.match(rust,/"source_action_id":action_id/);
  assert.match(rust,/Blender PNG receipt lacks validated dimensions/);
});

const interpreters=[["python3"],["python"],["py","-3"]];
const python=interpreters.find(parts=>{
  const [executable,...args]=parts;
  return spawnSync(executable,[...args,"-c","import ast"],{timeout:5000}).status===0;
});
test("new Python reopen helper parses and fake-session regressions pass",
  {skip:python?false:"Python not installed on CI"},()=>{
  const [binary,...args]=python;
  const parse=spawnSync(binary,[...args,"-c",
    "import ast,sys; [ast.parse(open(p, encoding='utf8').read()) for p in sys.argv[1:]]",
    plan,helper],{cwd:root,timeout:5000,encoding:"utf8"});
  assert.equal(parse.status,0,parse.stderr);
  const result=spawnSync(binary,[...args,"-B","-m","unittest","discover",
    "-s","integrations/blender-worker","-p","test_shuvi_blender_reopen.py"],
    {cwd:root,timeout:30000,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stderr,/Ran 10 tests/);
});
