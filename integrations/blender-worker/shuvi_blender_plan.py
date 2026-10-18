"""Fixed, permission-gated Shuvi Blender plan executor (no user Python code).

One owned, authenticated background Blender session. It uses the separate
shuvi_blender_agent package's full preflight and per-step readback; only an
explicitly approved plan with a verified saved output can succeed.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import threading
import time
from pathlib import Path

MAX_PLAN_BYTES = 64 * 1024
MAX_STEPS = 6
OUTPUT_OPS = frozenset({"file.checkpoint", "render.execute"})


class PrivateWorkerPulse:
    """Proof of Python worker liveness, NOT evidence of app progress or audit.

    App-specific stages advance only after actual Blender readback. The key is
    loaded from a private Rust-created file instead of the process command line.
    """
    def __init__(self, path: Path, key_file: Path, action: str, plan_hash: str):
        if (not path.is_absolute() or path.suffix != ".json"
                or not key_file.is_absolute() or path.parent != key_file.parent
                or not path.parent.is_dir() or not key_file.is_file()):
            raise ValueError("Invalid private worker progress paths")
        if len(action) != 36 or len(plan_hash) != 64:
            raise ValueError("Invalid progress identity")
        key_hex = key_file.read_text(encoding="ascii")
        if len(key_hex) != 64:
            raise ValueError("Invalid private heartbeat key")
        self.key = bytes.fromhex(key_hex)
        self.path, self.action, self.plan_hash = path, action, plan_hash
        self.stage, self.sequence = "python_active", 0
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.failure = None
        self._emit()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _emit(self):
        with self.lock:
            self.sequence += 1
            timestamp = int(time.time() * 1000)
            payload = {"schemaVersion": 1, "actionId": self.action,
                       "planSha256": self.plan_hash, "sequence": self.sequence,
                       "stage": self.stage, "emittedAtMs": timestamp}
            message = f"1\n{self.action}\n{self.plan_hash}\n{self.sequence}\n{self.stage}\n{timestamp}"
            payload["hmacSha256"] = hmac.new(
                self.key, message.encode("ascii"), hashlib.sha256
            ).hexdigest()
            raw = json.dumps(payload, separators=(",", ":")).encode("ascii")
            if len(raw) > 2048:
                raise ValueError("Worker heartbeat exceeds 2 KiB")
            temporary = self.path.with_suffix(".json.tmp")
            with temporary.open("wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)

    def _loop(self):
        while not self.stop.wait(3):
            try:
                self._emit()
            except Exception as error:
                self.failure = error
                return

    def mark(self, stage: str):
        if self.failure is not None:
            raise ValueError("Worker heartbeat failed")
        with self.lock:
            self.stage = stage
        self._emit()

    def finish(self):
        self.stop.set()
        self.thread.join(timeout=5)
        if self.thread.is_alive() or self.failure is not None:
            raise ValueError("Worker heartbeat could not finish")
        self._emit()


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-plan", required=True, type=Path)
    parser.add_argument("--blender-exe", required=True, type=Path)
    parser.add_argument("--blend-file", type=Path)
    parser.add_argument("--expected-blend-sha256")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--allow-render", action="store_true")
    # Only the internal scheduled Rust worker requests this private
    # create-exclusive result. Existing stdout callers remain supported.
    parser.add_argument("--result-file", type=Path)
    parser.add_argument("--worker-progress-file", type=Path)
    parser.add_argument("--worker-progress-key-file", type=Path)
    parser.add_argument("--worker-action-id")
    parser.add_argument("--worker-plan-sha256")
    args = parser.parse_args(argv)
    progress_args = (args.worker_progress_file, args.worker_progress_key_file,
                     args.worker_action_id, args.worker_plan_sha256)
    if any(v is not None for v in progress_args) and not all(
            v is not None for v in progress_args):
        parser.error("Worker progress arguments must be supplied together")
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
    if (args.blend_file is None) != (args.expected_blend_sha256 is None):
        parser.error("An exact source SHA-256 must accompany an input .blend")

    pulse = None
    try:
        from shuvi_blender_session import inspect_input_source, require_complete_step_report
        if args.worker_progress_file is not None:
            pulse = PrivateWorkerPulse(
                args.worker_progress_file, args.worker_progress_key_file,
                args.worker_action_id, args.worker_plan_sha256)
        from shuvi_blender_agent.client import BlenderController
        from shuvi_blender_agent.plans import Plan, PlanRunner
        from shuvi_blender_agent.process import LaunchConfig, launch
        from shuvi_blender_agent.safety import SafetyPolicy
        from shuvi_blender_agent.contracts import Request, Status

        staged_bytes = args.python_plan.read_bytes()
        if not 0 < len(staged_bytes) <= MAX_PLAN_BYTES:
            raise ValueError("Staged plan exceeded the approved byte budget")
        approved_plan_sha256 = hashlib.sha256(staged_bytes).hexdigest()
        if pulse is not None and pulse.plan_hash != approved_plan_sha256:
            raise ValueError("Heartbeat plan digest mismatches staged plan")
        source_before = (inspect_input_source(args.blend_file, args.expected_blend_sha256)
                         if args.blend_file is not None else None)
        plan_json = json.loads(staged_bytes.decode("utf-8"))
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
            if pulse is not None:
                pulse.mark("blender_session_attached")
            controller = BlenderController(session.client)
            if source_before is not None:
                inspected = controller.execute(Request("scene.inspect", timeout_ms=10_000))
                if (inspected.status != Status.SUCCEEDED
                        or not isinstance(inspected.data, dict)
                        or not isinstance(inspected.data.get("file"), str)
                        or Path(inspected.data["file"]).resolve(strict=True)
                        != Path(source_before["path"])):
                    raise ValueError("Authenticated one-shot Blender did not open the exact source")
                if inspect_input_source(args.blend_file, args.expected_blend_sha256) != source_before:
                    raise ValueError("One-shot Blender source changed while opening it")
            report = PlanRunner(controller).run(plan)
            executed_steps = require_complete_step_report(plan, report)
            last = report.results.get(final_step.name)
            if last is None or last.status != Status.VERIFIED:
                raise ValueError("Plan incomplete; actual Blender mutations may have occurred")
            if pulse is not None:
                pulse.mark("plan_verified")
            if not isinstance(last.data, dict) or not isinstance(last.data.get("after"), dict):
                raise ValueError("Final Blender output evidence missing")
            final = last.data["after"]
            saved = final.get("path")
            digest = final.get("sha256")
            extension = ".blend" if final_step.request.operation == "file.checkpoint" else ".png"
            if not isinstance(saved, str) or not isinstance(digest, str) or len(digest) != 64:
                raise ValueError("Final output path/hash evidence missing")
            # Prove the exact output selected in the approved typed plan,
            # not just any correctly-hashed file in the approved directory.
            expected_name = final_step.request.payload.get("name")
            if (not isinstance(expected_name, str) or not expected_name
                    or Path(expected_name).name != expected_name
                    or "/" in expected_name or "\\" in expected_name
                    or not expected_name.lower().endswith(extension)):
                raise ValueError("Approved plan output filename is invalid")
            actual = Path(saved).resolve(strict=True)
            if (actual.name != expected_name
                    or actual.parent != args.output_dir.resolve(strict=True)
                    or actual.suffix.lower() != extension):
                raise ValueError("Actual artifact differs from approved plan output name or directory")
            # Capture only read-only, bounded, session-local observable state
            # after the approved save; launch a DIFFERENT process for reopen.
            if extension == ".blend":
                from shuvi_blender_reopen import capture_scene
                original_scene = capture_scene(controller, actual, require_saved_file=False)
            from shuvi_blender_agent.files import read_output
            reread = read_output(actual, "BLEND" if extension == ".blend" else "PNG")
            if reread["sha256"] != digest:
                raise ValueError("Final artifact changed after Blender verification")
            if source_before is not None and (
                inspect_input_source(args.blend_file, args.expected_blend_sha256) != source_before
            ):
                raise ValueError("Blender input checkpoint changed during plan execution")
            if pulse is not None:
                pulse.mark("artifact_rehashed")
        # The mutating session has closed before launching the new read-only
        # Blender child. Reopen is never an automatic replay of plan mutations.
        checkpoint_reopen = None
        if extension == ".blend":
            from shuvi_blender_reopen import reopen_checkpoint
            checkpoint_reopen = reopen_checkpoint(args.blender_exe, actual, original_scene)
            reread = read_output(actual, "BLEND")
            if reread["sha256"] != digest:
                raise ValueError("Checkpoint changed while verifying reopened scene")
        response = {
            "protocol_version": 1,
            "status": "verified",
            "authenticated_blender_plan": True,
            "complete": True,
            "executed_steps": executed_steps,
            "final_operation": final_step.request.operation,
            "artifact": reread,
            "destructive_allowed": False,
            "render_approved": args.allow_render,
            "approved_plan_sha256": approved_plan_sha256,
            "checkpoint_reopen": checkpoint_reopen,
            "input_checkpoint": source_before,
        }
        payload = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
        if args.result_file is not None:
            target = args.result_file
            if not target.is_absolute() or target.suffix.lower() != ".json" or not target.parent.is_dir():
                return 5
            data = payload.encode("utf-8")
            if not 0 < len(data) <= 1024 * 1024:
                return 5
            with target.open("xb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
        else:
            print(payload)
        if pulse is not None:
            pulse.finish()
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
