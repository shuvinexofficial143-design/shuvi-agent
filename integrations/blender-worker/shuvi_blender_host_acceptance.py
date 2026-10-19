"""Opt-in REAL Windows Blender host acceptance; no Shuvi action approval claim.

Default invocation is read-only readiness JSON. Actual launch requires BOTH
--run and SHUVI41_HOST_ACCEPTANCE=disposable-only in this process, an exact
clean/pinned upstream checkout, the Shuvi41 feature branch, an explicitly
chosen Blender executable and an existing output parent. The trial creates
a NEW isolated directory and retains all partial outputs on failure.
No native Shuvi ToolAction, scheduler, Adobe or deployment is invoked here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from uuid import UUID

from shuvi_blender_host_reverify import reverify_artifacts, verify_report_file

# Never materialize __pycache__ in either audited clean source checkout.
sys.dont_write_bytecode = True

UPSTREAM_SHA = "96b88c2513152f772399f247989ef602d5e0a7d7"
SHUVI_BRANCH = "feature/shuvi41-blender-worker"
OPT_IN_ENV = "SHUVI41_HOST_ACCEPTANCE"
HEX64 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
RECIPE_NAMES = (
    ("model1", "shuvi41-proof-stage1.blend", "BLEND"),
    ("model2", "shuvi41-proof-stage2.blend", "BLEND"),
    ("render", "shuvi41-proof-render.png", "PNG"),
    ("look", "shuvi41-proof-material.blend", "BLEND"),
    ("look_render", "shuvi41-proof-material-render.png", "PNG"),
)
MOTION_RECIPE_NAMES = (
    ("motion", "shuvi41-proof-motion.blend", "BLEND"),
    ("motion_frame1", "shuvi41-proof-motion-frame001.png", "PNG"),
    ("motion_frame24", "shuvi41-proof-motion-frame024.png", "PNG"),
)
MAX_ARTIFACT = 128 * 1024 * 1024


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True,
        check=False, timeout=10, shell=False,
    )
    if result.returncode:
        raise ValueError("Cannot verify clean pinned Git checkout")
    return result.stdout.strip()


def _no_links(path: Path) -> bool:
    """Block explicit symlinks and Windows junctions in selected paths."""
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            return False
    return True


def readiness(blender_exe: str | None, upstream_root: str | None,
              output_parent: str | None, repo_root: Path) -> dict:
    report = {
        "schema_version": 1, "kind": "shuvi41_blender_host_readiness",
        "probe_only": True, "ready": False, "host_os_windows": os.name == "nt",
        "upstream_required_sha": UPSTREAM_SHA, "expected_branch": SHUVI_BRANCH,
        "native_shuvi_action_executed": False,
        "blender_launch_performed": False, "real_host_acceptance_verified": False,
        "visual_quality_verified": False, "errors": [],
    }
    if os.name != "nt":
        report["errors"].append("Real acceptance is Windows-only; dry probe is portable")
    if not (blender_exe and upstream_root and output_parent):
        report["errors"].append("Explicit absolute Blender executable, upstream root and output parent required")
        return report

    for role, value in (("blender_exe", blender_exe), ("upstream_root", upstream_root),
                        ("output_parent", output_parent)):
        path = Path(value)
        if not path.is_absolute() or not path.exists() or not _no_links(path):
            report["errors"].append(role + " must be existing, absolute and free of links/junctions")
            continue
        if role == "blender_exe" and (not path.is_file() or path.name.lower() != "blender.exe"):
            report["errors"].append("Selected Blender must be an existing blender.exe")
        elif role != "blender_exe" and not path.is_dir():
            report["errors"].append(role + " must be a directory")
    if report["errors"]:
        return report

    upstream = Path(upstream_root).resolve(strict=True)
    repo = repo_root.resolve(strict=True)
    parent = Path(output_parent).resolve(strict=True)
    if parent == Path(parent.anchor):
        report["errors"].append("Output parent must not be a filesystem/drive root")
    if parent == repo or repo in parent.parents or parent == upstream or upstream in parent.parents:
        report["errors"].append("Output parent must be outside all source checkouts")
    try:
        if shutil.disk_usage(parent).free < 512 * 1024 * 1024:
            report["errors"].append("At least 512 MiB free disk space is required")
    except OSError:
        report["errors"].append("Output parent free-space evidence is unavailable")
    if not (upstream / "src" / "shuvi_blender_agent" / "plans.py").is_file():
        report["errors"].append("Real upstream PlanRunner source is missing")
    if not _no_links(upstream) or not _no_links(repo):
        report["errors"].append("Checkout path contains a link/junction")
    try:
        repo_head = _git(repo, "rev-parse", "HEAD")
        upstream_head = _git(upstream, "rev-parse", "HEAD")
        branch = _git(repo, "branch", "--show-current")
        if upstream_head != UPSTREAM_SHA:
            report["errors"].append("Upstream checkout does not match pinned source SHA")
        if branch != SHUVI_BRANCH:
            report["errors"].append("Shuvi checkout is not on feature/shuvi41-blender-worker")
        if _git(repo, "status", "--porcelain") or _git(upstream, "status", "--porcelain"):
            report["errors"].append("Both source checkouts must be clean")
        report["shuvi_source_sha"] = repo_head
        report["upstream_source_sha"] = upstream_head
    except (OSError, ValueError, subprocess.TimeoutExpired):
        report["errors"].append("Could not verify both local Git revisions")
    report["ready"] = not report["errors"]
    return report


def scene(controller, source: Path | None = None) -> dict:
    from shuvi_blender_agent.contracts import Request, Status
    result = controller.execute(Request("scene.inspect", timeout_ms=10_000))
    if result.status != Status.SUCCEEDED or not isinstance(result.data, dict):
        raise ValueError("Real Blender did not return a live scene inspection")
    view = result.data
    revision = view.get("revision")
    identifier = view.get("session_id")
    if (not isinstance(revision, str) or not HEX64.fullmatch(revision)
            or not isinstance(identifier, str)):
        raise ValueError("Actual Blender scene revision or session ID invalid")
    UUID(identifier)
    if source is not None:
        loaded = view.get("file")
        if not isinstance(loaded, str) or Path(loaded).resolve(strict=True) != source:
            raise ValueError("Blender loaded a different source checkpoint")
    return view


def verify_artifact(result: dict, root: Path, basename: str, kind: str, reader) -> dict:
    """Second independent post-plan file SHA; never trust just broker JSON."""
    proof = result.get("artifact")
    if not isinstance(proof, dict) or proof.get("format") != kind:
        raise ValueError("Plan did not report the expected typed artifact")
    name = proof.get("path")
    if not isinstance(name, str):
        raise ValueError("Missing artifact path")
    file = Path(name)
    if not file.is_absolute() or file.is_symlink() or not _no_links(file):
        raise ValueError("Artifact must be an isolated regular non-symlink file")
    canonical = file.resolve(strict=True)
    if (canonical.parent != root.resolve(strict=True) or canonical.name != basename
            or not canonical.is_file()):
        raise ValueError("Artifact filename or output directory differs from fixed recipe")
    size = canonical.stat().st_size
    sha = proof.get("sha256")
    if (size < 12 or size > MAX_ARTIFACT or size != proof.get("bytes")
            or not isinstance(sha, str) or not HEX64.fullmatch(sha)):
        raise ValueError("Artifact size/SHA claim invalid")
    digest = hashlib.sha256()
    total = 0
    with canonical.open("rb") as handle:
        while True:
            data = handle.read(65536)
            if not data:
                break
            total += len(data)
            if total > MAX_ARTIFACT:
                raise ValueError("Artifact exceeds the accepted size budget")
            digest.update(data)
    if total != size or digest.hexdigest() != sha:
        raise ValueError("Real saved artifact hash differs from PlanRunner")
    checked = reader(canonical, kind)
    if checked.get("sha256") != sha or checked.get("bytes") != size:
        raise ValueError("Independent upstream file reader disagrees with saved artifact")
    reopened = result.get("checkpoint_reopen")
    if kind == "BLEND" and (
        not isinstance(reopened, dict) or reopened.get("verified") is not True
        or reopened.get("read_only") is not True
        or reopened.get("checkpoint_file_sha256") != sha
    ):
        raise ValueError("Checkpoint lacks independent read-only Blender reopen proof")
    if basename == "shuvi41-proof-motion.blend" and (
        not isinstance(reopened, dict)
        or reopened.get("fixed_motion_keyframes_verified") is not True
        or reopened.get("animation_keyframes_independently_verified") is not True
    ):
        raise ValueError("Motion checkpoint lacks independently reopened fixed keyframe semantics")
    if kind == "PNG" and reopened is not None:
        raise ValueError("PNG falsely carries a .blend reopen proof")
    verified = {
        "status": "host_file_rehashed", "file": str(canonical), "sha256": sha,
        "bytes": size, "format": kind,
        "independent_blender_reopen_verified": kind == "BLEND",
        "rendered_visual_quality_verified": False,
    }
    if basename == "shuvi41-proof-motion.blend":
        verified["motion_keyframes_independently_verified"] = True
    return verified


def _session(blender_exe: Path, output: Path, source: Path | None, allow_render: bool):
    from shuvi_blender_agent.process import LaunchConfig, launch
    from shuvi_blender_agent.safety import SafetyPolicy
    return launch(LaunchConfig(
        executable=blender_exe, blend_file=source, output_directory=output,
        startup_timeout_ms=15_000,
        policy=SafetyPolicy(
            allow_mutations=True, allow_destructive=False, allow_file_writes=True,
            allow_rendering=allow_render,
        ),
    ))


def run_trial(blender_exe: Path, upstream: Path, output: Path, report: dict,
              *, include_motion: bool = False) -> None:
    # Import only AFTER opt-in, path/branch/git cleanliness checks and folder isolation.
    sys.path.insert(0, str(upstream / "src"))
    from shuvi_blender_agent.client import BlenderController
    from shuvi_blender_agent.files import read_output
    from shuvi_blender_acceptance import build
    from shuvi_blender_session import (
        checked_plan, inspect_input_source, validate_material_render_source,
        verify_in_session_stage1,
    )
    expected_origin = (upstream / "src" / "shuvi_blender_agent").resolve(strict=True)
    import shuvi_blender_agent.plans as upstream_plans
    if Path(upstream_plans.__file__).resolve(strict=True).parent != expected_origin:
        raise ValueError("Imported PlanRunner is not the exact pinned upstream source")

    files: dict[str, dict] = {}

    def record(stage: str, controller, revision: str, source: Path | None,
               allow_render: bool, source_proof: dict | None = None):
        result = checked_plan(controller, build(stage, revision), output, blender_exe,
                              allow_render, revision)
        basename, kind = next((name, kind) for s, name, kind in
                              RECIPE_NAMES + MOTION_RECIPE_NAMES if s == stage)
        entry = verify_artifact(result, output, basename, kind, read_output)
        entry["blender_session_id"] = scene(controller)["session_id"]
        entry["stage"] = stage
        entry["input_source_sha256"] = source_proof["sha256"] if source_proof else None
        files[stage] = entry
        report["completed_stages"].append(entry)
        return result

    # One authenticated writer session MUST execute both modeling stages.
    with _session(blender_exe, output, None, False) as running:
        # Set this only after the real authenticated Blender session starts.
        # A readiness probe, refused launch, or startup failure stays false.
        report["blender_launch_performed"] = True
        controller = BlenderController(running.client)
        first = scene(controller)
        stage1 = record("model1", controller, first["revision"], None, False)
        next_view = scene(controller)
        if next_view["session_id"] != first["session_id"]:
            raise ValueError("Stage 1 and Stage 2 lost the same Blender session")
        dependency = verify_in_session_stage1(controller, stage1, next_view["revision"])
        if dependency.get("verified") is not True or dependency.get("source_stage") != "model1":
            raise ValueError("Live Stage 2 source does not match saved Stage 1")
        record("model2", controller, next_view["revision"], None, False)
        if files["model2"]["blender_session_id"] != first["session_id"]:
            raise ValueError("Stage 2 completed under a different Blender session")
    report["stage1_stage2_same_real_blender_session"] = True

    used_session_ids = {first["session_id"]}
    stage2_source = Path(files["model2"]["file"])
    material_source = None
    for stage, source, allow_render in (
        ("render", stage2_source, True),
        ("look", stage2_source, False),
        ("look_render", None, True),
    ):
        if stage == "look_render":
            source = material_source
        if source is None:
            raise ValueError("Material checkpoint was not verified before render")
        digest = files["look" if stage == "look_render" else "model2"]["sha256"]
        before = inspect_input_source(source, digest)
        with _session(blender_exe, output, source, allow_render) as running:
            controller = BlenderController(running.client)
            current = scene(controller, source)
            if current["session_id"] in used_session_ids:
                raise ValueError("A reopened stage reused another Blender session identity")
            used_session_ids.add(current["session_id"])
            if stage == "look_render":
                proof = validate_material_render_source(
                    controller, before, current["revision"], True
                )
                if proof.get("verified") is not True:
                    raise ValueError("Material/camera/light source preflight failed")
                report["material_shader_preflight_verified"] = True
            record(stage, controller, current["revision"], source, allow_render, before)
            if files[stage]["blender_session_id"] != current["session_id"]:
                raise ValueError("Stage result differs from authenticated source session")
        if inspect_input_source(source, digest) != before:
            raise ValueError("Input checkpoint changed during separately owned stage")
        if stage == "look":
            material_source = Path(files["look"]["file"])

    # Optional motion proof: a new SHA-bound Stage-2 source session writes
    # a verified animation checkpoint, then TWO more independent, SHA-bound
    # render sessions evaluate frames 1 and 24. Never overwrite Stage-2.
    if include_motion:
        before = inspect_input_source(stage2_source, files["model2"]["sha256"])
        with _session(blender_exe, output, stage2_source, False) as running:
            controller = BlenderController(running.client)
            current = scene(controller, stage2_source)
            if current["session_id"] in used_session_ids:
                raise ValueError("Motion reused an earlier Blender session identity")
            used_session_ids.add(current["session_id"])
            record("motion", controller, current["revision"],
                   stage2_source, False, before)
            if files["motion"]["blender_session_id"] != current["session_id"]:
                raise ValueError("Motion result differs from authenticated source session")
        if inspect_input_source(stage2_source, files["model2"]["sha256"]) != before:
            raise ValueError("Stage-2 source bytes changed during motion checkpoint")
        motion_source = Path(files["motion"]["file"])
        for stage in ("motion_frame1", "motion_frame24"):
            before = inspect_input_source(motion_source, files["motion"]["sha256"])
            with _session(blender_exe, output, motion_source, True) as running:
                controller = BlenderController(running.client)
                current = scene(controller, motion_source)
                if current["session_id"] in used_session_ids:
                    raise ValueError("Motion frame render reused a Blender session identity")
                used_session_ids.add(current["session_id"])
                record(stage, controller, current["revision"],
                       motion_source, True, before)
                if files[stage]["blender_session_id"] != current["session_id"]:
                    raise ValueError("Motion render differs from authenticated source session")
            if inspect_input_source(motion_source, files["motion"]["sha256"]) != before:
                raise ValueError("Saved motion checkpoint changed while rendering a frame")

    # At the end, re-read every artifact after all launches.
    for stage, basename, kind in (RECIPE_NAMES +
                                  (MOTION_RECIPE_NAMES if include_motion else ())):
        entry = files[stage]
        check = read_output(Path(entry["file"]), kind)
        if check.get("sha256") != entry["sha256"] or check.get("bytes") != entry["bytes"]:
            raise ValueError("Earlier verified output changed during later stages")
    report["status"] = "real_blender_upstream_acceptance_passed"
    report["real_host_acceptance_verified"] = True
    report["native_shuvi_action_executed"] = False
    report["visual_quality_verified"] = False
    report["adobe_import_performed"] = False


def _save_report(output: Path, report: dict) -> None:
    # Never write into user files: output is created using mkdtemp below.
    tmp = output / "acceptance-report.tmp"
    final = output / "acceptance-report.json"
    with tmp.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    tmp.replace(final)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only by default, opt-in real Windows Blender trial")
    parser.add_argument("--blender-exe")
    parser.add_argument("--upstream-root")
    parser.add_argument("--output-parent")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--include-motion", action="store_true",
                        help="Opt-in three extra real motion checkpoint/frame-render stages")
    parser.add_argument("--verify-report", help="Read-only rehash of retained host trial artifacts")
    args = parser.parse_args(argv)
    if args.verify_report is not None:
        if args.run or args.include_motion or args.blender_exe or args.upstream_root or args.output_parent:
            parser.error("--verify-report cannot be combined with host-launch options")
        try:
            reviewed = verify_report_file(Path(args.verify_report))
        except (OSError, ValueError, UnicodeError) as exc:
            print(json.dumps({
                "kind": "shuvi41_host_artifact_offline_reverification",
                "current_artifacts_rehashed": False,
                "blender_launch_performed": False,
                "error_type": type(exc).__name__,
                "error": str(exc)[:300],
            }, sort_keys=True))
            return 1
        print(json.dumps(reviewed, sort_keys=True))
        return 0
    if args.include_motion and not args.run:
        parser.error("--include-motion requires --run and existing disposable-only opt-in")
    repo = Path(__file__).resolve().parents[2]
    probe = readiness(args.blender_exe, args.upstream_root, args.output_parent, repo)
    if not args.run:
        print(json.dumps(probe, sort_keys=True))
        return 0
    if os.environ.get(OPT_IN_ENV) != "disposable-only" or not probe["ready"]:
        probe["run_refused"] = True
        print(json.dumps(probe, sort_keys=True))
        return 2

    # No directory is created until the two-factor opt-in and source checks pass.
    output = Path(tempfile.mkdtemp(
        prefix="shuvi41-live-acceptance-", dir=args.output_parent
    )).resolve(strict=True)
    report = {
        **probe, "kind": "shuvi41_real_blender_upstream_trial",
        "probe_only": False, "status": "outcome_unknown",
        "output_directory": str(output), "completed_stages": [],
        "real_host_acceptance_verified": False,
        "native_shuvi_action_executed": False,
        "native_owner_approval_reauthenticated": False,
        "adobe_import_performed": False, "visual_quality_verified": False,
        "automatic_retry_allowed": False,
        "motion_pair_requested": args.include_motion,
        "motion_pair_pixels_differ": False,
    }
    try:
        trial_args = (Path(args.blender_exe).resolve(strict=True),
                      Path(args.upstream_root).resolve(strict=True), output, report)
        if args.include_motion:
            run_trial(*trial_args, include_motion=True)
        else:
            run_trial(*trial_args)
        # Second independent, post-trial current-byte and lineage fence.
        # Even a claimed successful upstream run cannot pass with missing or
        # swapped checkpoints, forged session IDs or undecodable proof PNGs.
        rechecked = reverify_artifacts(report, output)
        report["post_trial_artifacts_rehashed"] = rechecked["current_artifacts_rehashed"]
        if args.include_motion and rechecked.get("motion_pair_pixels_differ") is not True:
            raise ValueError("Opted-in motion pair did not independently verify distinct decoded pixels")
        report["motion_pair_pixels_differ"] = rechecked.get("motion_pair_pixels_differ", False)
    except Exception as exc:
        # Retain ALL partial .blend and PNG files for inspection; never retry.
        report["status"] = "failed_or_partial_outcome_unknown"
        # A failed post-trial recheck must revoke any earlier claimed success.
        report["real_host_acceptance_verified"] = False
        report["post_trial_artifacts_rehashed"] = False
        report["motion_pair_pixels_differ"] = False
        report["error_type"] = type(exc).__name__
        report["error"] = str(exc)[:500]
    finally:
        _save_report(output, report)
    print(json.dumps(report, sort_keys=True))
    return 0 if report["status"] == "real_blender_upstream_acceptance_passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
