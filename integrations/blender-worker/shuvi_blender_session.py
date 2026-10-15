"""Fixed persistent Blender broker for Rust-owned, approval-scoped sessions.

Transport: one bounded JSON line per command on a private Python-child stdin/stdout
pipe; the Blender control channel itself uses the separate package's authenticated
loopback socket. No arbitrary Python, expressions, eval, imports or command strings
are accepted from the model. An uncertain plan permanently closes this session.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

MAX_REQUEST_BYTES = 65536
MAX_COMMANDS = 48
OUTPUT_OPS = frozenset(("file.checkpoint", "render.execute"))


def protocol(reply: dict) -> None:
    raw = json.dumps(reply, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(raw.encode("utf-8")) > 131072:
        raise ValueError("Bounded Blender broker response exceeded")
    sys.stdout.write(raw + "\n")
    sys.stdout.flush()


def validate(message: object, session_id: str) -> tuple[str, object]:
    if not isinstance(message, dict) or set(message) - {"version", "session_id", "op", "plan", "allow_render"}:
        raise ValueError("Invalid broker command")
    if message.get("version") != 1 or message.get("session_id") != session_id:
        raise ValueError("Broker session identity mismatch")
    operation = message.get("op")
    if operation not in ("ping", "inspect", "run_plan", "close"):
        raise ValueError("Broker operation is not supported")
    if operation == "run_plan":
        if set(message) != {"version", "session_id", "op", "plan", "allow_render"}:
            raise ValueError("Run plan requires an exact typed payload")
        if type(message["allow_render"]) is not bool:
            raise ValueError("Render approval must be an explicit boolean")
        return operation, message["plan"], message["allow_render"]
    if set(message) != {"version", "session_id", "op"}:
        raise ValueError("Unexpected broker payload")
    return operation, None, False


def checked_plan(controller, json_plan, output_dir: Path, blender_exe: Path, allow_render: bool):
    from shuvi_blender_agent.contracts import Status
    from shuvi_blender_agent.files import read_output
    from shuvi_blender_agent.plans import Plan, PlanRunner
    from shuvi_blender_reopen import capture_scene, reopen_checkpoint

    encoded = json.dumps(json_plan, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if not 0 < len(encoded) <= MAX_REQUEST_BYTES:
        raise ValueError("Plan is not bounded")
    plan = Plan.from_dict(json_plan)
    if not 1 <= len(plan.steps) <= 6 or plan.timeout_ms > 90000:
        raise ValueError("Plan exceeds bounded execution policy")
    final_step = plan.steps[-1]
    if final_step.request.operation not in OUTPUT_OPS:
        raise ValueError("Plan must end with a file or render proof")
    if not allow_render and any(s.request.operation == "render.execute" for s in plan.steps):
        raise ValueError("No rendering permission on this session")

    report = PlanRunner(controller).run(plan)
    last = report.results.get(final_step.name)
    if not report.completed or last is None or last.status != Status.VERIFIED:
        raise ValueError("Plan partially executed or output not verified")
    if not isinstance(last.data, dict) or not isinstance(last.data.get("after"), dict):
        raise ValueError("Final output evidence missing")
    receipt = last.data["after"]
    kind = "BLEND" if final_step.request.operation == "file.checkpoint" else "PNG"
    extension = ".blend" if kind == "BLEND" else ".png"
    actual = Path(receipt["path"]).resolve(strict=True)
    if actual.suffix.lower() != extension or actual.parent != output_dir.resolve(strict=True):
        raise ValueError("Plan output escaped approved directory")
    checked = read_output(actual, kind)
    if checked["sha256"] != receipt.get("sha256"):
        raise ValueError("Checkpoint or render changed after plan")

    # Read the writer's post-save scene before opening the saved copy in a NEW
    # read-only authenticated Blender process. Keep original session alive.
    reopened = None
    if kind == "BLEND":
        before = capture_scene(controller, actual, require_saved_file=False)
        reopened = reopen_checkpoint(blender_exe, actual, before)
        checked = read_output(actual, kind)
        if checked["sha256"] != receipt["sha256"]:
            raise ValueError("Checkpoint changed during reopen")
    return {
        "status": "verified", "complete": True, "artifact": checked,
        "checkpoint_reopen": reopened, "executed_steps": len(report.results),
        "render_approved": allow_render, "destructive_allowed": False,
        "authenticated_blender_plan": True,
    }


def serve(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="shuvi-blender-owned-session")
    parser.add_argument("--blender-exe", type=Path, required=True)
    parser.add_argument("--blend-file", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--allow-render", action="store_true")
    args = parser.parse_args(argv)
    if not args.blender_exe.is_absolute() or not args.blender_exe.is_file():
        parser.error("Existing absolute Blender executable required")
    if args.blend_file is not None and (
        not args.blend_file.is_absolute()
        or not args.blend_file.is_file()
        or args.blend_file.suffix.lower() != ".blend"
    ):
        parser.error("Existing absolute .blend required")
    if not args.output_dir.is_absolute() or not args.output_dir.is_dir():
        parser.error("Existing absolute output directory required")

    try:
        from shuvi_blender_agent.client import BlenderController
        from shuvi_blender_agent.contracts import Request, Status
        from shuvi_blender_agent.process import LaunchConfig, launch
        from shuvi_blender_agent.safety import SafetyPolicy
        with launch(LaunchConfig(
            executable=args.blender_exe,
            blend_file=args.blend_file,
            output_directory=args.output_dir,
            startup_timeout_ms=15000,
            policy=SafetyPolicy(
                allow_mutations=True,
                allow_destructive=False,
                allow_file_writes=True,
                allow_rendering=args.allow_render,
            ),
        )) as session:
            controller = BlenderController(session.client)
            initial = controller.execute(Request("scene.inspect", timeout_ms=10000))
            if initial.status != Status.SUCCEEDED:
                raise ValueError("Blender did not return authenticated scene inspection")
            session_id = initial.data.get("session_id")
            if not isinstance(session_id, str) or not 0 < len(session_id) <= 128:
                raise ValueError("Blender did not return a valid session identity")
            protocol({"version": 1, "status": "ready", "session_id": session_id,
                      "authenticated": True, "mutations_by_approval_only": True,
                      "render_approved": args.allow_render})
            for _ in range(MAX_COMMANDS):
                raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 2)
                if not raw:  # parent gone: terminate Blender rather than orphan it
                    return 0
                if len(raw) > MAX_REQUEST_BYTES + 1 or not raw.endswith(b"\n"):
                    raise ValueError("Oversized or incomplete broker frame")
                operation, payload, request_allow_render = validate(json.loads(raw), session_id)
                if operation == "close":
                    # Session's context manager closes the authenticated transport
                    # and terminates its *owned* Blender process on return.
                    protocol({"version": 1, "status": "closing", "session_id": session_id})
                    return 0
                if operation == "run_plan":
                    if request_allow_render and not args.allow_render:
                        raise ValueError("Action-level render approval exceeds session ceiling")
                    result = checked_plan(controller, payload, args.output_dir,
                                          args.blender_exe, request_allow_render)
                    protocol({"version": 1, "session_id": session_id, **result})
                    continue
                result = controller.execute(Request(
                    "system.ping" if operation == "ping" else "scene.inspect",
                    timeout_ms=10000,
                ))
                if result.status != Status.SUCCEEDED:
                    raise ValueError("Authenticated Blender session probe failed")
                if operation == "ping" and result.data.get("ready") is not True:
                    raise ValueError("Blender ping was not ready")
                if operation == "inspect" and result.data.get("session_id") != session_id:
                    raise ValueError("Blender process changed its scene/session identity")
                protocol({"version": 1, "status": "alive", "session_id": session_id,
                          "operation": operation,
                          "scene_revision": result.data.get("revision") if operation == "inspect" else None,
                          "object_count": result.data.get("object_count") if operation == "inspect" else None})
            raise ValueError("Blender persistent session command budget exhausted")
    except Exception:
        # Even if a plan partially edited the scene, the result is never success
        # and this *owned* process is closed; Rust must not auto-retry.
        try:
            protocol({"version": 1, "status": "outcome_unknown",
                      "retry_automatically": False})
        except Exception:
            pass
        return 4


if __name__ == "__main__":
    sys.exit(serve())
