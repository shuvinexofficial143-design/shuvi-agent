"""Fixture-level checks for reopen manifest fail-closed behavior; no Blender needed."""
import copy
import hashlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from shuvi_blender_reopen import (capture_scene, reopen_checkpoint,
    _stable_checkpoint_bytes, _fixed_stage_geometry_matches,
    _fixed_motion_keyframes_match)
from shuvi_blender_session import verify_in_session_stage1


class Request:
    def __init__(self, operation, payload=None, timeout_ms=10_000):
        self.operation, self.payload = operation, payload or {}


class DummyResult:
    def __init__(self, data, status="succeeded"):
        self.data, self.status = data, status


def fixture(saved, *, session="session-A", name="Cube"):
    scene = dict(
        file=str(saved), session_id=session, revision="a" * 64,
        scene="Scene", blender_version=[4, 3, 0], cursor=[0, 0, 0],
        units={"system": "METRIC"}, pivot="MEDIAN_POINT", world_present=True,
        object_count=1, object_counts_by_type={"MESH": 1}, collection_count=1,
        collections=[{"name": "Collection", "object_count": 1, "child_count": 0}],
        collections_truncated=False, frames={"start": 1, "end": 250, "current": 1},
        render={"engine": "BLENDER_EEVEE_NEXT", "resolution_x": 64},
    )
    obj = dict(
        name=name, type="MESH", transform={"location": [1, 2, 3]},
        dimensions=[2, 2, 2], visibility={"hide_render": False},
        collections=["Collection"], materials=["Blue"], material_slot_count=1,
        modifiers=[], modifier_count=0, details_truncated=False,
        data={"object_type": "MESH", "vertices": 3, "polygons": 1, "edges": 3},
        object_id=session+":object-1", revision="f" * 64,
        animation={"has_animation_data": False, "action": None,
                   "channels": [], "details_truncated": False},
    )
    return scene, obj


