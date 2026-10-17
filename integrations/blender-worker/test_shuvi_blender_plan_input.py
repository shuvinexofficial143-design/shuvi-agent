"""One-off Blender plan input integrity regression with a fake authenticated bridge.

All child-launch hooks are fixtures; NO installed Blender or real process runs.
"""
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import shuvi_blender_plan as runner


class FakeResult:
    def __init__(self, status, data):
        self.status = status
        self.data = data


class DummyPlan:
    timeout_ms = 90000

    class Step:
        name = "output"
        request = types.SimpleNamespace(operation="render.execute", payload={"name": "safe-render.png"})

    steps = [Step()]

    @staticmethod
    def from_dict(_):
        return DummyPlan()


class DummySession:
    client = object()

    def __init__(self, host):
        self.host = host

    def __enter__(self):
        self.host.entered += 1
        return self

    def __exit__(self, *_):
        self.host.closed += 1


class OneOffInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "output"
        self.output.mkdir()
        self.plan = self.root / "plan.json"
        self.plan.write_text(json.dumps({"steps": []}), encoding="utf-8")
        self.exe = self.root / "blender.exe"
        self.exe.write_bytes(b"fake executable for source test only")
        self.source = self.root / "approved.blend"
        self.source_data = b"BLENDER-v430" + b"fixed-bounded-source" * 8
        self.source.write_bytes(self.source_data)
        self.sha = hashlib.sha256(self.source_data).hexdigest()
        self.saved = self.output / "safe-render.png"
        self.saved.write_bytes(b"simulated output checked by stub read_output")
        self.digest = hashlib.sha256(self.saved.read_bytes()).hexdigest()
        self.loaded = str(self.source)
        self.entered = 0
        self.closed = 0
        self.executed = 0
        self.change_during_execution = False
        self.last_launch = None
        owner = self

        class FakeController:
            def __init__(self, _client):
                pass

            def execute(self, request):
                if request.operation != "scene.inspect":
                    raise AssertionError("Only authenticated scene inspection is permitted")
                return FakeResult("succeeded", {"file": owner.loaded,
                                                "session_id": "fake-owned-session"})

        class FakePlanRunner:
            def __init__(self, _controller):
                pass

            def run(self, plan):
                owner.executed += 1
                if owner.change_during_execution:
                    owner.source.write_bytes(b"BLENDER-v430" + b"tampered-during-run")
                after = {"path": str(owner.saved), "sha256": owner.digest}
                return types.SimpleNamespace(
                    completed=True,
                    results={"output": FakeResult("verified", {"after": after})},
                )

        class FakeLaunchConfig:
            def __init__(self, **kwargs):
                owner.last_launch = kwargs

        class FakePolicy:
            def __init__(self, **kwargs):
                self.permissions = kwargs

        def fake_launch(_config):
            return DummySession(owner)

        def fake_read_output(path, fmt):
            assert Path(path) == owner.saved and fmt == "PNG"
            return {"path": str(owner.saved), "sha256": owner.digest,
                    "format": "PNG", "bytes": owner.saved.stat().st_size,
                    "width": 64, "height": 64, "color_mode": "RGBA", "bit_depth": 8}

        modules = {
            "shuvi_blender_agent": types.ModuleType("shuvi_blender_agent"),
            "shuvi_blender_agent.client": types.ModuleType("shuvi_blender_agent.client"),
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.process": types.ModuleType("shuvi_blender_agent.process"),
            "shuvi_blender_agent.safety": types.ModuleType("shuvi_blender_agent.safety"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
        }
        modules["shuvi_blender_agent.client"].BlenderController = FakeController
        modules["shuvi_blender_agent.plans"].Plan = DummyPlan
        modules["shuvi_blender_agent.plans"].PlanRunner = FakePlanRunner
        modules["shuvi_blender_agent.process"].LaunchConfig = FakeLaunchConfig
        modules["shuvi_blender_agent.process"].launch = fake_launch
        modules["shuvi_blender_agent.safety"].SafetyPolicy = FakePolicy
        modules["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(
            VERIFIED="verified", SUCCEEDED="succeeded"
        )
        modules["shuvi_blender_agent.contracts"].Request = lambda op, timeout_ms: types.SimpleNamespace(
            operation=op, timeout_ms=timeout_ms
        )
        modules["shuvi_blender_agent.files"].read_output = fake_read_output
        self.modules_patch = patch.dict(sys.modules, modules)
        self.modules_patch.start()
        self.addCleanup(self.modules_patch.stop)

    def invoke(self, sha=None, source=None, source_supplied=True):
        args = ["--python-plan", str(self.plan), "--blender-exe", str(self.exe),
                "--output-dir", str(self.output), "--allow-render"]
        if source_supplied:
            args.extend(["--blend-file", str(source or self.source),
                         "--expected-blend-sha256", sha if sha is not None else self.sha])
        result = io.StringIO()
        with contextlib.redirect_stdout(result):
            code = runner.run(args)
        return code, json.loads(result.getvalue())

    def test_good_source_is_bound_into_verified_result_without_a_real_blender_process(self):
        code, output = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(output["status"], "verified")
        self.assertEqual(output["input_checkpoint"]["path"], str(self.source))
        self.assertEqual(output["input_checkpoint"]["sha256"], self.sha)
        self.assertTrue(output["input_checkpoint"]["loaded_file_hash_checked"])
        self.assertEqual(self.last_launch["blend_file"], self.source)
        self.assertEqual(self.entered, 1)
        self.assertEqual(self.executed, 1)
        self.assertEqual(self.closed, 1)

    def test_correct_hash_and_folder_but_wrong_filename_never_verify(self):
        with patch.object(DummyPlan.Step.request, "payload", {"name": "different-render.png"}):
            code, output = self.invoke()
        self.assertEqual(code, 4)
        self.assertEqual(output["status"], "outcome_unknown")
        self.assertFalse(output["retry_automatically"])
        self.assertEqual(self.executed, 1)
        self.assertEqual(self.closed, 1)

    def test_nested_and_mismatched_output_extensions_denied(self):
        for filename in ["nested/safe-render.png", "safe-render.blend", ""]:
            with self.subTest(filename=filename):
                with patch.object(DummyPlan.Step.request, "payload", {"name": filename}):
                    code, output = self.invoke()
                self.assertEqual(code, 4)
                self.assertEqual(output["status"], "outcome_unknown")

    def test_wrong_hash_denied_before_authentication_or_blender_launch(self):
        code, output = self.invoke(sha="0" * 64)
        self.assertEqual(code, 4)
        self.assertEqual(output["status"], "outcome_unknown")
        self.assertFalse(output["retry_automatically"])
        self.assertEqual(self.entered, 0)
        self.assertEqual(self.executed, 0)

    def test_forged_loaded_scene_denied_without_executing_plan(self):
        other = self.root / "other.blend"
        other.write_bytes(self.source_data)
        self.loaded = str(other)
        code, output = self.invoke()
        self.assertEqual(code, 4)
        self.assertEqual(output["status"], "outcome_unknown")
        self.assertEqual(self.entered, 1)
        self.assertEqual(self.executed, 0)
        self.assertEqual(self.closed, 1)

    def test_input_tamper_during_plan_is_not_accepted_as_success(self):
        self.change_during_execution = True
        code, output = self.invoke()
        self.assertEqual(code, 4)
        self.assertEqual(output["status"], "outcome_unknown")
        self.assertEqual(self.entered, 1)
        self.assertEqual(self.executed, 1)
        self.assertEqual(self.closed, 1)

    def test_no_input_succeeds_and_never_invents_a_source_receipt(self):
        code, output = self.invoke(source_supplied=False)
        self.assertEqual(code, 0)
        self.assertIsNone(output["input_checkpoint"])
        self.assertIsNone(self.last_launch["blend_file"])

    def test_header_mismatch_fails_even_when_expected_digest_matches(self):
        invalid = self.root / "not-blender.blend"
        invalid.write_bytes(b"NOT_A_BLENDER_FILE")
        digest = hashlib.sha256(invalid.read_bytes()).hexdigest()
        code, output = self.invoke(sha=digest, source=invalid)
        self.assertEqual(code, 4)
        self.assertEqual(output["status"], "outcome_unknown")
        self.assertEqual(self.entered, 0)


if __name__ == "__main__":
    unittest.main()
