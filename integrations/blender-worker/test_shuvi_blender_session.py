"""Persistent broker fixture tests. No actual Blender/Windows process is launched."""
import hashlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import shuvi_blender_session as worker


SESSION_ID = "f3933170-cc01-4c20-8079-b4dbd72b93ad"


class FakeRequest:
    def __init__(self, operation, payload=None, timeout_ms=10000):
        self.operation = operation
        self.payload = payload or {}


class FakeResult:
    def __init__(self, status, data):
        self.status, self.data = status, data


class FakeController:
    clients = []
    loaded_file = None
    def __init__(self, client):
        self.clients.append(client)

    def execute(self, request):
        if request.operation == "scene.inspect":
            return FakeResult("succeeded", {"session_id": SESSION_ID,
                                            "revision": "f" * 64, "object_count": 2,
                                            "file": FakeController.loaded_file or ""})
        if request.operation == "system.ping":
            return FakeResult("succeeded", {"ready": True})
        if request.operation == "objects.list":
            return FakeResult("succeeded", {
                "session_id": SESSION_ID, "revision": "f" * 64,
                "offset": request.payload["offset"], "total": 2,
                "next_offset": None,
                "items": [
                    {"object_id": SESSION_ID + ":mesh-one", "name": "ShuviMesh",
                     "type": "MESH", "revision": "a" * 64, "details_truncated": False},
                    {"object_id": SESSION_ID + ":camera", "name": "ShuviCamera",
                     "type": "CAMERA", "revision": "b" * 64, "details_truncated": False},
                ],
            })
        raise AssertionError("Unapproved fake operation")


class FakeSession:
    def __init__(self):
        self.client = object()
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True


class PersistentSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.blender = self.root / "blender.exe"
        self.blender.write_bytes(b"fixed fixture")
        self.output = self.root / "out"
        self.output.mkdir()
        self.sessions = []
        self.launch_configs = []
        cls = self
        packages = {
            "shuvi_blender_agent": types.ModuleType("shuvi_blender_agent"),
            "shuvi_blender_agent.client": types.ModuleType("shuvi_blender_agent.client"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
            "shuvi_blender_agent.process": types.ModuleType("shuvi_blender_agent.process"),
            "shuvi_blender_agent.safety": types.ModuleType("shuvi_blender_agent.safety"),
        }
        class SafetyPolicy:
            def __init__(self, **kwargs):
                self.permissions = kwargs

        class LaunchConfig:
            def __init__(self, **kwargs):
                cls.launch_configs.append(kwargs)

        def launch(_cfg):
            session = FakeSession()
            cls.sessions.append(session)
            return session

        packages["shuvi_blender_agent.client"].BlenderController = FakeController
        packages["shuvi_blender_agent.contracts"].Request = FakeRequest
        packages["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(SUCCEEDED="succeeded")
        packages["shuvi_blender_agent.process"].LaunchConfig = LaunchConfig
        packages["shuvi_blender_agent.process"].launch = launch
        packages["shuvi_blender_agent.safety"].SafetyPolicy = SafetyPolicy
        self.stub = patch.dict(sys.modules, packages)
        self.stub.start()
        self.addCleanup(self.stub.stop)
        FakeController.clients.clear()
        FakeController.loaded_file = None
        self.source_input = None

    def args(self, allow_render=False):
        out = ["--blender-exe", str(self.blender), "--output-dir", str(self.output)]
        if allow_render:
            out.append("--allow-render")
        if self.source_input is not None:
            path, digest = self.source_input
            out.extend(["--blend-file", str(path), "--expected-blend-sha256", digest])
        return out

    def frame(self, op, **kwargs):
        if op == "run_plan" and "expected_scene_revision" not in kwargs:
            kwargs["expected_scene_revision"] = "f" * 64
        return json.dumps({"version": 1, "session_id": SESSION_ID,
                           "op": op, **kwargs}) + "\n"

    def serve(self, frames, *, allow_render=False, fake_plan=None):
        stdout = io.StringIO()
        armed = '{"version":1,"op":"arm"}' + "\n" + frames
        stdin = types.SimpleNamespace(buffer=io.BytesIO(armed.encode("utf-8")))
        with patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout):
            if fake_plan is None:
                code = worker.serve(self.args(allow_render))
            else:
                with patch.object(worker, "checked_plan", fake_plan):
                    code = worker.serve(self.args(allow_render))
        replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
        return code, replies

    def test_reject_unknown_operation(self):
        with self.assertRaisesRegex(ValueError, "not supported"):
            worker.validate({"version": 1, "session_id": SESSION_ID, "op": "exec"}, SESSION_ID)

    def test_reject_wrong_session(self):
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            worker.validate(json.loads(self.frame("ping",).strip().replace(SESSION_ID, "wrong")), SESSION_ID)

    def test_reject_extra_mutation_or_payload(self):
        with self.assertRaisesRegex(ValueError, "Invalid broker command"):
            worker.validate({"version": 1, "session_id": SESSION_ID,
                             "op": "ping", "python": "print('unsafe')"}, SESSION_ID)

    def test_render_approval_must_be_explicit_bool(self):
        with self.assertRaisesRegex(ValueError, "explicit boolean"):
            worker.validate({"version": 1, "session_id": SESSION_ID, "op": "run_plan",
                             "plan": {}, "allow_render": 1,
                             "expected_scene_revision": "f" * 64}, SESSION_ID)

    def test_real_command_sequence_reuses_one_owned_fixture_session(self):
        code, replies = self.serve(self.frame("ping") + self.frame("inspect") + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies],
                         ["ready", "alive", "alive", "closing"])
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)
        self.assertEqual(len(FakeController.clients), 1)
        self.assertFalse(self.launch_configs[0]["policy"].permissions["allow_destructive"])

    def test_multiple_approved_plans_share_one_session_and_close(self):
        calls = []
        def plan(controller, data, root, executable, render, expected_revision):
            calls.append((id(controller), data, render, expected_revision))
            return {"status": "verified", "complete": True, "artifact": {"sha256": "a"*64}}
        inputs = (self.frame("run_plan", plan={"steps": ["first"]}, allow_render=False)
                  + self.frame("run_plan", plan={"steps": ["second"]}, allow_render=False)
                  + self.frame("close"))
        code, replies = self.serve(inputs, fake_plan=plan)
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies], ["ready", "verified", "verified", "closing"])
        self.assertEqual([r[1]["steps"][0] for r in calls], ["first", "second"])
        self.assertEqual(calls[0][0], calls[1][0])
        self.assertEqual(calls[0][3], "f" * 64)
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_render_above_session_ceiling_fails_before_dispatch(self):
        calls = []
        def plan(*args):
            calls.append(args)
        code, replies = self.serve(self.frame("run_plan", plan={}, allow_render=True),
                                   fake_plan=plan)
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertFalse(replies[-1]["retry_automatically"])
        self.assertEqual(calls, [])
        self.assertTrue(self.sessions[0].closed)

    def test_failed_plan_does_not_run_later_queued_commands(self):
        calls = []
        def plan(*args):
            calls.append(True)
            raise ValueError("Simulated partial side-effect; not safe to retry")
        frames = self.frame("run_plan", plan={}, allow_render=False) + self.frame("ping")
        code, replies = self.serve(frames, fake_plan=plan)
        self.assertEqual(code, 4)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)

    def test_disconnect_closes_blender(self):
        code, replies = self.serve("")
        self.assertEqual(code, 0)
        self.assertEqual(len(replies), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_startup_requires_exact_arm_before_creating_blender(self):
        stdout = io.StringIO()
        wrong = types.SimpleNamespace(buffer=io.BytesIO(b'{"version":1,"op":"ping"}\\n'))
        with patch.object(sys, "stdin", wrong), patch.object(sys, "stdout", stdout):
            code = worker.serve(self.args())
        self.assertEqual(code, 4)
        self.assertEqual(len(self.sessions), 0)
        self.assertEqual(json.loads(stdout.getvalue())["status"], "outcome_unknown")

    def test_run_plan_rejects_missing_or_nonhex_revision(self):
        for bad in [None, "x" * 64, "F" * 64, "f" * 63]:
            message = {"version": 1, "session_id": SESSION_ID,
                       "op": "run_plan", "allow_render": False, "plan": {}}
            if bad is not None:
                message["expected_scene_revision"] = bad
            with self.assertRaises(ValueError):
                worker.validate(message, SESSION_ID)

    def test_stale_revision_stops_before_any_modeling_operation(self):
        packages = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
        }
        class FakeStep:
            name = "checkpoint"
            request = types.SimpleNamespace(operation="file.checkpoint")
        class FakePlan:
            steps = [FakeStep()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return FakePlan()
        executed = []
        class FakePlanRunner:
            def __init__(self, _):
                pass
            def run(self, _):
                executed.append("unsafe")
                raise AssertionError("No mutation should occur after stale revision")
        packages["shuvi_blender_agent.plans"].Plan = FakePlan
        packages["shuvi_blender_agent.plans"].PlanRunner = FakePlanRunner
        packages["shuvi_blender_agent.files"].read_output = lambda *_: None
        with patch.dict(sys.modules, packages):
            with self.assertRaisesRegex(ValueError, "Stale Blender scene revision"):
                worker.checked_plan(FakeController(object()), {"steps": [1]},
                                    self.output, self.blender, False, "e" * 64)
        self.assertEqual(executed, [])

    def test_verified_persistent_png_requires_exact_approved_output_filename(self):
        requested = self.output / "expected.png"
        returned = self.output / "wrong.png"
        requested.write_bytes(b"png fixture: expected")
        returned.write_bytes(b"png fixture: wrong")
        import hashlib as _hashlib
        fake = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
        }
        class Step:
            name = "render"
            request = types.SimpleNamespace(
                operation="render.execute", payload={"name": "expected.png"})
        class Plan:
            steps = [Step()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return Plan()
        delivered = {"path": str(requested)}
        calls = []
        class PlanRunner:
            def __init__(self, _):
                pass
            def run(self, _):
                calls.append("render")
                path = Path(delivered["path"])
                digest = _hashlib.sha256(path.read_bytes()).hexdigest()
                return types.SimpleNamespace(
                    completed=True,
                    results={"render": FakeResult("verified",
                        {"after": {"path": str(path), "sha256": digest}})})
        def read_output(path, kind):
            self.assertEqual(kind, "PNG")
            return {"path": str(path), "sha256": _hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                    "format": "PNG", "bytes": Path(path).stat().st_size}
        fake["shuvi_blender_agent.plans"].Plan = Plan
        fake["shuvi_blender_agent.plans"].PlanRunner = PlanRunner
        fake["shuvi_blender_agent.files"].read_output = read_output
        fake["shuvi_blender_agent.contracts"].Request = FakeRequest
        fake["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(
            SUCCEEDED="succeeded", VERIFIED="verified")
        with patch.dict(sys.modules, fake):
            for wrong in [str(returned), str(self.output / "nested.png")]:
                if not Path(wrong).exists():
                    Path(wrong).write_bytes(b"simulated different output")
                delivered["path"] = wrong
                with self.subTest(wrong=wrong):
                    with self.assertRaisesRegex(ValueError, "does not match approved plan destination"):
                        worker.checked_plan(FakeController(object()), {"steps": [1]},
                                            self.output, self.blender, True, "f" * 64)
            delivered["path"] = str(requested)
            accepted = worker.checked_plan(FakeController(object()), {"steps": [1]},
                                           self.output, self.blender, True, "f" * 64)
        self.assertEqual(accepted["status"], "verified")
        self.assertEqual(accepted["artifact"]["path"], str(requested))
        self.assertEqual(len(calls), 3)

    def test_persistent_png_final_plan_filename_must_not_be_nested_or_wrong_extension(self):
        fake = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
        }
        requested = self.output / "correct.png"
        requested.write_bytes(b"fixture data")
        class Step:
            name = "render"
            request = types.SimpleNamespace(operation="render.execute", payload={"name": "correct.png"})
        class Plan:
            steps = [Step()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return Plan()
        class Runner:
            def __init__(self, _):
                pass
            def run(self, _):
                return types.SimpleNamespace(completed=True,
                    results={"render": FakeResult("verified",
                        {"after": {"path": str(requested), "sha256": "0"*64}})})
        fake["shuvi_blender_agent.plans"].Plan = Plan
        fake["shuvi_blender_agent.plans"].PlanRunner = Runner
        fake["shuvi_blender_agent.files"].read_output = lambda *_: None
        fake["shuvi_blender_agent.contracts"].Request = FakeRequest
        fake["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(
            SUCCEEDED="succeeded", VERIFIED="verified")
        with patch.dict(sys.modules, fake):
            for name in ["nested/correct.png", "wrong.blend", ""]:
                with self.subTest(name=name), patch.object(Step.request, "payload", {"name": name}):
                    with self.assertRaisesRegex(ValueError, "Approved persistent plan output filename"):
                        worker.checked_plan(FakeController(object()), {"steps": [1]},
                                            self.output, self.blender, True, "f" * 64)

    def test_approved_source_is_hash_checked_and_loaded_in_authenticated_blender(self):
        path = self.root / "source.blend"
        data = b"BLENDER-v430" + b"safe-checkpoint" * 5
        path.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        self.source_input = (path, digest)
        FakeController.loaded_file = str(path)
        code, replies = self.serve(self.frame("inspect") + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies],
                         ["ready", "alive", "closing"])
        source = replies[0]["input_checkpoint"]
        self.assertEqual(source["sha256"], digest)
        self.assertEqual(source["path"], str(path))
        self.assertEqual(source["bytes"], len(data))
        self.assertTrue(source["verified_loaded_file_path"])
        self.assertTrue(source["loaded_file_hash_checked"])
        self.assertTrue(self.sessions[0].closed)

    def test_wrong_loaded_file_fails_closed_after_bridge_launch(self):
        path = self.root / "source.blend"
        data = b"BLENDER-v430" + b"safe-checkpoint"
        path.write_bytes(data)
        self.source_input = (path, hashlib.sha256(data).hexdigest())
        different = self.root / "other.blend"
        different.write_bytes(data)
        FakeController.loaded_file = str(different)
        code, replies = self.serve("")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)

    def test_wrong_source_sha_fails_before_any_blender_launch(self):
        path = self.root / "source.blend"
        path.write_bytes(b"BLENDER-v430" + b"safe-checkpoint")
        self.source_input = (path, "0" * 64)
        code, replies = self.serve("")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertEqual(len(self.sessions), 0)

    def test_persistent_read_only_object_discovery_reuses_same_authenticated_session(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "Shuvi", "object_type": None}
        frames = (self.frame("objects", query=query, expected_scene_revision="f" * 64)
                  + self.frame("close"))
        code, replies = self.serve(frames)
        self.assertEqual(code, 0)
        self.assertEqual([v["status"] for v in replies],
                         ["ready", "alive", "closing"])
        result = replies[1]
        self.assertEqual(result["operation"], "objects")
        self.assertTrue(result["read_only"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["objects"]), 2)
        self.assertEqual(result["objects"][0]["name"], "ShuviMesh")
        self.assertEqual(result["objects"][0]["revision"], "a" * 64)
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_read_only_object_query_rejects_oversized_or_malformed_payload(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "", "object_type": None}
        for wrong in [
            {**query, "limit": 6}, {**query, "offset": -1},
            {**query, "name_prefix": "x" * 81},
            {**query, "extra_python": "exec('unsafe')"},
        ]:
            with self.assertRaises(ValueError):
                worker.validate(json.loads(self.frame(
                    "objects", query=wrong, expected_scene_revision="f" * 64)), SESSION_ID)

    def test_read_only_objects_stale_revision_fails_closed(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "", "object_type": None}
        code, replies = self.serve(self.frame(
            "objects", query=query, expected_scene_revision="e" * 64))
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertFalse(replies[-1]["retry_automatically"])
        self.assertTrue(self.sessions[0].closed)

    def test_oversized_command_denied(self):
        code, replies = self.serve("x" * 65538 + "\n")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)


if __name__ == "__main__":
    unittest.main()
