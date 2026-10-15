"""Fixture-level checks for reopen manifest fail-closed behavior; no Blender needed."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from shuvi_blender_reopen import capture_scene, reopen_checkpoint


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
        object_id=session+":object-1", revision="f" * 64,
    )
    return scene, obj


class FakeController:
    def __init__(self, saved, *, session="session-A", name="Cube", bad_page=False):
        self.scene, self.obj = fixture(saved, session=session, name=name)
        self.bad_page = bad_page

    def execute(self, request):
        if request.operation == "scene.inspect":
            return DummyResult(self.scene)
        if request.operation == "objects.list":
            if self.bad_page:
                return DummyResult({"session_id": "unexpected", "revision": "a" * 64,
                                    "total": 1, "offset": 0, "items": [self.obj], "next_offset": None})
            return DummyResult({"session_id": self.scene["session_id"],
                                "revision": self.scene["revision"],
                                "total": 1, "offset": 0,
                                "items": [self.obj], "next_offset": None})
        raise AssertionError(request.operation)


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

    def test_same_content_different_session_ids_has_same_fingerprint(self):
        a = capture_scene(FakeController(self.file), self.file)
        b = capture_scene(FakeController(self.file, session="session-B"), self.file)
        self.assertEqual(a, b)
        self.assertEqual(a["object_count"], 1)
        self.assertEqual(len(a["fingerprint"]), 64)

    def test_changed_persistent_content_detected(self):
        self.assertNotEqual(capture_scene(FakeController(self.file), self.file),
                            capture_scene(FakeController(self.file, name="Sphere"), self.file))

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
        with self.assertRaisesRegex(ValueError, "page changed"):
            capture_scene(FakeController(self.file, bad_page=True), self.file)

    def test_large_or_truncated_scene_denied(self):
        controller = FakeController(self.file)
        controller.scene["object_count"] = 1001
        with self.assertRaisesRegex(ValueError, "exceeds bounded"):
            capture_scene(controller, self.file)
        controller.scene["object_count"] = 1
        controller.obj["details_truncated"] = True
        with self.assertRaisesRegex(ValueError, "truncated"):
            capture_scene(controller, self.file)

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
            self.assertFalse(calls[0]["policy"].allow_mutations)
            client.BlenderController = lambda _transport: FakeController(
                self.file, session="reopened", name="Sphere")
            with self.assertRaisesRegex(ValueError, "differs"):
                reopen_checkpoint(Path("/dummy/blender"), self.file, original)


if __name__ == "__main__":
    unittest.main()
