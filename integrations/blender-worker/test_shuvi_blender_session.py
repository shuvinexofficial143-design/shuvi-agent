"""Persistent broker fixture tests. No actual Blender/Windows process is launched."""
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
    def __init__(self, client):
        self.clients.append(client)

    def execute(self, request):
        if request.operation == "scene.inspect":
            return FakeResult("succeeded", {"session_id": SESSION_ID,
                                            "revision": "f" * 64, "object_count": 2})
        if request.operation == "system.ping":
            return FakeResult("succeeded", {"ready": True})
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

    def args(self, allow_render=False):
        out = ["--blender-exe", str(self.blender), "--output-dir", str(self.output)]
        if allow_render:
            out.append("--allow-render")
        return out

    def frame(self, op, **kwargs):
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
                             "plan": {}, "allow_render": 1}, SESSION_ID)

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
        def plan(controller, data, root, executable, render):
            calls.append((id(controller), data, render))
            return {"status": "verified", "complete": True, "artifact": {"sha256": "a"*64}}
        inputs = (self.frame("run_plan", plan={"steps": ["first"]}, allow_render=False)
                  + self.frame("run_plan", plan={"steps": ["second"]}, allow_render=False)
                  + self.frame("close"))
        code, replies = self.serve(inputs, fake_plan=plan)
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies], ["ready", "verified", "verified", "closing"])
        self.assertEqual([r[1]["steps"][0] for r in calls], ["first", "second"])
        self.assertEqual(calls[0][0], calls[1][0])
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

    def test_oversized_command_denied(self):
        code, replies = self.serve("x" * 65538 + "\n")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)


if __name__ == "__main__":
    unittest.main()
