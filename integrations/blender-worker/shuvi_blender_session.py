"""Fixed persistent Blender broker for Rust-owned, approval-scoped sessions.

Transport: one bounded JSON line per command on a private Python-child stdin/stdout
pipe; the Blender control channel itself uses the separate package's authenticated
loopback socket. No arbitrary Python, expressions, eval, imports or command strings
are accepted from the model. An uncertain plan permanently closes this session.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

MAX_REQUEST_BYTES = 65536
MAX_COMMANDS = 48
MAX_INPUT_BYTES = 128 * 1024 * 1024
OUTPUT_OPS = frozenset(("file.checkpoint", "render.execute"))


def protocol(reply: dict) -> None:
    raw = json.dumps(reply, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(raw.encode("utf-8")) > 131072:
        raise ValueError("Bounded Blender broker response exceeded")
    sys.stdout.write(raw + "\n")
    sys.stdout.flush()


def validate(message: object, session_id: str) -> tuple[str, object]:
    if not isinstance(message, dict) or set(message) - {"version", "session_id", "op", "plan", "allow_render", "expected_scene_revision"}:
        raise ValueError("Invalid broker command")
    if message.get("version") != 1 or message.get("session_id") != session_id:
        raise ValueError("Broker session identity mismatch")
    operation = message.get("op")
    if operation not in ("ping", "inspect", "run_plan", "close"):
        raise ValueError("Broker operation is not supported")
    if operation == "run_plan":
        if set(message) != {"version", "session_id", "op", "plan", "allow_render", "expected_scene_revision"}:
            raise ValueError("Run plan requires an exact typed payload")
        if type(message["allow_render"]) is not bool:
            raise ValueError("Render approval must be an explicit boolean")
        revision = message["expected_scene_revision"]
        if (not isinstance(revision, str) or len(revision) != 64
                or any(char not in "0123456789abcdef" for char in revision)):
            raise ValueError("An exact fresh lowercase scene revision is required")
        return operation, message["plan"], message["allow_render"], revision
    if set(message) != {"version", "session_id", "op"}:
        raise ValueError("Unexpected broker payload")
    return operation, None, False, None


def checked_plan(controller, json_plan, output_dir: Path, blender_exe: Path,
                 allow_render: bool, expected_scene_revision: str):
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

    # Validate the caller's scene revision immediately before any mutation.
    from shuvi_blender_agent.contracts import Request
    current = controller.execute(Request("scene.inspect", timeout_ms=10_000))
    if (current.status != Status.SUCCEEDED or not isinstance(current.data, dict)
            or current.data.get("revision") != expected_scene_revision):
        raise ValueError("Stale Blender scene revision: no plan steps dispatched")
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


def inspect_input_source(filename: Path, expected_sha256: str) -> dict:
    """Read exact source bytes before/after authenticated Blender load."""
    if (not isinstance(expected_sha256, str)
            or len(expected_sha256) != 64
            or any(ch not in "0123456789abcdef" for ch in expected_sha256)):
        raise ValueError("Blender source requires an exact lowercase SHA-256")
    if not filename.is_absolute() or filename.suffix.lower() != ".blend":
        raise ValueError("Blender source is not an absolute .blend")
    if filename.is_symlink() or not filename.is_file():
        raise ValueError("Blender source must be a regular non-symlink file")
    real_path = filename.resolve(strict=True)
    hasher = hashlib.sha256()
    size = 0
    with real_path.open("rb") as source:
        magic = source.read(12)
        if (len(magic) != 12 or magic[:7] != b"BLENDER"
                or magic[7:8] not in (b"-", b"_")
                or magic[8:9] not in (b"v", b"V")
                or not all(48 <= digit <= 57 for digit in magic[9:12])):
            raise ValueError("Blender source does not have a valid .blend header")
        hasher.update(magic)
        size = 12
        while True:
            chunk = source.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_INPUT_BYTES:
                raise ValueError("Blender source exceeds byte budget")
            hasher.update(chunk)
    if hasher.hexdigest() != expected_sha256:
        raise ValueError("Blender source bytes differ from approved checkpoint")
    # Retain the exact Rust canonical launch argument for the native
    # source-identity comparison (Windows may use an extended-length prefix).
    return {"path": str(filename), "sha256": expected_sha256,
            "bytes": size, "verified_loaded_file_path": True,
            "loaded_file_hash_checked": True}


def serve(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="shuvi-blender-owned-session")
    parser.add_argument("--blender-exe", type=Path, required=True)
    parser.add_argument("--blend-file", type=Path)
    parser.add_argument("--expected-blend-sha256")
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
    if (args.blend_file is None) != (args.expected_blend_sha256 is None):
        parser.error("Explicit Blender input SHA-256 must accompany --blend-file")

    try:
        # Rust must register this exact PID and bind its Windows kill-on-close
        # Job Object before allowing Python to launch a Blender child.
        arm = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 2)
        if arm != b'{"version":1,"op":"arm"}\n':
            raise ValueError("Blender session broker was not armed by its owner")
        source_before = (inspect_input_source(args.blend_file, args.expected_blend_sha256)
                         if args.blend_file is not None else None)
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
            if source_before is not None:
                loaded_file = initial.data.get("file")
                if (not isinstance(loaded_file, str) or not loaded_file
                        or Path(loaded_file).resolve(strict=True)
                        != Path(source_before["path"])):
                    raise ValueError("Authenticated Blender did not load the exact approved checkpoint")
                source_after = inspect_input_source(args.blend_file, args.expected_blend_sha256)
                if source_after != source_before:
                    raise ValueError("Source bytes/path changed while launching Blender")
            protocol({"version": 1, "status": "ready", "session_id": session_id,
                      "authenticated": True, "mutations_by_approval_only": True,
                      "render_approved": args.allow_render,
                      "input_checkpoint": source_before})
            for _ in range(MAX_COMMANDS):
                raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 2)
                if not raw:  # parent gone: terminate Blender rather than orphan it
                    return 0
                if len(raw) > MAX_REQUEST_BYTES + 1 or not raw.endswith(b"\n"):
                    raise ValueError("Oversized or incomplete broker frame")
                operation, payload, request_allow_render, expected_revision = validate(json.loads(raw), session_id)
                if operation == "close":
                    # Session's context manager closes the authenticated transport
                    # and terminates its *owned* Blender process on return.
                    protocol({"version": 1, "status": "closing", "session_id": session_id})
                    return 0
                if operation == "run_plan":
                    if request_allow_render and not args.allow_render:
                        raise ValueError("Action-level render approval exceeds session ceiling")
                    result = checked_plan(controller, payload, args.output_dir,
                                          args.blender_exe, request_allow_render, expected_revision)
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
