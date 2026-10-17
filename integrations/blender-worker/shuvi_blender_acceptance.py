"""Opt-in, plan-only end-to-end Blender acceptance recipes.

This module NEVER launches Blender, imports bpy, invokes a subprocess, opens
projects or edits files. It constructs fixed, bounded, real PlanRunner payloads
for three separately owner-approved Shuvi native actions:

  1. model1: create verified mesh, edit geometry, add active camera, save checkpoint.
  2. model2: in SAME persistent session add key light, inspect mesh, edit and save.
  3. render: from a NEW approved session opened on stage2 saved .blend, render
     a bounded CPU still (requires a separate render-enabled session/action).

Each plan must be attached to a fresh native BlenderSessionInspect revision.
The existing Rust-approved session action, not this script, executes it.
"""
from __future__ import annotations

import argparse
import json
import re
from uuid import uuid4

STAGES = ("model1", "model2", "render", "look")
REVISION = re.compile(r"[a-f0-9]{64}\Z", re.ASCII)
MESH_NAME = "Shuvi41ProofMesh"
STAGE1 = "shuvi41-proof-stage1.blend"
STAGE2 = "shuvi41-proof-stage2.blend"
STAGE3 = "shuvi41-proof-render.png"
LOOK = "shuvi41-proof-material.blend"


def step(name: str, operation: str, payload: dict, bindings: list | None = None) -> dict:
    return {
        "name": name,
        "request": {
            "protocol_version": 1, "request_id": str(uuid4()),
            "command_id": str(uuid4()), "operation": operation,
            "payload": payload, "timeout_ms": 15000,
        },
        "bindings": bindings or [],
    }


def bind(source: str, source_path: list, target_path: list) -> dict:
    return {"source_step": source, "source_path": source_path, "target_path": target_path}


def transform() -> dict:
    return {
        "location": [0.0, 0.0, 0.0],
        "rotation_euler": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
    }


def _model1(revision: str) -> list:
    # Small five-vertex pyramid, geometry deliberately non-degenerate.
    mesh = {
        "vertices": [
            [-1.0, -1.0, 0.0], [1.0, -1.0, 0.0],
            [1.0, 1.0, 0.0], [-1.0, 1.0, 0.0], [0.0, 0.0, 1.2],
        ],
        "faces": [
            [3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4],
        ],
    }
    return [
        step("create", "mesh.create", {
            "name": MESH_NAME, "geometry": mesh, "transform": transform(),
            "expected_scene_revision": revision,
        }),
        step("shape", "mesh.translate_vertices", {
            "target": {"object_id": "BOUND_FROM_CREATE", "expected_name": MESH_NAME,
                       "expected_revision": "BOUND_FROM_CREATE"},
            "expected_geometry_revision": "BOUND_FROM_MESH_READ",
            "indices": [4], "delta": [0.0, 0.0, 0.25],
        }, [
            bind("create", ["data", "after", "object", "object_id"], ["target", "object_id"]),
            bind("create", ["data", "after", "object", "revision"], ["target", "expected_revision"]),
            bind("create", ["data", "after", "geometry", "geometry_revision"], ["expected_geometry_revision"]),
        ]),
        step("post_edit_scene", "scene.inspect", {}),
        step("camera", "device.create", {
            "name": "Shuvi41ProofCamera", "kind": "CAMERA",
            "transform": {"location": [4.0, -6.0, 4.0], "rotation_euler": [1.15, 0.0, 0.58], "scale": [1.0, 1.0, 1.0]},
            "settings": {"lens": 50.0, "clip_start": 0.1, "clip_end": 100.0, "make_active": True},
            "expected_scene_revision": "BOUND_FROM_SCENE",
        }, [
            bind("post_edit_scene", ["data", "revision"], ["expected_scene_revision"]),
        ]),
        step("post_camera_scene", "scene.inspect", {}),
        step("checkpoint", "file.checkpoint", {
            "name": STAGE1, "expected_scene_revision": "BOUND_FROM_SCENE",
        }, [
            bind("post_camera_scene", ["data", "revision"], ["expected_scene_revision"]),
        ]),
    ]