class FakeController:
    def __init__(self, saved, *, session="session-A", name="Cube", bad_page=False,
                 vertex_shift=0.0, flip_after_geometry=False):
        self.scene, self.obj = fixture(saved, session=session, name=name)
        self.bad_page = bad_page
        self.vertex_shift = vertex_shift
        self.flip_after_geometry = flip_after_geometry
        self.geometry_read = False

    def execute(self, request):
        if request.operation == "scene.inspect":
            if self.flip_after_geometry and self.geometry_read:
                return DummyResult({**self.scene, "revision": "f" * 64})
            return DummyResult(self.scene)
        if request.operation == "mesh.inspect":
            self.geometry_read = True
            if request.payload.get("object_id") != self.obj["object_id"]:
                raise AssertionError("wrong mesh target")
            geometry = {"vertices": [[0.0 + self.vertex_shift, 0.0, 0.0],
                                     [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                        "faces": [[0, 1, 2]]}
            fingerprint = hashlib.sha256(json.dumps(
                geometry, sort_keys=True, separators=(",", ":"), allow_nan=False
            ).encode()).hexdigest()
            return DummyResult({**geometry, "geometry_revision": fingerprint,
                                "object_id": self.obj["object_id"],
                                "name": self.obj["name"]})
        if request.operation == "objects.list":
            if self.bad_page:
                return DummyResult({"session_id": "unexpected", "revision": "a" * 64,
                                    "total": 1, "offset": 0, "items": [self.obj], "next_offset": None})
            return DummyResult({"session_id": self.scene["session_id"],
                                "revision": self.scene["revision"],
                                "total": 1, "offset": 0,
                                "items": [self.obj], "next_offset": None})
        raise AssertionError(request.operation)



class ProofController(FakeController):
    """Bounded synthetic 3-object scene; no bpy, GUI or Blender process."""

    def __init__(self, saved, *, session="session-A", active=True, energy=950.0):
        super().__init__(saved, session=session)
        self.scene["object_count"] = 3
        self.scene["object_counts_by_type"] = {"MESH": 1, "CAMERA": 1, "LIGHT": 1}
        self.scene["collections"][0]["object_count"] = 3
        self.camera = {
            **self.obj, "name": "Shuvi41ProofCamera", "type": "CAMERA",
            "object_id": session + ":camera", "materials": [],
            "transform": {
                "location": [4.0, -6.0, 4.0], "rotation_euler": [1.15, 0.0, 0.58],
                "scale": [1.0, 1.0, 1.0],
            },
            "camera": {"type": "PERSP", "lens": 50.0, "clip_start": 0.1, "clip_end": 100.0},
            "visibility": {"hide_render": False},
        }
        self.light = {
            **self.obj, "name": "Shuvi41ProofKey", "type": "LIGHT",
            "object_id": session + ":light", "materials": [],
            "transform": {"location": [2.0, -3.0, 5.0]},
            "light": {"type": "POINT", "energy": energy, "color": [1.0, 0.94, 0.85]},
            "visibility": {"hide_render": False},
        }
        self.scene["camera_id"] = self.camera["object_id"] if active else None

    def execute(self, request):
        if request.operation == "objects.list":
            return DummyResult({
                "session_id": self.scene["session_id"], "revision": self.scene["revision"],
                "total": 3, "offset": 0, "items": [self.obj, self.camera, self.light],
                "next_offset": None,
            })
        return super().execute(request)


def copper_shader_snapshot(*, metallic=0.65, roughness=0.31,
                           base_color=None):
    if base_color is None:
        base_color = [0.8, 0.41, 0.16, 1.0]
    snap = {
        "material_name": "Shuvi41ProofCopper", "node_count": 2,
        "link_count": 1,
        "nodes": [
            {"name": "Material Output", "type": "OUTPUT_MATERIAL", "image": None},
            {"name": "Principled BSDF", "type": "BSDF_PRINCIPLED", "image": None},
        ],
        "links": [["Principled BSDF", "BSDF", "Material Output", "Surface"]],
        "principled": {"base_color": base_color, "metallic": metallic,
                      "roughness": roughness},
        "auxiliary": {}, "textures": {},
    }
    snap["shader_revision"] = hashlib.sha256(json.dumps(
        snap, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()).hexdigest()
    return snap


class CopperProofController(ProofController):
    """Material-look fixed mesh with real bounded paged geometry readback."""
    def __init__(self, saved, *, session="session-A", material="Shuvi41ProofCopper",
                 slots=1, hidden=False, energy=950.0, metallic=0.65):
        super().__init__(saved, session=session, energy=energy)
        self.obj["name"] = "Shuvi41ProofMesh"
        self.obj["materials"] = [material] if slots == 1 else [material, "ExtraSlot"]
        self.obj["material_slot_count"] = slots
        self.obj["data"] = {"object_type": "MESH", "vertices": 8,
                            "polygons": 6, "edges": 12}
        self.obj["visibility"] = {"hide_render": hidden}
        self.metallic = metallic

    def execute(self, request):
        if request.operation == "material.shader_inspect":
            if request.payload != {"material_name": "Shuvi41ProofCopper"}:
                raise AssertionError("Reopen requested unexpected material")
            return DummyResult(copper_shader_snapshot(metallic=self.metallic))
        if request.operation == "mesh.inspect":
            self.geometry_read = True
            vertices = [
                [0., 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.],
                [0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.],
            ]
            faces = [
                [0, 1, 2], [0, 2, 3], [4, 5, 6],
                [4, 6, 7], [0, 1, 5], [0, 5, 4],
            ]
            payload = {"vertices": vertices, "faces": faces}
            return DummyResult({
                **payload,
                "geometry_revision": hashlib.sha256(json.dumps(
                    payload, sort_keys=True, separators=(",", ":"), allow_nan=False
                ).encode()).hexdigest(),
                "object_id": self.obj["object_id"], "name": self.obj["name"],
            })
        return super().execute(request)


class ReopenTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / "scene.blend"
        self.file.write_bytes(b"BLENDER-v430")
        contracts = types.ModuleType("shuvi_blender_agent.contracts")
        contracts.Request = Request
        contracts.Status = types.SimpleNamespace(SUCCEEDED="succeeded")
        self.patch_contracts = patch.dict(sys.modules, {
            "shuvi_blender_agent": types.ModuleType("shuvi_blender_agent"),
            "shuvi_blender_agent.contracts": contracts,
        })
        self.patch_contracts.start()
        self.addCleanup(self.patch_contracts.stop)


    def test_material_look_independently_observes_single_copper_slot_across_sessions(self):
        material = self.file.with_name("shuvi41-proof-material.blend")
        material.write_bytes(b"BLENDER-v430")
        writer = capture_scene(CopperProofController(material), material)
        reader = capture_scene(CopperProofController(material, session="session-B"), material)
        self.assertEqual(writer, reader)
        self.assertTrue(writer["proof_copper_material_verified"])
        self.assertTrue(writer["proof_copper_shader_verified"])
        self.assertEqual(writer["proof_copper_shader_revision"],
                         copper_shader_snapshot()["shader_revision"])
        self.assertEqual(writer["mesh_count"], 1)
        self.assertEqual(writer["total_vertices"], 8)
        self.assertEqual(writer["total_faces"], 6)
        self.assertTrue(writer["proof_camera_verified"])
        self.assertTrue(writer["proof_key_light_verified"])

    def test_persisted_copper_mesh_requires_unique_nondegenerate_3d_faces(self):
        material = self.file.with_name("shuvi41-proof-material.blend")
        material.write_bytes(b"BLENDER-v430")
        good = capture_scene(CopperProofController(material), material)
        self.assertTrue(good["proof_copper_material_verified"])

        class GeometryTamper(CopperProofController):
            def __init__(self, saved, case):
                super().__init__(saved)
                self.case = case
            def execute(self, request):
                result = super().execute(request)
                if request.operation == "mesh.inspect":
                    vertices = result.data["vertices"]
                    faces = result.data["faces"]
                    if self.case == "flat":
                        for point in vertices:
                            point[2] = 0.0
                    elif self.case == "collinear":
                        for i, point in enumerate(vertices):
                            point[:] = [float(i), 0.0, 0.0]
                    elif self.case == "duplicate_polygons":
                        faces[:] = [list(faces[0]) for _ in faces]
                    changed = {"vertices": vertices, "faces": faces}
                    result.data["geometry_revision"] = hashlib.sha256(
                        json.dumps(changed, sort_keys=True, separators=(",", ":"),
                                   allow_nan=False).encode()).hexdigest()
                return result
        for case in ("flat", "collinear", "duplicate_polygons"):
            with self.subTest(case=case):
                bad = capture_scene(GeometryTamper(material, case), material)
                self.assertFalse(bad["proof_copper_material_verified"])
                self.assertFalse(bad["proof_copper_shader_verified"])
                self.assertIsNone(bad["proof_copper_shader_revision"])

    def test_copper_slot_missing_ambiguous_hidden_or_wrong_material_fails_proof(self):
        material = self.file.with_name("shuvi41-proof-material.blend")
        material.write_bytes(b"BLENDER-v430")
        for params in [
            {"material": "Unrelated"},
            {"slots": 2},
            {"hidden": True},
        ]:
            with self.subTest(params=params):
                evidence = capture_scene(CopperProofController(material, **params), material)
                self.assertFalse(evidence["proof_copper_material_verified"])
        # Ordinary three-stage scenes are not retroactively forced to have
        # the supplementary copper-look proof.
        ordinary = capture_scene(ProofController(self.file), self.file)
        self.assertFalse(ordinary["proof_copper_material_verified"])

    def test_material_checkpoint_requires_new_read_only_process_with_copper(self):
        material = self.file.with_name("shuvi41-proof-material.blend")
        material.write_bytes(b"BLENDER-v430")
        original = capture_scene(CopperProofController(material), material)
        fake = {
            "shuvi_blender_agent.process": types.ModuleType("shuvi_blender_agent.process"),
            "shuvi_blender_agent.safety": types.ModuleType("shuvi_blender_agent.safety"),
            "shuvi_blender_agent.client": types.ModuleType("shuvi_blender_agent.client"),
        }
        calls = []
        class SafetyPolicy:
            def __init__(self):
                self.allow_mutations = False
                self.allow_file_writes = False
        class LaunchConfig:
            def __init__(self, **kwargs):
                calls.append(kwargs)
        class Session:
            client = "read-only-stub"
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
        class Provider:
            options = {}
            def __call__(self, _):
                return CopperProofController(material, session="session-B", **self.options)
        provider = Provider()
        fake["shuvi_blender_agent.process"].LaunchConfig = LaunchConfig
        fake["shuvi_blender_agent.process"].launch = lambda _cfg: Session()
        fake["shuvi_blender_agent.safety"].SafetyPolicy = SafetyPolicy
        fake["shuvi_blender_agent.client"].BlenderController = provider
        with patch.dict(sys.modules, fake):
            proof = reopen_checkpoint(Path("/dummy/blender"), material, original)
            self.assertTrue(proof["proof_copper_material_verified"])
            self.assertTrue(proof["checkpoint_bytes_stable_during_reopen"])
            self.assertEqual(proof["checkpoint_file_sha256"],
                             hashlib.sha256(material.read_bytes()).hexdigest())
            self.assertTrue(proof["shader_parameters_independently_verified"])
            self.assertEqual(proof["proof_copper_shader_revision"],
                             copper_shader_snapshot()["shader_revision"])
            self.assertTrue(proof["read_only"])
            self.assertFalse(calls[0]["policy"].allow_mutations)
            for options in ({"material": "Wrong"}, {"slots": 2}, {"hidden": True},
                            {"energy": 250.0}, {"metallic": 0.35}):
                provider.options = options
                with self.subTest(options=options):
                    with self.assertRaisesRegex(ValueError, "differs|copper material/look|Saved copper shader values"):
                        reopen_checkpoint(Path("/dummy/blender"), material, original)
            provider.options = {"material": "Wrong"}
            unverified_original = capture_scene(
                CopperProofController(material, material="Wrong"), material)
            with self.assertRaisesRegex(ValueError, "copper material/look"):
                reopen_checkpoint(Path("/dummy/blender"), material, unverified_original)

    def test_stage_one_and_two_pyramids_reopen_from_expected_typed_geometry(self):
        base_vertices = [
            [-1., -1., 0.], [1., -1., 0.], [1., 1., 0.],
            [-1., 1., 0.], [0., 0., 1.45]]
        faces = [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4],
                 [2, 3, 4], [3, 0, 4]]

        class SavedStage(ProofController):
            def __init__(self, saved, *, apex, bad=False):
                super().__init__(saved)
                self.obj["name"] = "Shuvi41ProofMesh"
                self.obj["data"] = {"object_type": "MESH", "vertices": 5,
                                    "polygons": 5, "edges": 8}
                self.apex = apex - 0.10 if bad else apex
            def execute(self, request):
                if request.operation == "mesh.inspect":
                    verts = copy.deepcopy(base_vertices)
                    verts[4][2] = self.apex
                    geometry = {"vertices": verts, "faces": faces}
                    digest = hashlib.sha256(json.dumps(
                        geometry, sort_keys=True, separators=(",", ":"),
                        allow_nan=False).encode()).hexdigest()
                    return DummyResult({
                        **geometry, "geometry_revision": digest,
                        "object_id": self.obj["object_id"],
                        "name": "Shuvi41ProofMesh"})
                return super().execute(request)

        for stage, apex in [("shuvi41-proof-stage1.blend", 1.45),
                            ("shuvi41-proof-stage2.blend", 1.95)]:
            output = self.file.with_name(stage)
            output.write_bytes(b"BLENDER-v430")
            proven = capture_scene(SavedStage(output, apex=apex), output)
            self.assertTrue(proven["fixed_stage_geometry_verified"])
            self.assertEqual(proven["fixed_stage_name"], stage)
            wrong = capture_scene(SavedStage(output, apex=apex, bad=True), output)
            self.assertFalse(wrong["fixed_stage_geometry_verified"])
        # Reversing winding is not a cyclic permutation of a polygon.
        self.assertTrue(_fixed_stage_geometry_matches(
            base_vertices, [faces[3], faces[0], faces[4], faces[2], faces[1]],
            "shuvi41-proof-stage1.blend"))
        self.assertFalse(_fixed_stage_geometry_matches(
            base_vertices, [[0, 1, 2, 3]] + faces[1:],
            "shuvi41-proof-stage1.blend"))

    def test_nonreserved_user_blend_not_restricted_to_fixed_pyramid(self):
        ordinary = capture_scene(FakeController(self.file), self.file)
        self.assertIsNone(ordinary["fixed_stage_name"])
        self.assertFalse(ordinary["fixed_stage_geometry_verified"])

    def test_stage2_live_preflight_correlates_previous_bytes_shape_and_revision(self):
        path = self.file.with_name("shuvi41-proof-stage1.blend")
        path.write_bytes(b"BLENDER-v430")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        receipt = {
            "artifact": {"path": str(path), "sha256": digest,
                         "bytes": path.stat().st_size},
            "checkpoint_reopen": {
                "verified": True, "fingerprint": "f" * 64,
                "fixed_stage_name": "shuvi41-proof-stage1.blend",
                "fixed_stage_geometry_verified": True,
                "checkpoint_file_sha256": digest,
            }
        }
        live = {
            "fingerprint": "f" * 64,
            "fixed_stage_name": "shuvi41-proof-stage1.blend",
            "fixed_stage_geometry_verified": True,
            "proof_camera_verified": True,
            "active_camera_name": "Shuvi41ProofCamera",
        }
        checked = {"sha256": digest, "bytes": path.stat().st_size}
        real_files = types.ModuleType("shuvi_blender_agent.files")
        real_files.read_output = lambda *_: checked
        with (patch.dict(sys.modules, {"shuvi_blender_agent.files": real_files}),
                patch("shuvi_blender_reopen.capture_scene", return_value=live)):
            good = verify_in_session_stage1(FakeController(self.file), receipt, "a" * 64)
            self.assertTrue(good["verified"])
            self.assertEqual(good["source_sha256"], digest)
            self.assertEqual(good["source_scene_revision"], "a" * 64)
            self.assertEqual(good["source_scene_fingerprint"], "f" * 64)
            self.assertEqual(good["source_stage"], "model1")
            for bad in [
                {**receipt, "checkpoint_reopen": {
                    **receipt["checkpoint_reopen"], "fixed_stage_geometry_verified": False}},
                {**receipt, "artifact": {**receipt["artifact"], "sha256": "0" * 64}},
                {**receipt, "artifact": {**receipt["artifact"], "path": str(self.file)}},
            ]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    verify_in_session_stage1(FakeController(self.file), bad, "a" * 64)
            with patch("shuvi_blender_reopen.capture_scene",
                       return_value={**live, "fingerprint": "0" * 64}):
                with self.assertRaisesRegex(ValueError, "Live Stage 1"):
                    verify_in_session_stage1(FakeController(self.file), receipt, "a" * 64)
            with patch("shuvi_blender_reopen.capture_scene",
                       return_value={**live, "fixed_stage_geometry_verified": False}):
                with self.assertRaisesRegex(ValueError, "Live Stage 1"):
                    verify_in_session_stage1(FakeController(self.file), receipt, "a" * 64)

    def test_stage2_dependency_rejects_changed_checkpoint_and_scene_revision(self):
        path = self.file.with_name("shuvi41-proof-stage1.blend")
        path.write_bytes(b"BLENDER-v430")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        receipt = {
            "artifact": {"path": str(path), "sha256": digest,
                         "bytes": path.stat().st_size},
            "checkpoint_reopen": {
                "verified": True, "fingerprint": "f" * 64,
                "fixed_stage_name": "shuvi41-proof-stage1.blend",
                "fixed_stage_geometry_verified": True,
                "checkpoint_file_sha256": digest,
            }
        }
        live = {"fingerprint": "f" * 64,
                "fixed_stage_name": "shuvi41-proof-stage1.blend",
                "fixed_stage_geometry_verified": True,
                "proof_camera_verified": True,
                "active_camera_name": "Shuvi41ProofCamera"}
        checked = {"sha256": digest, "bytes": path.stat().st_size}
        real_files = types.ModuleType("shuvi_blender_agent.files")
        real_files.read_output = lambda *_: checked
        with (patch.dict(sys.modules, {"shuvi_blender_agent.files": real_files}),
                patch("shuvi_blender_reopen.capture_scene", return_value=live)):
            with self.assertRaisesRegex(ValueError, "Scene revision changed"):
                verify_in_session_stage1(FakeController(self.file), receipt, "0" * 64)
        changed={"sha256":"0"*64,"bytes":path.stat().st_size}
        real_files.read_output = lambda *_: changed
        with patch.dict(sys.modules, {"shuvi_blender_agent.files": real_files}):
            with self.assertRaisesRegex(ValueError, "checkpoint bytes changed"):
                verify_in_session_stage1(FakeController(self.file), receipt, "a" * 64)

    def test_checkpoint_hash_requires_real_regular_bounded_blend_bytes(self):
        self.assertEqual(_stable_checkpoint_bytes(self.file),
                         hashlib.sha256(self.file.read_bytes()).hexdigest())
        changed = self.file.with_name("invalid.blend")
        changed.write_bytes(b"incorrect content")
        with self.assertRaisesRegex(ValueError, "header"):
            _stable_checkpoint_bytes(changed)
        changed.write_bytes(b"BLENDER-v430")
        self.assertEqual(_stable_checkpoint_bytes(changed),
                         hashlib.sha256(changed.read_bytes()).hexdigest())
        changed.write_bytes(b"BLEND")
        with self.assertRaisesRegex(ValueError, "size"):
            _stable_checkpoint_bytes(changed)
        changed.unlink()
        try:
            changed.symlink_to(self.file)
        except (OSError, NotImplementedError):
            pass  # Windows fixture host may not permit creating symlinks.
        else:
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                _stable_checkpoint_bytes(changed)

    def test_saved_checkpoint_modified_during_read_only_reopen_fails_closed(self):
        # A second process can load the first bytes and exit normally while
        # another actor has replaced the checkpoint on disk.
        original = capture_scene(FakeController(self.file), self.file)
        process = types.ModuleType("shuvi_blender_agent.process")
        safety = types.ModuleType("shuvi_blender_agent.safety")
        client = types.ModuleType("shuvi_blender_agent.client")
        class SafetyPolicy:
            allow_mutations = False
            allow_file_writes = False
        class LaunchConfig:
            def __init__(self, **kwargs):
                self.policy = kwargs["policy"]
        class Session:
            client = "read-only"
            def __enter__(self):
                return self
            def __exit__(self, *_):
                self_file = self_file_path
                self_file.write_bytes(b"BLENDER-v430modified-between-processes")
                return None
        self_file_path = self.file
        process.LaunchConfig = LaunchConfig
        process.launch = lambda config: Session()
        safety.SafetyPolicy = SafetyPolicy
        client.BlenderController = lambda _transport: FakeController(
            self.file, session="session-B")
        with patch.dict(sys.modules, {
            "shuvi_blender_agent.process": process,
            "shuvi_blender_agent.safety": safety,
            "shuvi_blender_agent.client": client
        }):
            with self.assertRaisesRegex(ValueError, "bytes changed while reopening"):
                reopen_checkpoint(Path("/dummy/blender"), self.file, original)

    def test_shaded_copper_checkpoint_rejects_tampered_principled_values(self):
        material = self.file.with_name("shuvi41-proof-material.blend")
        material.write_bytes(b"BLENDER-v430")
        original = capture_scene(CopperProofController(material), material)
        self.assertTrue(original["proof_copper_shader_verified"])
        for value in (0.35, 0.55, 0.0):
            with self.subTest(metallic=value):
                with self.assertRaisesRegex(ValueError, "Saved copper shader"):
                    capture_scene(CopperProofController(material, metallic=value), material)
        self.assertFalse(capture_scene(ProofController(self.file), self.file)[
            "proof_copper_shader_verified"])

    def test_real_shape_camera_light_claims_survive_fresh_session(self):
        writer = capture_scene(ProofController(self.file), self.file)
        reader = capture_scene(ProofController(self.file, session="session-B"), self.file)
        self.assertEqual(writer, reader)
        self.assertEqual(writer["active_camera_name"], "Shuvi41ProofCamera")
        self.assertTrue(writer["proof_camera_verified"])
        self.assertTrue(writer["proof_key_light_verified"])
        self.assertEqual(writer["mesh_count"], 1)

    def test_inactive_or_wrong_camera_and_light_are_not_verified(self):
        good = capture_scene(ProofController(self.file), self.file)
        inactive = capture_scene(ProofController(self.file, active=False), self.file)
        wrong_lamp = capture_scene(ProofController(self.file, energy=600.0), self.file)
        self.assertFalse(inactive["proof_camera_verified"])
        self.assertIsNone(inactive["active_camera_name"])
        self.assertFalse(wrong_lamp["proof_key_light_verified"])
        self.assertNotEqual(good["fingerprint"], inactive["fingerprint"])
        self.assertNotEqual(good["fingerprint"], wrong_lamp["fingerprint"])

    def test_stale_camera_identity_fails_closed_before_checkpoint_certificate(self):
        ctrl = ProofController(self.file)
        ctrl.scene["camera_id"] = "session-A:absent"
        with self.assertRaisesRegex(ValueError, "active camera is absent"):
            capture_scene(ctrl, self.file)
        ctrl = ProofController(self.file)
        ctrl.scene["camera_id"] = "other-session:camera"
        with self.assertRaisesRegex(ValueError, "camera identity is malformed"):
            capture_scene(ctrl, self.file)

    def test_same_content_different_session_ids_has_same_fingerprint(self):
        a = capture_scene(FakeController(self.file), self.file)
        b = capture_scene(FakeController(self.file, session="session-B"), self.file)
        self.assertEqual(a, b)
        self.assertEqual(a["object_count"], 1)
        self.assertEqual(len(a["fingerprint"]), 64)

    def test_changed_persistent_content_detected(self):
        self.assertNotEqual(capture_scene(FakeController(self.file), self.file),
                            capture_scene(FakeController(self.file, name="Sphere"), self.file))

    def test_mesh_vertex_changes_are_detected_even_with_same_object_metadata(self):
        original = capture_scene(FakeController(self.file), self.file)
        modified = capture_scene(FakeController(self.file, vertex_shift=0.25), self.file)
        self.assertNotEqual(original["fingerprint"], modified["fingerprint"])
        self.assertNotEqual(original["mesh_fingerprint"], modified["mesh_fingerprint"])
        self.assertEqual(original["mesh_count"], 1)
        self.assertEqual(original["total_vertices"], 3)
        self.assertEqual(original["total_faces"], 1)

    def test_saved_scene_rejects_nonobject_changes_between_read_only_requests(self):
        # The source revision can remain unchanged when a different active
        # file/camera/render setting changes without an object mutation.
        changes = (
            ("file", lambda d: d.update(file="/other/scene.blend")),
            ("camera_id", lambda d: d.update(camera_id="session-A:other-camera")),
            ("render", lambda d: d["render"].update(resolution_x=2048)),
            ("collections", lambda d: d["collections"][0].update(object_count=99)),
            ("object_counts_by_type", lambda d: d.update(
                object_counts_by_type={"LIGHT": 1})),
            ("frames", lambda d: d["frames"].update(current=99)),
        )
        for field, edit in changes:
            class Changed(FakeController):
                def __init__(self, saved):
                    super().__init__(saved)
                    self.inspects = 0
                def execute(self, request):
                    result = super().execute(request)
                    if request.operation == "scene.inspect":
                        self.inspects += 1
                        result.data = copy.deepcopy(result.data)
                        if self.inspects > 1:
                            edit(result.data)
                    return result
            with self.subTest(field=field), self.assertRaisesRegex(
                    ValueError, "non-object scene settings"):
                capture_scene(Changed(self.file), self.file)

    def test_mutating_scene_during_mesh_paging_is_denied(self):
        with self.assertRaisesRegex(ValueError, "changed during geometry proof"):
            capture_scene(FakeController(self.file, flip_after_geometry=True), self.file)

    def test_geometry_revision_mismatch_denied(self):
        controller = FakeController(self.file)
        real = controller.execute
        def forged(request):
            result = real(request)
            if request.operation == "mesh.inspect":
                result.data["geometry_revision"] = "0" * 64
            return result
        controller.execute = forged
        with self.assertRaisesRegex(ValueError, "revision differs"):
            capture_scene(controller, self.file)

    def test_wrong_checkpoint_path_fails_closed(self):
        different = self.file.parent / "other.blend"
        different.write_bytes(b"BLENDER-v430")
        with self.assertRaisesRegex(ValueError, "not reading the saved"):
            capture_scene(FakeController(different), self.file)

    def test_save_copy_writer_may_keep_original_active_file(self):
        source = self.file.parent / "source.blend"
        source.write_bytes(b"BLENDER-v430")
        writer = FakeController(source)
        self.assertEqual(capture_scene(writer, self.file, require_saved_file=False)["object_count"], 1)
        with self.assertRaisesRegex(ValueError, "not reading the saved"):
            capture_scene(writer, self.file)

    def test_malformed_or_changed_page_denied(self):
        with self.assertRaisesRegex(ValueError, "page .*changed"):
            capture_scene(FakeController(self.file, bad_page=True), self.file)

    def test_saved_scene_refuses_missing_duplicate_or_unaccounted_objects(self):
        # An object can be counted twice by untrusted list pagination,
        # making an actually missing saved object appear to have survived.
        base = FakeController(self.file)
        base.scene["object_counts_by_type"] = {"MESH": 0, "LIGHT": 1}
        with self.assertRaisesRegex(ValueError, "object census"):
            capture_scene(base, self.file)
        base = FakeController(self.file)
        base.scene["object_counts_by_type"] = {"MESH": True}
        with self.assertRaisesRegex(ValueError, "census"):
            capture_scene(base, self.file)

        class Duplicates(ProofController):
            def execute(self, request):
                result = super().execute(request)
                if request.operation == "objects.list":
                    result.data["items"][1]["object_id"] = result.data["items"][0]["object_id"]
                return result
        with self.assertRaisesRegex(ValueError, "duplicated or invalid"):
            capture_scene(Duplicates(self.file), self.file)
        class DuplicateNames(ProofController):
            def execute(self, request):
                result = super().execute(request)
                if request.operation == "objects.list":
                    result.data["items"][1]["name"] = result.data["items"][0]["name"]
                return result
        with self.assertRaisesRegex(ValueError, "duplicated or invalid"):
            capture_scene(DuplicateNames(self.file), self.file)

    def test_paged_saved_scene_checks_cross_page_identity_and_cursor(self):
        # 26 objects force two full upstream pages. No Blender or mesh
        # execution is required to catch a swapped last page.
        class PagedScene(FakeController):
            def __init__(self, saved, *, swap_identity=False,
                         swap_name=False, wrong_cursor=False,
                         short_first=False):
                super().__init__(saved)
                self.scene["object_count"] = 26
                self.scene["object_counts_by_type"] = {"EMPTY": 26}
                self.scene["collections"][0]["object_count"] = 26
                self.swap_identity = swap_identity
                self.swap_name = swap_name
                self.wrong_cursor = wrong_cursor
                self.short_first = short_first
                self.rows = []
                for idx in range(26):
                    self.rows.append({
                        **self.obj,
                        "object_id": f"session-A:obj-{idx:03d}",
                        "name": f"Proof-{idx:03d}", "type": "EMPTY",
                        "materials": [], "material_slot_count": 0,
                    })
            def execute(self, request):
                if request.operation == "objects.list":
                    offset = request.payload["offset"]
                    page = [dict(v) for v in self.rows[offset:offset + 25]]
                    if offset == 0 and self.short_first:
                        page.pop()
                    if offset == 25 and self.swap_identity:
                        page[0]["object_id"] = self.rows[0]["object_id"]
                    if offset == 25 and self.swap_name:
                        page[0]["name"] = self.rows[0]["name"]
                    cursor = (25 if offset == 0 else None)
                    if offset == 0 and self.wrong_cursor:
                        cursor = 24
                    return DummyResult({
                        "session_id": self.scene["session_id"],
                        "revision": self.scene["revision"],
                        "offset": offset, "total": 26, "items": page,
                        "next_offset": cursor})
                return super().execute(request)

        report = capture_scene(PagedScene(self.file), self.file)
        self.assertEqual(report["object_count"], 26)
        self.assertEqual(report["mesh_count"], 0)
        for kwargs in ({"swap_identity": True}, {"swap_name": True},
                       {"wrong_cursor": True}, {"short_first": True}):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(
                    ValueError, "page|duplicated"):
                capture_scene(PagedScene(self.file, **kwargs), self.file)

    def test_saved_mesh_rejects_repeated_face_indices_even_with_matching_digest(self):
        class RepeatedFace(FakeController):
            def execute(self, request):
                result = super().execute(request)
                if request.operation == "mesh.inspect":
                    result.data["faces"] = [[0, 1, 1]]
                    data = {k: result.data[k] for k in ("vertices", "faces")}
                    result.data["geometry_revision"] = hashlib.sha256(
                        json.dumps(data, sort_keys=True, separators=(",", ":"),
                                   allow_nan=False).encode()).hexdigest()
                return result
        with self.assertRaisesRegex(ValueError, "repeated index"):
            capture_scene(RepeatedFace(self.file), self.file)

    def test_saved_mesh_datablock_counts_match_actual_inspected_geometry(self):
        # A separately valid geometry SHA is insufficient when object-list
        # metadata says the saved object contains another topology.
        for mismatched in [
            {"vertices": 4}, {"polygons": 2},
            {"edges": True}, {"vertices": -1},
            {"object_type": "CAMERA"},
        ]:
            ctrl = FakeController(self.file)
            ctrl.obj["data"].update(mismatched)
            with self.subTest(mismatched=mismatched), self.assertRaisesRegex(
                    ValueError, "datablock|census"):
                capture_scene(ctrl, self.file)

    def test_missing_or_oversized_saved_mesh_metadata_fails_before_mesh_probe(self):
        class Counting(FakeController):
            mesh_inspections = 0
            def execute(self, request):
                if request.operation == "mesh.inspect":
                    self.mesh_inspections += 1
                return super().execute(request)
        for metadata in (None, {},
                         {"object_type": "MESH", "vertices": 4097,
                          "polygons": 1, "edges": 5}):
            ctrl = Counting(self.file)
            ctrl.obj["data"] = metadata
            with self.subTest(metadata=metadata), self.assertRaisesRegex(
                    ValueError, "datablock|upstream topology"):
                capture_scene(ctrl, self.file)
            self.assertEqual(ctrl.mesh_inspections, 0)

    def test_invalid_saved_object_revision_cannot_be_verified(self):
        for value in ("invalid", "F" * 64, None, True):
            with self.subTest(value=value):
                ctrl = FakeController(self.file)
                ctrl.obj["revision"] = value
                with self.assertRaisesRegex(ValueError, "duplicated or invalid"):
                    capture_scene(ctrl, self.file)

    def test_large_or_truncated_scene_denied(self):
        controller = FakeController(self.file)
        controller.scene["object_count"] = 1001
        with self.assertRaisesRegex(ValueError, "exceeds bounded"):
            capture_scene(controller, self.file)
        controller.scene["object_count"] = 1
        controller.obj["details_truncated"] = True
        with self.assertRaisesRegex(ValueError, "truncated"):
            capture_scene(controller, self.file)


    def test_fixed_motion_requires_real_z_motion_at_exact_frames_and_live_pose(self):
        """A noisy still render or unrelated keyframe is not the fixed motion proof."""
        def point(frame, value, interpolation="LINEAR"):
            return {"frame": float(frame), "value": float(value),
                    "interpolation": interpolation}
        def motion_fixture():
            mesh = {
                "name": "Shuvi41ProofMesh", "type": "MESH",
                "transform": {"location": [0.0, 0.0, 1.5]},
                "animation": {"has_animation_data": True, "action": "Shuvi41ProofMeshAction",
                              "drivers_count": 0, "nla_track_count": 0,
                              "channels": [
                                  {"data_path": path, "index": index,
                                   "point_count": 2,
                                   "points": [point(1, start), point(24, finish)]}
                                  for path, starts, finishes in (
                                      ("location", (0.0, 0.0, 0.0), (0.0, 0.0, 1.5)),
                                      ("rotation_euler", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
                                      ("scale", (1.0, 1.0, 1.0), (1.0, 1.0, 1.0)),
                                  )
                                  for index, (start, finish) in enumerate(zip(starts, finishes))
                              ]},
            }
            camera = {"name": "Shuvi41ProofCamera", "type": "CAMERA",
                      "animation": {"has_animation_data": False}}
            light = {"name": "Shuvi41ProofKey", "type": "LIGHT",
                     "animation": {"has_animation_data": False}}
            return {"frames": {"current": 24}}, [mesh, camera, light]
        def valid(scene, objects, camera=True, light=True, active="Shuvi41ProofCamera"):
            return _fixed_motion_keyframes_match(
                scene, objects, proof_camera_verified=camera,
                proof_key_light_verified=light, active_camera_name=active)
        scene, objects = motion_fixture()
        self.assertTrue(valid(scene, objects))
        for kind in (
            "seek_not_persisted", "flat_z_animation", "wrong_final_keyframe",
            "wrong_interpolation", "wrong_live_pose", "missing_action",
            "untrusted_driver", "untrusted_nla", "duplicate_z_curve",
            "different_mesh", "another_animated_object", "no_camera", "no_light",
            "missing_scale_channel", "spurious_xy_motion", "wrong_rotation",
        ):
            with self.subTest(kind=kind):
                scene, objects = motion_fixture()
                camera, light = True, True
                animation = objects[0]["animation"]
                z = next(ch for ch in animation["channels"]
                         if ch["data_path"] == "location" and ch["index"] == 2)
                if kind == "seek_not_persisted":
                    scene["frames"]["current"] = 1
                elif kind == "flat_z_animation":
                    z["points"][1]["value"] = 0.0
                elif kind == "wrong_final_keyframe":
                    z["points"][1]["frame"] = 25.0
                elif kind == "wrong_interpolation":
                    z["points"][1]["interpolation"] = "BEZIER"
                elif kind == "wrong_live_pose":
                    objects[0]["transform"]["location"][2] = 0.0
                elif kind == "missing_action":
                    animation["has_animation_data"] = False
                elif kind == "untrusted_driver":
                    animation["drivers_count"] = 1
                elif kind == "untrusted_nla":
                    animation["nla_track_count"] = 1
                elif kind == "duplicate_z_curve":
                    animation["channels"].append(copy.deepcopy(z))
                elif kind == "missing_scale_channel":
                    animation["channels"].pop()
                elif kind == "spurious_xy_motion":
                    animation["channels"][0]["points"][1]["value"] = 0.4
                elif kind == "wrong_rotation":
                    animation["channels"][4]["points"][0]["value"] = 1.0
                elif kind == "different_mesh":
                    objects[0]["name"] = "Decoy"
                elif kind == "another_animated_object":
                    objects[2]["animation"]["has_animation_data"] = True
                elif kind == "no_camera":
                    camera = False
                elif kind == "no_light":
                    light = False
                self.assertFalse(valid(scene, objects, camera, light))

        # The real independent reader must invoke the fixed motion invariant.
        with tempfile.TemporaryDirectory(prefix="shuvi41-motion-reopen-") as temp:
            target = Path(temp) / "shuvi41-proof-motion.blend"
            target.write_bytes(b"BLENDER-v430" + b"fixture")
            with self.assertRaisesRegex(ValueError, "fixed motion"):
                capture_scene(FakeController(target), target)

    def test_animated_checkpoint_keyframes_survive_independent_reopen(self):
        """Previously static fingerprints missed altered or missing action data."""
        class AnimatedController(FakeController):
            def __init__(self, saved, *, session="session-A", frame24=2.0,
                         inspect_tamper=False, truncate=False):
                super().__init__(saved, session=session)
                self.inspect_tamper = inspect_tamper
                self.obj["animation"] = {
                    "has_animation_data": True, "action": "Shuvi41Motion",
                    "details_truncated": truncate,
                    "channels": [{
                        "data_path": "location", "index": 0, "point_count": 2,
                        "points": [
                            {"co": [1.0, 0.0], "interpolation": "LINEAR",
                             "easing": "AUTO", "handle_left_type": "AUTO",
                             "handle_right_type": "AUTO",
                             "handle_left": [1.0, 0.0], "handle_right": [1.0, 0.0]},
                            {"co": [24.0, frame24], "interpolation": "LINEAR",
                             "easing": "AUTO", "handle_left_type": "AUTO",
                             "handle_right_type": "AUTO",
                             "handle_left": [24.0, frame24], "handle_right": [24.0, frame24]},
                        ],
                    }],
                }
            def execute(self, request):
                if request.operation == "animation.inspect":
                    self.assert_probe_target(request)
                    p = self.obj["animation"]["channels"][0]["points"]
                    channels = [{
                        "data_path": "location", "index": 0, "point_count": 2,
                        "points": [{
                            "frame": float(point["co"][0]),
                            "value": float(point["co"][1]) + (
                                1.0 if self.inspect_tamper else 0.0),
                            "interpolation": point["interpolation"],
                            "easing": point["easing"],
                            "handle_left_type": point["handle_left_type"],
                            "handle_right_type": point["handle_right_type"],
                            "handle_left": point["handle_left"],
                            "handle_right": point["handle_right"],
                        } for point in p],
                    }]
                    return DummyResult({
                        "object_id": self.obj["object_id"],
                        "object_revision": self.obj["revision"],
                        "action_name": "Shuvi41Motion", "curve_count": 1,
                        "point_count": 2, "channels": channels,
                        "drivers_count": 0, "nla_track_count": 0,
                        "animation_revision": "c" * 64,
                    })
                return super().execute(request)
            def assert_probe_target(self, request):
                if request.payload != {"object_id": self.obj["object_id"]}:
                    raise AssertionError("Animation probe targeted wrong Blender object")

        writer = capture_scene(AnimatedController(self.file), self.file)
        reopened = capture_scene(
            AnimatedController(self.file, session="session-B"), self.file)
        self.assertEqual(writer["fingerprint"], reopened["fingerprint"])
        self.assertEqual(writer["animated_object_count"], 1)
        self.assertEqual(writer["animation_point_count"], 2)
        no_animation = capture_scene(FakeController(self.file, session="session-B"), self.file)
        self.assertNotEqual(writer["fingerprint"], no_animation["fingerprint"])
        changed = capture_scene(
            AnimatedController(self.file, session="session-B", frame24=3.0), self.file)
        self.assertNotEqual(writer["fingerprint"], changed["fingerprint"])
        for params in ({"inspect_tamper": True}, {"truncate": True}):
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    capture_scene(AnimatedController(self.file, **params), self.file)
        bad = AnimatedController(self.file)
        bad.obj["animation"]["channels"][0]["points"][1]["co"][1] = float("nan")
        with self.assertRaises(ValueError):
            capture_scene(bad, self.file)

    def test_animation_snapshot_missing_and_misdeclared_rejected(self):
        ordinary = FakeController(self.file)
        ordinary.obj.pop("animation")
        with self.assertRaises(ValueError):
            capture_scene(ordinary, self.file)
        ordinary = FakeController(self.file)
        ordinary.obj["animation"]["action"] = "Forged"
        with self.assertRaises(ValueError):
            capture_scene(ordinary, self.file)

    def test_reopen_requires_matching_new_read_only_session(self):
        original = capture_scene(FakeController(self.file), self.file)
        calls = []
        process = types.ModuleType("shuvi_blender_agent.process")
        safety = types.ModuleType("shuvi_blender_agent.safety")
        client = types.ModuleType("shuvi_blender_agent.client")

        class SafetyPolicy:
            def __init__(self):
                self.allow_mutations = False
                self.allow_file_writes = False

        class LaunchConfig:
            def __init__(self, **kwargs):
                calls.append(kwargs)
                self.policy = kwargs["policy"]

        class Session:
            client = "dummy"
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        process.LaunchConfig = LaunchConfig
        process.launch = lambda config: Session()
        safety.SafetyPolicy = SafetyPolicy
        client.BlenderController = lambda _transport: FakeController(self.file, session="reopened")
        with patch.dict(sys.modules, {
            "shuvi_blender_agent.process": process,
            "shuvi_blender_agent.safety": safety,
            "shuvi_blender_agent.client": client,
        }):
            proof = reopen_checkpoint(Path("/dummy/blender"), self.file, original)
            self.assertEqual(proof["fingerprint"], original["fingerprint"])
            self.assertTrue(proof["verified"] and proof["read_only"])
            self.assertTrue(proof["checkpoint_bytes_stable_during_reopen"])
            self.assertEqual(proof["checkpoint_file_sha256"],
                             hashlib.sha256(self.file.read_bytes()).hexdigest())
            self.assertTrue(proof["mesh_geometry_verified"])
            self.assertEqual(proof["mesh_count"], 1)
            self.assertEqual(proof["animated_object_count"], 0)
            self.assertEqual(proof["animation_point_count"], 0)
            self.assertFalse(proof["animation_keyframes_independently_verified"])
            self.assertEqual(proof["mesh_fingerprint"], original["mesh_fingerprint"])
            self.assertFalse(calls[0]["policy"].allow_mutations)
            client.BlenderController = lambda _transport: FakeController(
                self.file, session="reopened", name="Sphere")
            with self.assertRaisesRegex(ValueError, "differs"):
                reopen_checkpoint(Path("/dummy/blender"), self.file, original)


if __name__ == "__main__":
    unittest.main()
