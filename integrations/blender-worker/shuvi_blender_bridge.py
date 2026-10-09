"""Main Shuvi -> separate shuvi_blender_agent: read-only authenticated host adapter.

Invoked ONLY by Rust's permission-gated blender_inspect tool. This is not
a general script executor. No arbitrary bpy/Python, mutation, save or render.
Blender runs in an owned background child with a loopback authenticated bridge.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="shuvi-blender-readonly-worker")
    parser.add_argument("--blender-exe", required=True, type=Path)
    parser.add_argument("--blend-file", type=Path)
    parser.add_argument("--operation", required=True, choices=("scene.inspect", "system.capabilities"))
    args = parser.parse_args(argv)

    if not args.blender_exe.is_absolute() or not args.blender_exe.is_file():
        parser.error("An existing absolute Blender executable is required")
    if args.blend_file is not None and (
        not args.blend_file.is_absolute()
        or not args.blend_file.is_file()
        or args.blend_file.suffix.lower() != ".blend"
    ):
        parser.error("An existing absolute .blend file is required")

    try:
        from shuvi_blender_agent.client import BlenderController
        from shuvi_blender_agent.contracts import Request, Status
        from shuvi_blender_agent.process import LaunchConfig, launch
        from shuvi_blender_agent.safety import SafetyPolicy
    except ImportError:
        print(json.dumps({"status": "failed", "error": "Blender worker package is not installed; no Blender action was attempted."}))
        return 2

    try:
        # Default SafetyPolicy denies every mutation, file write and render.
        with launch(LaunchConfig(
            executable=args.blender_exe,
            blend_file=args.blend_file,
            startup_timeout_ms=15_000,
            policy=SafetyPolicy(),
        )) as session:
            controller = BlenderController(session.client)
            if args.operation == "system.capabilities":
                catalog = controller.capabilities()
                data = {"operations": catalog, "read_only_policy": True}
                status = "succeeded"
            else:
                result = controller.execute(Request("scene.inspect", timeout_ms=10_000))
                data = result.data
                status = result.status.value
            if status != Status.SUCCEEDED.value:
                print(json.dumps({"status": "failed", "error": "Authenticated Blender host inspection failed; no mutation attempted."}))
                return 3
            print(json.dumps({
                "protocol_version": 1, "operation": args.operation,
                "status": status, "data": data,
                "authenticated_bridge_roundtrip": True,
                "mutations_allowed": False,
                "rendering_allowed": False,
            }, ensure_ascii=False, separators=(",", ":")))
            return 0
    except Exception:
        # Never print traceback/env containing bridge tokens or file identities.
        print(json.dumps({
            "status": "failed",
            "error": "Blender worker launch or inspection failed; host state must be inspected before retry.",
        }))
        return 4


if __name__ == "__main__":
    sys.exit(main())
