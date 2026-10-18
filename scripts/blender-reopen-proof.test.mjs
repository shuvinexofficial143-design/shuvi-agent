import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const plan=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url));
const helper=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_reopen.py",import.meta.url));
const reopenTests=readFileSync(new URL("../integrations/blender-worker/test_shuvi_blender_reopen.py",import.meta.url),"utf8");
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
  assert.match(result.stderr,/Ran 29 tests/);
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
  ]) assert.ok(source.includes(token),token);
});

test("saved meshes reconcile authenticated upstream datablock metadata with fully inspected vertices and polygons",()=>{
  const source=readFileSync(helper,"utf8");
  for (const token of [
    "def _saved_mesh_metadata(item: dict) -> tuple[int, int, int]:",
    'data.get("object_type") != "MESH"',
    'for name in ("vertices", "polygons", "edges"):',
    "metadata_vertices, metadata_faces, _ = _saved_mesh_metadata(item)",
    "len(vertices) != metadata_vertices or len(faces) != metadata_faces",
  ])assert.ok(source.includes(token),token);
});

test("persisted supplementary copper material cannot pass with flattened, collinear or duplicate fake faces",()=>{
  const helperSource=readFileSync(helper,"utf8");
  for(const word of [
    "def _copper_mesh_has_genuine_3d_faces(vertices: list, faces: list) -> bool:",
    "max(values) - min(values) < 0.05",
    "polygon_key = tuple(sorted(face))",
    "normal_area_sq > 1e-10",
    "return nondegenerate >= 5",
    "_copper_mesh_has_genuine_3d_faces(vertices, faces)",
  ])assert.ok(helperSource.includes(word),word);
});

test("saved checkpoint non-object evidence cannot drift during multi-request geometry capture",()=>{
  const source=readFileSync(helper,"utf8");
  for (const token of [
    'for field in (*SCENE_FIELDS, "file", "camera_id", "collections_truncated"):',
    'final_scene.get(field) != scene.get(field)',
    "Blender non-object scene settings changed during checkpoint proof",
  ])assert.ok(source.includes(token),token);
});

test("new saved-scene failure modes have executable Python regression coverage",()=>{
  for(const testName of   [
      "test_paged_saved_scene_checks_cross_page_identity_and_cursor",
      "test_saved_mesh_rejects_repeated_face_indices_even_with_matching_digest",
      "test_saved_mesh_datablock_counts_match_actual_inspected_geometry",
      "test_missing_or_oversized_saved_mesh_metadata_fails_before_mesh_probe",
      "test_persisted_copper_mesh_requires_unique_nondegenerate_3d_faces",
      "test_saved_scene_rejects_nonobject_changes_between_read_only_requests"
  ])assert.ok(reopenTests.includes("def "+testName+"("),testName);
});

test("Blender checkpoint copy is SHA-bound across separate read-only reopen and native byte rehash",()=>{
  const helperSource=readFileSync(helper,"utf8");
  for(const proof of [
    "def _stable_checkpoint_bytes(saved: Path) -> str:",
    "initial_file_sha256 = _stable_checkpoint_bytes(saved)",
    "reopened_file_sha256 = _stable_checkpoint_bytes(saved)",
    "reopened_file_sha256 != initial_file_sha256",
    '"checkpoint_file_sha256": reopened_file_sha256',
    '"checkpoint_bytes_stable_during_reopen": True',
    "test_saved_checkpoint_modified_during_read_only_reopen_fails_closed"
  ])assert.ok((helperSource+"\n"+reopenTests).includes(proof),proof);
  for(const proof of [
    'proof.get("checkpoint_bytes_stable_during_reopen").and_then(Value::as_bool)!=Some(true)',
    'proof.get("checkpoint_file_sha256").and_then(Value::as_str)!=Some(expected)'
  ])assert.ok(rust.includes(proof),proof);
});

test("fixed Stage-1 and Stage-2 .blend saves require actual typed pyramid geometry after reopen",()=>{
  const source=readFileSync(helper,"utf8");
  for(const item of [
    '"shuvi41-proof-stage1.blend": 1.45',
    '"shuvi41-proof-stage2.blend": 1.95',
    "def _fixed_stage_geometry_matches(vertices: list, faces: list, name: str)",
    "fixed_stage_geometry_matches += 1",
    '"fixed_stage_geometry_verified": (',
    "original.get(\"fixed_stage_geometry_verified\") is not True",
    '"fixed_stage_geometry_verified": reopened["fixed_stage_geometry_verified"]'
  ])assert.ok(source.includes(item),item);
  assert.ok(reopenTests.includes("def test_stage_one_and_two_pyramids_reopen_from_expected_typed_geometry("));
  assert.ok(reopenTests.includes("def test_nonreserved_user_blend_not_restricted_to_fixed_pyramid("));
  assert.ok(rust.includes('proof.get("fixed_stage_geometry_verified")'));
});
