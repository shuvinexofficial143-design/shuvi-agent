"""Fixed, permission-gated Shuvi Blender plan executor (no user Python code).

One owned, authenticated background Blender session. It uses the separate
shuvi_blender_agent package's full preflight and per-step readback; only an
explicitly approved plan with a verified saved output can succeed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

MAX_PLAN_BYTES = 64 * 1024
MAX_STEPS = 6
OUTPUT_OPS = frozenset({"file.checkpoint", "render.execute"})


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-plan", required=True, type=Path)
    parser.add_argument("--blender-exe", required=True, type=Path)
    parser.add_argument("--blend-file", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--allow-render", action="store_true")
    args = parser.parse_args(argv)
    if not args.python_plan.is_file() or not 0 < args.python_plan.stat().st_size <= MAX_PLAN_BYTES:
        parser.error("An existing bounded plan file is required")
    if not args.blender_exe.is_absolute() or not args.blender_exe.is_file():
        parser.error("An existing absolute Blender executable is required")
    if args.blend_file is not None and (
        not args.blend_file.is_absolute()
        or not args.blend_file.is_file()
        or args.blend_file.suffix.lower() != ".blend"
    ):
        parser.error("An existing absolute .blend input is required")
    if not args.output_dir.is_absolute() or not args.output_dir.is_dir():
        parser.error("An existing absolute output directory is required")

    try:
        from shuvi_blender_agent.client import BlenderController
        from shuvi_blender_agent.plans import Plan, PlanRunner
        from shuvi_blender_agent.process import LaunchConfig, launch
        from shuvi_blender_agent.safety import SafetyPolicy
        from shuvi_blender_agent.contracts import Status

        plan_json = json.loads(args.python_plan.read_text(encoding="utf-8"))
        plan = Plan.from_dict(plan_json)
        if not 1 <= len(plan.steps) <= MAX_STEPS or plan.timeout_ms > 90_000:
            raise ValueError("Plan exceeds Shuvi bounded action limits")
        final_step = plan.steps[-1]
        if final_step.request.operation not in OUTPUT_OPS:
            raise ValueError("Plan must end with a verified checkpoint or render output")
        if final_step.request.operation == "render.execute" and not args.allow_render:
            raise ValueError("Render permission was not granted")
        if any(step.request.operation == "render.execute" for step in plan.steps) and not args.allow_render:
            raise ValueError("Render was not approved")
        # No host mutation may begin before the entire local plan is parsed.
        # Destructive operations remain disabled; unknown operations fail
        # under the controller's typed catalog and strict policy.
        policy = SafetyPolicy(
            allow_mutations=True,
            allow_destructive=False,
            allow_file_writes=True,
            allow_rendering=args.allow_render,
        )
        with launch(LaunchConfig(
            executable=args.blender_exe,
            blend_file=args.blend_file,
            startup_timeout_ms=15_000,
            policy=policy,
            output_directory=args.output_dir,
        )) as session:
            controller = BlenderController(session.client)
            report = PlanRunner(controller).run(plan)
            last = report.results.get(final_step.name)
            if not report.completed or last is None or last.status != Status.VERIFIED:
                raise ValueError("Plan incomplete; actual Blender mutations may have occurred")
            if not isinstance(last.data, dict) or not isinstance(last.data.get("after"), dict):
                raise ValueError("Final Blender output evidence missing")
            final = last.data["after"]
            saved = final.get("path")
            digest = final.get("sha256")
            extension = ".blend" if final_step.request.operation == "file.checkpoint" else ".png"
            if not isinstance(saved, str) or not isinstance(digest, str) or len(digest) != 64:
                raise ValueError("Final output path/hash evidence missing")
            actual = Path(saved).resolve(strict=True)
            if actual.parent != args.output_dir.resolve(strict=True) or actual.suffix.lower() != extension:
                raise ValueError("Final output is outside the approved output directory")
            # The package verifies the exact on-disk format and SHA-256, but
            # rerun it at the end so the final deliverable is still intact.
            from shuvi_blender_agent.files import read_output
            reread = read_output(actual, "BLEND" if extension == ".blend" else "PNG")
            if reread["sha256"] != digest:
                raise ValueError("Final artifact changed after Blender verification")
            print(json.dumps({
                "protocol_version": 1,
                "status": "verified",
                "authenticated_blender_plan": True,
                "complete": True,
                "executed_steps": len(report.results),
                "final_operation": final_step.request.operation,
                "artifact": reread,
                "destructive_allowed": False,
                "render_approved": args.allow_render,
            }, ensure_ascii=False))
            return 0
    except Exception:
        # A timed-out or partly-mutated Blender session must never be retried
        # blindly. No raw exception or bridge secrets are sent to a provider.
        print(json.dumps({"status": "outcome_unknown", "complete": False,
                          "retry_automatically": False,
                          "error": "Blender plan failed or its output is unverified; inspect files before retry."}))
        return 4


if __name__ == "__main__":
    sys.exit(run())
