"""No-bpy materialized still preflight: SHA, scene, object and render guards."""
import copy
import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import shuvi_blender_session as broker

SESSION = "4a100cd3-0ab1-4f5e-9e8a-558700000001"
REV = "c" * 64


class Request:
    def __init__(self, operation, payload=None, timeout_ms=10000):
        self.operation, self.payload = operation, payload or {}


class Result:
    def __init__(self, data):
        self.status, self.data = "succeeded", data


class FakeReadOnlyController:
    def __init__(self, saved, *, mutate=None):
        self.calls = []
        self.mutate = mutate
        self.scene = {
            "session_id": SESSION, "revision": REV,
            "file": str(saved), "camera_id": SESSION + ":camera",
        }
        mesh = {
            "object_id": SESSION + ":mesh", "name": "Shuvi41ProofMesh",
            "type": "MESH", "details_truncated": False,
            "materials": ["Shuvi41ProofCopper"], "material_slot_count": 1,
            "visibility": {"hide_render": False},
        }
        camera = {
            "object_id": SESSION + ":camera", "name": "Shuvi41ProofCamera",
            "type": "CAMERA", "details_truncated": False,
            "visibility": {"hide_render": False},
            "transform": {"location": [4, -6, 4], "rotation_euler": [1.15, 0, 0.58],
                          "scale": [1, 1, 1]},
            "camera": {"type": "PERSP", "lens": 50, "clip_start": 0.1, "clip_end": 100},
        }
        lamp = {
            "object_id": SESSION + ":lamp", "name": "Shuvi41ProofKey",
            "type": "LIGHT", "details_truncated": False,
            "visibility": {"hide_render": False},
            "transform": {"location": [2, -3, 5]},
            "light": {"type": "POINT", "energy": 950,
                      "color": [1, 0.94, 0.85]},
        }
        self.objects = {"MESH": mesh, "CAMERA": camera, "LIGHT": lamp}
        self.shader = {
            "material_name": "Shuvi41ProofCopper", "node_count": 2,
            "link_count": 1,
            "nodes": [
                {"name": "Principled BSDF", "type": "BSDF_PRINCIPLED", "image": None},
                {"name": "Material Output", "type": "OUTPUT_MATERIAL", "image": None},
            ],
            "links": [["Principled BSDF", "BSDF", "Material Output", "Surface"]],
            "principled": {"base_color": [0.8, 0.41, 0.16, 1.0],
                          "metallic": 0.65, "roughness": 0.31},
            "auxiliary": {}, "textures": {},
        }
        self.update_shader_revision()

    def update_shader_revision(self):
        import json
        content = {k: v for k, v in self.shader.items() if k != "shader_revision"}
        self.shader["shader_revision"] = hashlib.sha256(json.dumps(
            content, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()).hexdigest()

    def execute(self, request):
        self.calls.append(request.operation)
        if request.operation == "scene.inspect":
            if self.mutate == "late_revision" and self.calls.count("scene.inspect") == 2:
                return Result({**self.scene, "revision": "d" * 64})
            return Result(copy.deepcopy(self.scene))
        if request.operation == "material.shader_inspect":
            if request.payload != {"material_name": "Shuvi41ProofCopper"}:
                raise AssertionError("Only exact named copper shader inspection permitted")
            return Result(copy.deepcopy(self.shader))
        if request.operation == "objects.list":
            obj = self.objects[request.payload["object_type"]]
            if self.mutate == "ambiguous_mesh" and obj["type"] == "MESH":
                return Result({"session_id": SESSION, "revision": REV,
                               "offset": 0, "total": 2, "next_offset": None,
                               "items": [copy.deepcopy(obj)]})
            return Result({"session_id": SESSION, "revision": REV,
                           "offset": 0, "total": 1, "next_offset": None,
                           "items": [copy.deepcopy(obj)]})
        raise AssertionError("preflight MUST be read-only: " + request.operation)


class MaterialRenderPreflightTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / broker.MATERIAL_CHECKPOINT_NAME
        self.path.write_bytes(b"BLENDER-v430" + b"material-proof" * 7)
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.receipt = broker.inspect_input_source(self.path, self.digest)
        self.ctrl = FakeReadOnlyController(self.path)
        contracts = types.ModuleType("shuvi_blender_agent.contracts")
        contracts.Request = Request
        contracts.Status = types.SimpleNamespace(SUCCEEDED="succeeded")
        patches = {
            "shuvi_blender_agent": types.ModuleType("shuvi_blender_agent"),
            "shuvi_blender_agent.contracts": contracts,
        }
        patched = patch.dict(sys.modules, patches)
        patched.start()
        self.addCleanup(patched.stop)

    def proof(self, *, render=True, revision=REV):
        return broker.validate_material_render_source(
            self.ctrl, self.receipt, revision, render
        )

    def test_matching_sha_camera_light_and_copper_material_preflight(self):
        proof = self.proof()
        self.assertTrue(proof["verified"])
        self.assertTrue(proof["read_only_preflight"])
        self.assertEqual(proof["schema_version"], 1)
        self.assertEqual(proof["source_blend_path"], str(self.path))
        self.assertEqual(proof["source_sha256"], self.digest)
        self.assertEqual(proof["source_bytes"], len(self.path.read_bytes()))
        self.assertEqual(proof["session_id"], SESSION)
        self.assertEqual(proof["source_scene_revision"], REV)
        self.assertEqual(proof["material_slot_name"], "Shuvi41ProofCopper")
        self.assertEqual(proof["active_camera_name"], "Shuvi41ProofCamera")
        self.assertEqual(proof["key_light_name"], "Shuvi41ProofKey")
        self.assertTrue(proof["shader_parameters_independently_verified"])
        self.assertTrue(proof["shader_node_graph_revision_verified"])
        self.assertEqual(proof["shader_graph_revision"], self.ctrl.shader["shader_revision"])
        self.assertFalse(proof["render_completed_by_preflight"])
        self.assertFalse(proof["approval_reauthenticated_by_preflight"])
        self.assertEqual(self.ctrl.calls, ["scene.inspect", "objects.list",
                                           "objects.list", "objects.list",
                                           "material.shader_inspect", "scene.inspect"])
        self.assertFalse(any(x in self.ctrl.calls for x in
                             ("render.execute", "render.configure", "material.create_assign")))

    def test_material_preflight_is_not_a_success_or_render_claim(self):
        report = self.proof()
        self.assertNotIn("artifact", report)
        self.assertNotIn("render_sha256", report)
        self.assertNotIn("action_approved", report)
        self.assertFalse(report["render_completed_by_preflight"])
        self.assertFalse(report["approval_reauthenticated_by_preflight"])
        self.assertTrue(report["shader_parameters_independently_verified"])

    def test_saved_copper_shader_wrong_base_color_metallic_roughness_denied(self):
        for key, value in [
            ("base_color", [0.2, 0.4, 0.6, 1.0]),
            ("metallic", 0.1), ("roughness", 0.88),
        ]:
            self.ctrl = FakeReadOnlyController(self.path)
            self.ctrl.shader["principled"][key] = value
            self.ctrl.update_shader_revision()
            with self.subTest(key=key):
                with self.assertRaisesRegex(ValueError, "Saved copper shader values"):
                    self.proof()

    def test_shader_revision_must_match_actual_nodes(self):
        self.ctrl.shader["shader_revision"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "shader revision differs"):
            self.proof()

    def test_copper_shader_fixed_inputs_cannot_be_overridden_by_texture_links(self):
        self.ctrl.shader["links"].append(
            ["Texture", "Color", "Principled BSDF", "Base Color"])
        self.ctrl.shader["link_count"] += 1
        self.ctrl.update_shader_revision()
        with self.assertRaisesRegex(ValueError, "overridden by linked"):
            self.proof()

    def test_missing_principled_shader_node_denied(self):
        self.ctrl.shader["nodes"] = [
            {"name": "Material Output", "type": "OUTPUT_MATERIAL", "image": None}]
        self.ctrl.shader["node_count"] = 1
        self.ctrl.update_shader_revision()
        with self.assertRaisesRegex(ValueError, "one Principled"):
            self.proof()

    def test_copper_principled_must_reach_active_material_output_surface(self):
        # Correct-looking Principled values alone must not validate a
        # material that actually renders through a different shader.
        cases = [
            ("wrong_surface", [["Emission", "Emission", "Material Output", "Surface"]],
             [{"name": "Emission", "type": "EMISSION", "image": None}]),
            ("missing_surface", [], []),
            ("wrong_output", [["Principled BSDF", "BSDF", "Missing", "Surface"]], []),
        ]
        for label, links, extra_nodes in cases:
            self.ctrl = FakeReadOnlyController(self.path)
            self.ctrl.shader["links"] = links
            self.ctrl.shader["nodes"].extend(extra_nodes)
            self.ctrl.shader["link_count"] = len(links)
            self.ctrl.shader["node_count"] = len(self.ctrl.shader["nodes"])
            self.ctrl.update_shader_revision()
            with self.subTest(label=label):
                with self.assertRaisesRegex(ValueError, "Surface|graph edge"):
                    self.proof()

    def test_copper_shader_rejects_duplicate_and_ambiguous_render_edges(self):
        for change in ("duplicate_edge", "duplicate_output", "missing_output"):
            self.ctrl = FakeReadOnlyController(self.path)
            shader = self.ctrl.shader
            if change == "duplicate_edge":
                shader["links"].append(list(shader["links"][0]))
            elif change == "duplicate_output":
                shader["nodes"].append({
                    "name": "Alternative Output", "type": "OUTPUT_MATERIAL",
                    "image": None})
            else:
                shader["nodes"] = [
                    node for node in shader["nodes"]
                    if node["type"] != "OUTPUT_MATERIAL"]
            shader["node_count"] = len(shader["nodes"])
            shader["link_count"] = len(shader["links"])
            self.ctrl.update_shader_revision()
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "node|edge|Surface"):
                    self.proof()

    def test_missing_wrong_or_multiple_material_slots_fail_before_dispatch(self):
        mesh = self.ctrl.objects["MESH"]
        for values, count in [([], 0), (["Unrelated"], 1),
                              (["Shuvi41ProofCopper", "Fake"], 2)]:
            mesh["materials"], mesh["material_slot_count"] = values, count
            with self.subTest(values=values):
                with self.assertRaisesRegex(ValueError, "copper material"):
                    self.proof()

    def test_camera_inactive_and_wrong_lamp_energy_denied(self):
        self.ctrl.scene["camera_id"] = SESSION + ":unused"
        with self.assertRaisesRegex(ValueError, "proof camera"):
            self.proof()
        self.ctrl.scene["camera_id"] = SESSION + ":camera"
        self.ctrl.objects["LIGHT"]["light"]["energy"] = 250
        with self.assertRaisesRegex(ValueError, "key light"):
            self.proof()

    def test_source_checkpoint_missing_wrong_named_and_rewritten_bytes_denied(self):
        with self.assertRaisesRegex(ValueError, "authenticated material checkpoint"):
            broker.validate_material_render_source(self.ctrl, None, REV, True)
        alt = self.path.with_name("not-approved.blend")
        alt.write_bytes(self.path.read_bytes())
        modified_receipt = {**self.receipt, "path": str(alt)}
        with self.assertRaisesRegex(ValueError, "authenticated material checkpoint"):
            broker.validate_material_render_source(self.ctrl, modified_receipt, REV, True)
        self.path.write_bytes(b"BLENDER-v430" + b"tampered proof")
        with self.assertRaisesRegex(ValueError, "differ from approved checkpoint"):
            self.proof()

    def test_stale_revision_ambiguous_page_or_scene_mutation_denied(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            self.proof(revision="d" * 64)
        self.ctrl = FakeReadOnlyController(self.path, mutate="ambiguous_mesh")
        with self.assertRaisesRegex(ValueError, "missing or ambiguous"):
            self.proof()
        self.ctrl = FakeReadOnlyController(self.path, mutate="late_revision")
        with self.assertRaisesRegex(ValueError, "changed during preflight"):
            self.proof()

    def test_no_render_approval_and_malformed_camera_identity_denied(self):
        with self.assertRaisesRegex(ValueError, "explicit rendering approval"):
            self.proof(render=False)
        self.ctrl.scene["camera_id"] = "alien-session:camera"
        with self.assertRaisesRegex(ValueError, "authenticated active camera"):
            self.proof()

    def test_only_exact_optional_render_output_triggers_preflight(self):
        def plan(output):
            return {"steps": [
                {"request": {"operation": "render.execute", "payload": {"name": output}}}
            ]}
        self.assertTrue(broker._is_material_render(plan(broker.MATERIAL_RENDER_NAME)))
        self.assertFalse(broker._is_material_render(plan("shuvi41-proof-render.png")))
        self.assertFalse(broker._is_material_render({"steps": []}))
        self.assertFalse(broker._is_material_render({"steps": [{"request": None}]}))


if __name__ == "__main__":
    unittest.main()
