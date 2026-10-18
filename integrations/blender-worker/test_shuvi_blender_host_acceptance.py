"""No-host acceptance harness tests. NEVER invokes Blender or subprocess commands."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import shuvi_blender_host_acceptance as host


class HostAcceptanceHarnessTests(unittest.TestCase):
    def test_unconfigured_invocation_is_read_only_probe_with_no_import_or_process(self):
        output = io.StringIO()
        with mock.patch.object(host.subprocess, "run", side_effect=AssertionError("no commands")), \
             mock.patch.object(host.tempfile, "mkdtemp", side_effect=AssertionError("no write")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(host.main([]), 0)
        result = json.loads(output.getvalue())
        self.assertTrue(result["probe_only"])
        self.assertFalse(result["ready"])
        self.assertFalse(result["real_host_acceptance_verified"])
        self.assertFalse(result["native_shuvi_action_executed"])
        self.assertFalse(result["blender_launch_performed"])

    def test_run_refused_without_both_controls_and_cannot_create_outputs(self):
        output = io.StringIO()
        with mock.patch.object(host, "readiness", return_value={"ready": True, "errors": []}), \
             mock.patch.dict(os.environ, {host.OPT_IN_ENV: ""}), \
             mock.patch.object(host.tempfile, "mkdtemp", side_effect=AssertionError("no write")), \
             mock.patch.object(host, "run_trial", side_effect=AssertionError("no launch")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(host.main(["--run"]), 2)
        self.assertTrue(json.loads(output.getvalue())["run_refused"])

    def test_windows_runtime_is_not_claimed_by_ci_or_malformed_paths(self):
        report = host.readiness(None, None, None, Path(__file__).resolve().parents[2])
        self.assertFalse(report["ready"])
        self.assertFalse(report["blender_launch_performed"])
        self.assertFalse(report["real_host_acceptance_verified"])
        self.assertEqual(host.UPSTREAM_SHA, "96b88c2513152f772399f247989ef602d5e0a7d7")
        self.assertEqual([stage for stage, _, _ in host.RECIPE_NAMES],
                         ["model1", "model2", "render", "look", "look_render"])

    def _fixture(self, root: Path):
        filename = root / "shuvi41-proof-stage1.blend"
        data = b"BLENDER-v430" + bytes(range(64))
        filename.write_bytes(data)
        sha = hashlib.sha256(data).hexdigest()
        receipt = {
            "artifact": {"path": str(filename), "bytes": len(data),
                         "sha256": sha, "format": "BLEND"},
            "checkpoint_reopen": {
                "verified": True, "read_only": True, "checkpoint_file_sha256": sha,
            },
        }
        reader = lambda path, kind: {"sha256": sha, "bytes": len(data)}
        return filename, sha, receipt, reader

    def test_exact_file_sha_and_independent_reopen_proof_are_required(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-harness-test-") as temp:
            root = Path(temp)
            filename, sha, receipt, reader = self._fixture(root)
            verified = host.verify_artifact(
                receipt, root, "shuvi41-proof-stage1.blend", "BLEND", reader)
            self.assertEqual(verified["sha256"], sha)
            self.assertTrue(verified["independent_blender_reopen_verified"])
            filename.write_bytes(b"BLENDER-v430" + bytes(range(63)) + b"!")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                host.verify_artifact(receipt, root, filename.name, "BLEND", reader)

    def test_forged_reopen_wrong_basename_parent_or_file_type_is_denied(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-harness-test-") as temp:
            root = Path(temp)
            filename, sha, receipt, reader = self._fixture(root)
            with self.assertRaisesRegex(ValueError, "filename"):
                host.verify_artifact(receipt, root, "shuvi41-proof-stage2.blend",
                                     "BLEND", reader)
            wrong = dict(receipt, checkpoint_reopen={"verified": False})
            with self.assertRaisesRegex(ValueError, "reopen"):
                host.verify_artifact(wrong, root, filename.name, "BLEND", reader)
            with tempfile.TemporaryDirectory(prefix="shuvi41-other-") as other:
                with self.assertRaisesRegex(ValueError, "output directory"):
                    host.verify_artifact(receipt, Path(other), filename.name,
                                         "BLEND", reader)
            with self.assertRaisesRegex(ValueError, "expected typed artifact"):
                host.verify_artifact(receipt, root, filename.name, "PNG", reader)

    def test_successful_opt_in_control_flow_still_never_claims_native_approval(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-harness-test-") as temp:
            root = Path(temp)
            blender = root / "blender.exe"
            blender.write_bytes(b"fixture")
            upstream = root / "upstream"
            upstream.mkdir()
            probe = {"ready": True, "errors": [], "shuvi_source_sha": "a" * 40}
            def fake_trial(exe, src, output, report):
                self.assertEqual(exe, blender)
                self.assertEqual(src, upstream)
                self.assertTrue(output.name.startswith("shuvi41-live-acceptance-"))
                self.assertEqual(report["completed_stages"], [])
                report["status"] = "real_blender_upstream_acceptance_passed"
                report["real_host_acceptance_verified"] = True
            out = io.StringIO()
            with mock.patch.object(host, "readiness", return_value=probe), \
                 mock.patch.dict(os.environ, {host.OPT_IN_ENV: "disposable-only"}), \
                 mock.patch.object(host, "run_trial", side_effect=fake_trial), \
                 contextlib.redirect_stdout(out):
                code = host.main([
                    "--run", "--blender-exe", str(blender),
                    "--upstream-root", str(upstream), "--output-parent", str(root),
                ])
            self.assertEqual(code, 0)
            evidence = json.loads(out.getvalue())
            self.assertTrue(evidence["real_host_acceptance_verified"])
            self.assertFalse(evidence["native_shuvi_action_executed"])
            self.assertFalse(evidence["native_owner_approval_reauthenticated"])
            self.assertFalse(evidence["visual_quality_verified"])
            self.assertFalse(evidence["automatic_retry_allowed"])
            report_path = Path(evidence["output_directory"]) / "acceptance-report.json"
            self.assertTrue(report_path.is_file())
            self.assertEqual(json.loads(report_path.read_text())["status"],
                             "real_blender_upstream_acceptance_passed")

    def test_failure_keeps_partial_outputs_and_never_retries(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-harness-test-") as temp:
            root = Path(temp)
            blender = root / "blender.exe"
            blender.write_bytes(b"fixture")
            upstream = root / "upstream"
            upstream.mkdir()
            def fails(exe, src, output, report):
                (output / "partial.blend").write_bytes(b"partial, not verified")
                report["completed_stages"].append({"stage": "model1"})
                raise RuntimeError("simulated interrupted render")
            out = io.StringIO()
            with mock.patch.object(host, "readiness", return_value={"ready": True}), \
                 mock.patch.dict(os.environ, {host.OPT_IN_ENV: "disposable-only"}), \
                 mock.patch.object(host, "run_trial", side_effect=fails), \
                 contextlib.redirect_stdout(out):
                code = host.main(["--run", "--blender-exe", str(blender),
                                  "--upstream-root", str(upstream), "--output-parent", str(root)])
            self.assertEqual(code, 1)
            report = json.loads(out.getvalue())
            self.assertEqual(report["status"], "failed_or_partial_outcome_unknown")
            self.assertFalse(report["real_host_acceptance_verified"])
            self.assertFalse(report["automatic_retry_allowed"])
            self.assertTrue((Path(report["output_directory"]) / "partial.blend").is_file())
            self.assertEqual(len(report["completed_stages"]), 1)


if __name__ == "__main__":
    unittest.main()
