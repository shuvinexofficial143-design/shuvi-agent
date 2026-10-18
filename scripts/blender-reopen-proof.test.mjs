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
  assert.match(check,/active_camera_name/);
  assert.match(check,/proof_camera_verified/);
  assert.match(check,/proof_key_light_verified/);
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
  assert.match(result.stderr,/Ran 21 tests/);
});

test("independent material look reopen proves one persisted copper slot with active camera/light, not shader nodes",()=>{
  const helperSource=readFileSync(helper,"utf8");
  for(const evidence of [
    "proof_copper_material_verified_count",
    "proof_copper_meshes_seen == 1",
    'item["materials"] == ["Shuvi41ProofCopper"]',
    'item["material_slot_count"] == 1',
    'saved.name == "shuvi41-proof-material.blend"',
    'reopened.get("proof_copper_material_verified") is not True',
    '"proof_copper_shader_verified": proof_copper_shader_verified',
  ])assert.ok(helperSource.includes(evidence),evidence);
  assert.ok(rust.includes('proof.get("proof_copper_material_verified")'));
  assert.ok(rust.includes('proof.get("shader_parameters_independently_verified")'));
});

test("saved supplementary copper look now requires typed shader graph inspection in both writer and read-only reopen",()=>{
  const source=readFileSync(helper,"utf8");
  for(const snippet of [
    'call("material.shader_inspect", {',
    'verify_shuvi41_copper_shader(observed_shader)',
    'proof_copper_shader_revision = verify_shuvi41_copper_shader(observed_shader)',
    'reopened.get("proof_copper_shader_verified") is not True',
    'reopened.get("proof_copper_shader_revision") !=',
    '"shader_parameters_independently_verified":',
    '"proof_copper_shader_revision": reopened["proof_copper_shader_revision"]'
  ])assert.ok(source.includes(snippet),snippet);
});

test("independent saved scene reopen checks every object across exact typed pages and the live scene census",()=>{
  const source=readFileSync(helper,"utf8");
  for(const token of [
    "def _reopen_page_items(page: dict, *, session_id: str, revision: str,",
    "expected = min(PAGE_SIZE, max(0, total - offset))",
    "expected_next = offset + PAGE_SIZE if offset + PAGE_SIZE < total else None",
    "identity in seen_ids or identity in current_ids",
    "name in seen_names or name in current_names",
    "object_counts_by_type",
    "expected_type_counts",
    "observed_type_counts",
    "total_face_indices > MAX_REOPEN_TOTAL_FACE_INDICES",
    "Blender mesh polygon contains a repeated index",
    "test_paged_saved_scene_checks_cross_page_identity_and_cursor",
    "test_saved_mesh_rejects_repeated_face_indices_even_with_matching_digest"
  ]) assert.ok(source.includes(token),token);
});
