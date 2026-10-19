"""No-host acceptance harness tests. NEVER invokes Blender or subprocess commands."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import struct
import uuid
import zlib
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import shuvi_blender_host_acceptance as host
import shuvi_blender_host_reverify as review


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
                 mock.patch.object(host, "reverify_artifacts", return_value={"current_artifacts_rehashed": True}), \
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


    @staticmethod
    def _png_chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff))

    def _png_fixture(self, stage: str, filter_mode: int = 0,
                     alpha: int = 255, flat: bool = False) -> bytes:
        """Exact RGBA8 rows encoded with chosen genuine PNG filter, no Blender."""
        raw_rows = []
        tint = 25 if stage == "look_render" else 0
        for y in range(64):
            row = bytearray()
            for x in range(64):
                rgb = ((70, 70, 70) if flat
                       else ((3 * x + tint) % 256, (4 * y + tint) % 256, 70))
                row.extend((*rgb, alpha))
            raw_rows.append(bytes(row))
        previous = bytes(64 * 4)
        filtered = []
        for row in raw_rows:
            encoded = bytearray()
            for i, value in enumerate(row):
                left = row[i - 4] if i >= 4 else 0
                above = previous[i]
                upper_left = previous[i - 4] if i >= 4 else 0
                if filter_mode == 0:
                    predictor = 0
                elif filter_mode == 1:
                    predictor = left
                elif filter_mode == 2:
                    predictor = above
                elif filter_mode == 3:
                    predictor = (left + above) // 2
                else:
                    p = left + above - upper_left
                    a, b, c = abs(p - left), abs(p - above), abs(p - upper_left)
                    predictor = (left if a <= b and a <= c
                                 else above if b <= c else upper_left)
                encoded.append((value - predictor) & 255)
            filtered.append(bytes((filter_mode,)) + bytes(encoded))
            previous = row
        return (
            b"\x89PNG\r\n\x1a\n"
            + self._png_chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 6, 0, 0, 0))
            + self._png_chunk(b"IDAT", zlib.compress(b"".join(filtered)))
            + self._png_chunk(b"IEND", b"")
        )

    def _five_stage_report(self, directory: Path):
        """Synthetic bytes for offline readback only; never a real Blender proof."""
        stages = []
        recorded = {}
        model_session = str(uuid.uuid4())
        for stage, filename, kind in host.RECIPE_NAMES:
            if kind == "BLEND":
                data = b"BLENDER-v430" + stage.encode("ascii") + b" fixture bytes"
            else:
                data = self._png_fixture(stage)
            file = directory / filename
            file.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            source = (None if stage in ("model1", "model2")
                      else recorded["look" if stage == "look_render" else "model2"])
            stage_session = (model_session if stage in ("model1", "model2")
                             else str(uuid.uuid4()))
            stages.append({
                "status": "host_file_rehashed", "file": str(file), "sha256": digest,
                "bytes": len(data), "format": kind, "stage": stage,
                "input_source_sha256": source, "blender_session_id": stage_session,
                "independent_blender_reopen_verified": kind == "BLEND",
                "rendered_visual_quality_verified": False,
            })
            recorded[stage] = digest
        return {
            "schema_version": 1, "kind": "shuvi41_real_blender_upstream_trial",
            "status": "real_blender_upstream_acceptance_passed",
            "probe_only": False, "real_host_acceptance_verified": True,
            "stage1_stage2_same_real_blender_session": True,
            "material_shader_preflight_verified": True,
            "native_shuvi_action_executed": False,
            "native_owner_approval_reauthenticated": False,
            "visual_quality_verified": False, "adobe_import_performed": False,
            "automatic_retry_allowed": False, "output_directory": str(directory),
            "completed_stages": stages,
        }

    def test_offline_reverify_works_without_blender_git_or_process_launch(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-offline-review-") as temp:
            directory = Path(temp)
            report = self._five_stage_report(directory)
            (directory / "acceptance-report.json").write_text(json.dumps(report))
            output = io.StringIO()
            with mock.patch.object(host.subprocess, "run", side_effect=AssertionError("never launch")), \
                 mock.patch.object(host.tempfile, "mkdtemp", side_effect=AssertionError("never write")), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(host.main([
                    "--verify-report", str(directory / "acceptance-report.json")
                ]), 0)
            result = json.loads(output.getvalue())
            self.assertTrue(result["current_artifacts_rehashed"])
            self.assertEqual(result["verified_current_file_count"], 5)
            self.assertFalse(result["historical_blender_execution_independently_authenticated"])
            self.assertFalse(result["blender_launch_performed"])
            self.assertFalse(result["native_shuvi_action_executed"])

    def test_offline_reverify_rejects_corruption_session_and_source_lineage(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-offline-review-") as temp:
            directory = Path(temp)
            report = self._five_stage_report(directory)
            self.assertEqual(host.reverify_artifacts(report, directory)[
                "verified_current_file_count"], 5)
            second = report["completed_stages"][1]
            original_session = second["blender_session_id"]
            second["blender_session_id"] = str(uuid.uuid4())
            with self.assertRaisesRegex(ValueError, "same host session"):
                host.reverify_artifacts(report, directory)
            second["blender_session_id"] = original_session
            render = report["completed_stages"][2]
            prior = render["input_source_sha256"]
            render["input_source_sha256"] = "f" * 64
            with self.assertRaisesRegex(ValueError, "lineage"):
                host.reverify_artifacts(report, directory)
            render["input_source_sha256"] = prior
            filename = directory / "shuvi41-proof-stage1.blend"
            filename.write_bytes(filename.read_bytes() + b"tampered")
            with self.assertRaisesRegex(ValueError, "changed since host report"):
                host.reverify_artifacts(report, directory)

    def test_offline_reverify_denies_png_with_valid_crc_but_broken_deflate(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-offline-review-") as temp:
            directory = Path(temp)
            report = self._five_stage_report(directory)
            entry = report["completed_stages"][2]
            target = Path(entry["file"])
            original = target.read_bytes()
            ihdr_end = 8 + 12 + 13
            broken = (original[:ihdr_end] +
                      self._png_chunk(b"IDAT", b"not a valid zlib stream") +
                      self._png_chunk(b"IEND", b""))
            target.write_bytes(broken)
            entry["sha256"] = hashlib.sha256(broken).hexdigest()
            entry["bytes"] = len(broken)
            with self.assertRaisesRegex((ValueError, zlib.error), "PNG|zlib"):
                host.reverify_artifacts(report, directory)

    def test_host_trial_cannot_promote_an_incomplete_five_stage_success_claim(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-no-false-green-") as temp:
            root = Path(temp)
            blender = root / "blender.exe"
            blender.write_bytes(b"fixture")
            upstream = root / "upstream"
            upstream.mkdir()
            output = io.StringIO()
            def incomplete(exe, src, location, report):
                report["status"] = "real_blender_upstream_acceptance_passed"
                report["real_host_acceptance_verified"] = True
                # A forged success without five current outputs must fail closed.
            with (mock.patch.object(host, "readiness", return_value={
                      "ready": True, "schema_version": 1}),
                  mock.patch.dict(os.environ, {host.OPT_IN_ENV: "disposable-only"}),
                  mock.patch.object(host, "run_trial", side_effect=incomplete),
                  contextlib.redirect_stdout(output)):
                self.assertEqual(host.main(["--run", "--blender-exe", str(blender),
                                           "--upstream-root", str(upstream),
                                           "--output-parent", str(root)]), 1)
            report = json.loads(output.getvalue())
            self.assertEqual(report["status"], "failed_or_partial_outcome_unknown")
            self.assertFalse(report.get("post_trial_artifacts_rehashed", False))
            self.assertFalse(report["automatic_retry_allowed"])

    def test_all_five_png_filters_reconstruct_the_same_visible_rgba_pixels(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-filter-check-") as temp:
            target = Path(temp) / "render.png"
            pixels = set()
            for filter_mode in range(5):
                target.write_bytes(self._png_fixture("render", filter_mode=filter_mode))
                pixels.add(review._check_png(target))
            self.assertEqual(len(pixels), 1, "PNG filter encoding cannot change pixel proof")

    def test_valid_crc_and_zlib_cannot_promote_invisible_or_monochrome_render(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-visible-check-") as temp:
            target = Path(temp) / "render.png"
            for alpha, flat in ((0, False), (255, True)):
                target.write_bytes(self._png_fixture("render", alpha=alpha, flat=flat))
                with self.assertRaisesRegex(ValueError, "visible pixel"):
                    review._check_png(target)

    def test_copper_must_change_decoded_pixels_not_just_png_compression_hash(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-pixel-change-") as temp:
            root = Path(temp)
            report = self._five_stage_report(root)
            self.assertEqual(host.reverify_artifacts(report, root)[
                "verified_current_file_count"], 5)
            copper = report["completed_stages"][4]
            target = Path(copper["file"])
            # Same underlying model render but a different PNG filter/byte hash.
            alternate = self._png_fixture("render", filter_mode=4)
            self.assertNotEqual(alternate, (root / "shuvi41-proof-render.png").read_bytes())
            target.write_bytes(alternate)
            copper["bytes"] = len(alternate)
            copper["sha256"] = hashlib.sha256(alternate).hexdigest()
            with self.assertRaisesRegex(ValueError, "pixel-identical"):
                host.reverify_artifacts(report, root)

    def test_offline_reverify_rejects_unsanctioned_status_and_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory(prefix="shuvi41-offline-review-") as temp:
            directory = Path(temp)
            report = self._five_stage_report(directory)
            report["visual_quality_verified"] = True
            with self.assertRaisesRegex(ValueError, "contract mismatch"):
                host.reverify_artifacts(report, directory)
            report["visual_quality_verified"] = False
            path = directory / "acceptance-report.json"
            data = json.dumps(report)
            path.write_text(data.replace('"schema_version": 1,',
                                        '"schema_version": 1, "schema_version": 1,', 1))
            with self.assertRaisesRegex(ValueError, "Duplicate key"):
                host.verify_report_file(path)


if __name__ == "__main__":
    unittest.main()