def _model2(revision: str) -> list:
    # Exact target name prefix and MESH type. This stage is intentionally
    # designed to reuse the same live controller and its session-local IDs.
    return [
        step("light", "device.create", {
            "name": "Shuvi41ProofKey", "kind": "POINT",
            "transform": {"location": [2.0, -3.0, 5.0], "rotation_euler": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]},
            "settings": {"energy": 950.0, "color": [1.0, 0.94, 0.85]},
            "expected_scene_revision": revision,
        }),
        step("locate", "objects.list", {
            "name_prefix": MESH_NAME, "object_type": "MESH",
            "offset": 0, "limit": 25,
        }),
        step("mesh_read", "mesh.inspect", {"object_id": "BOUND_FROM_LIST"}, [
            bind("locate", ["data", "items", 0, "object_id"], ["object_id"]),
        ]),
        step("shape_again", "mesh.translate_vertices", {
            "target": {"object_id": "BOUND_FROM_LIST", "expected_name": MESH_NAME,
                       "expected_revision": "BOUND_FROM_LIST"},
            "expected_geometry_revision": "BOUND_FROM_MESH_READ",
            "indices": [4], "delta": [0.0, 0.0, 0.5],
        }, [
            bind("locate", ["data", "items", 0, "object_id"], ["target", "object_id"]),
            bind("locate", ["data", "items", 0, "revision"], ["target", "expected_revision"]),
            bind("mesh_read", ["data", "geometry_revision"], ["expected_geometry_revision"]),
        ]),
        step("post_edit_scene", "scene.inspect", {}),
        step("checkpoint", "file.checkpoint", {
            "name": STAGE2, "expected_scene_revision": "BOUND_FROM_SCENE",
        }, [
            bind("post_edit_scene", ["data", "revision"], ["expected_scene_revision"]),
        ]),
    ]


def _look(revision: str) -> list:
    # A supplemental standalone material pass on an explicitly owner-approved,
    # SHA-verified Stage-2 source session. Not the original acceptance chain.
    return [
        step("scene", "scene.inspect", {}),
        step("locate", "objects.list", {
            "name_prefix": MESH_NAME, "object_type": "MESH",
            "offset": 0, "limit": 5, "expected_revision": "BOUND_FROM_SCENE",
        }, [bind("scene", ["data", "revision"], ["expected_revision"])]),
        step("assign", "material.create_assign", {
            "target": {"object_id": "BOUND_FROM_LIST", "expected_name": MESH_NAME,
                       "expected_revision": "BOUND_FROM_LIST"},
            "name": "Shuvi41ProofCopper",
            "base_color": [0.8, 0.41, 0.16, 1.0],
            "metallic": 0.65, "roughness": 0.31,
        }, [
            bind("locate", ["data", "items", 0, "object_id"], ["target", "object_id"]),
            bind("locate", ["data", "items", 0, "revision"], ["target", "expected_revision"]),
        ]),
        step("post_look_scene", "scene.inspect", {}),
        step("checkpoint", "file.checkpoint", {
            "name": LOOK, "expected_scene_revision": "BOUND_FROM_SCENE",
        }, [bind("post_look_scene", ["data", "revision"], ["expected_scene_revision"])]),
    ]


def _render(revision: str) -> list:
    # Model1 saves an active camera and Model2 adds a key light.
    # This stage loads their checkpoint via a new separately approved session.
    return [
        step("configure", "render.configure", {
            "width": 64, "height": 64, "samples": 1,
            "expected_scene_revision": revision,
        }),
        step("configured_scene", "scene.inspect", {}),
        step("render", "render.execute", {
            "name": STAGE3, "expected_scene_revision": "BOUND_FROM_CONFIGURED_SCENE",
        }, [
            bind("configured_scene", ["data", "revision"], ["expected_scene_revision"]),
        ]),
    ]


def build(stage: str, expected_scene_revision: str) -> dict:
    if stage not in STAGES:
        raise ValueError("Unsupported fixed Shuvi Blender acceptance stage")
    if not isinstance(expected_scene_revision, str) or not REVISION.fullmatch(expected_scene_revision):
        raise ValueError("A fresh 64-character lowercase Blender scene revision is required")
    steps = {
        "model1": _model1,
        "model2": _model2,
        "render": _render,
        "look": _look,
    }[stage](expected_scene_revision)
    assert 1 <= len(steps) <= 6
    return {"timeout_ms": 90000, "steps": steps}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a fixed approved Blender acceptance plan. NEVER executes Blender."
    )
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--scene-revision", required=True)
    args = parser.parse_args(argv)
    try:
        plan = build(args.stage, args.scene_revision)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps({
        "mode": "PLAN_ONLY_NO_BLENDER_LAUNCH",
        "stage": args.stage,
        "requires_separate_native_owner_approval": True,
        "must_use_current_session_inspect_revision": True,
        "render_action_approval_required": args.stage == "render",
        "output_file": {"model1": STAGE1, "model2": STAGE2, "render": STAGE3, "look": LOOK}[args.stage],
        "requires_new_session_loading_verified_stage2": args.stage in ("render", "look"),
        "supplementary_not_three_stage_acceptance": args.stage == "look",
        "plan": plan,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
