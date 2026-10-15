"""Independent, bounded readback of a saved .blend in a NEW read-only Blender process.

The Blender bridge owns authentication/process lifecycle.  No source-provided bpy/Python
code is executed. Object IDs and scene revisions are session-local and never compared
across launches; stable visible object fields are compared instead.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

MAX_REOPEN_OBJECTS = 1000
MAX_REOPEN_MESHES = 64
MAX_REOPEN_TOTAL_VERTICES = 8192
MAX_REOPEN_TOTAL_FACES = 8192
PAGE_SIZE = 25
SCENE_FIELDS = (
    "scene", "blender_version", "cursor", "units", "pivot", "world_present",
    "object_count", "object_counts_by_type", "collection_count", "collections",
    "frames", "render",
)
OBJECT_FIELDS = (
    "name", "type", "transform", "dimensions", "visibility", "collections",
    "materials", "material_slot_count", "modifiers", "modifier_count", "camera", "light",
)


def capture_scene(controller, expected_path: Path, *, require_saved_file: bool = True) -> dict:
    """Fingerprint full bounded object paging; deny missing/truncated/unstable reads."""
    from shuvi_blender_agent.contracts import Request, Status

    saved = Path(expected_path).resolve(strict=True)

    def call(operation, payload=None):
        result = controller.execute(Request(operation, payload or {}, timeout_ms=10_000))
        if result.status != Status.SUCCEEDED or not isinstance(result.data, dict):
            raise ValueError("Blender scene readback failed")
        return result.data

    scene = call("scene.inspect")
    # file.checkpoint deliberately preserves the writer's active source file.
    # Only the second process is required to have loaded the saved checkpoint.
    if not isinstance(scene.get("file"), str) or (
        require_saved_file and Path(scene["file"]).resolve(strict=True) != saved
    ):
        raise ValueError("Blender session is not reading the saved checkpoint")
    total = scene.get("object_count")
    if type(total) is not int or not 0 <= total <= MAX_REOPEN_OBJECTS:
        raise ValueError("Blender scene exceeds bounded reopen readback")
    if scene.get("collections_truncated") is not False:
        raise ValueError("Blender collections were truncated during reopen proof")
    if any(key not in scene for key in SCENE_FIELDS):
        raise ValueError("Blender scene summary missing verification fields")
    session_id, revision = scene.get("session_id"), scene.get("revision")
    if not isinstance(session_id, str) or not session_id or not isinstance(revision, str) or len(revision) != 64:
        raise ValueError("Blender scene has no stable readback snapshot")

    objects = []
    mesh_count = 0
    total_vertices = 0
    total_faces = 0
    offset = 0
    # Even an empty scene is explicitly paged to check the object count.
    while True:
        payload = {"offset": offset, "limit": PAGE_SIZE}
        if offset:
            payload["expected_revision"] = revision
        page = call("objects.list", payload)
        items = page.get("items")
        if (page.get("session_id") != session_id or page.get("revision") != revision
                or page.get("total") != total or page.get("offset") != offset
                or not isinstance(items, list) or len(items) > PAGE_SIZE
                or (offset < total and not items)):
            raise ValueError("Blender readback page changed or is malformed")
        for item in items:
            if not isinstance(item, dict) or item.get("details_truncated") is not False:
                raise ValueError("Blender object snapshot was truncated")
            if any(field not in item for field in OBJECT_FIELDS if field not in ("camera", "light")):
                raise ValueError("Blender object readback missing required fields")
            stable = {field: item.get(field) for field in OBJECT_FIELDS}
            if item.get("type") == "MESH":
                # Object names, transforms and counts alone DO NOT prove a
                # modeled mesh survived: read actual vertex/face topology.
                mesh_count += 1
                if mesh_count > MAX_REOPEN_MESHES:
                    raise ValueError("Blender mesh proof exceeds the bounded mesh budget")
                object_id = item.get("object_id")
                if not isinstance(object_id, str) or not object_id.startswith(session_id + ":"):
                    raise ValueError("Blender mesh lacks live session-local object identity")
                geometry = call("mesh.inspect", {"object_id": object_id})
                if geometry.get("object_id") != object_id or geometry.get("name") != item["name"]:
                    raise ValueError("Blender mesh identity changed during geometry inspection")
                vertices, faces = geometry.get("vertices"), geometry.get("faces")
                if (not isinstance(vertices, list) or not isinstance(faces, list)
                        or len(vertices) > 4096 or len(faces) > 4096
                        or any(not isinstance(vertex, list) or len(vertex) != 3
                               or any(type(x) not in (int, float) for x in vertex)
                               for vertex in vertices)
                        or any(not isinstance(face, list) or not 3 <= len(face) <= 32
                               or any(type(x) is not int or x < 0 or x >= len(vertices)
                                      for x in face)
                               for face in faces)):
                    raise ValueError("Blender mesh geometry readback is malformed")
                total_vertices += len(vertices)
                total_faces += len(faces)
                if (total_vertices > MAX_REOPEN_TOTAL_VERTICES
                        or total_faces > MAX_REOPEN_TOTAL_FACES):
                    raise ValueError("Blender mesh geometry proof exceeds total work budget")
                mesh_payload = {"vertices": vertices, "faces": faces}
                geometry_encoded = json.dumps(
                    mesh_payload, sort_keys=True, separators=(",", ":"), allow_nan=False
                ).encode("utf-8")
                digest = hashlib.sha256(geometry_encoded).hexdigest()
                if digest != geometry.get("geometry_revision"):
                    raise ValueError("Blender mesh revision differs from actual geometry")
                stable["geometry_sha256"] = digest
                stable["vertex_count"] = len(vertices)
                stable["face_count"] = len(faces)
            objects.append(stable)
        offset += len(items)
        next_offset = page.get("next_offset")
        if offset == total:
            if next_offset is not None:
                raise ValueError("Unexpected extra Blender readback page")
            break
        if next_offset != offset:
            raise ValueError("Non-contiguous Blender readback pagination")

    # Geometry readback may take multiple calls. Ensure all pages and mesh
    # snapshots belong to one unchanged source revision, not a mixed scene.
    final_scene = call("scene.inspect")
    if (final_scene.get("session_id") != session_id
            or final_scene.get("revision") != revision
            or final_scene.get("object_count") != total):
        raise ValueError("Blender scene changed during geometry proof")

    payload = {
        "scene": {field: scene[field] for field in SCENE_FIELDS},
        "objects": objects,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {"fingerprint": hashlib.sha256(encoded).hexdigest(),
            "object_count": total, "mesh_count": mesh_count,
            "total_vertices": total_vertices, "total_faces": total_faces}


def reopen_checkpoint(blender_exe: Path, saved: Path, original: dict) -> dict:
    """Close the writer first; launch a NEW read-only, authenticated host."""
    from shuvi_blender_agent.client import BlenderController
    from shuvi_blender_agent.process import LaunchConfig, launch
    from shuvi_blender_agent.safety import SafetyPolicy

    with launch(LaunchConfig(
        executable=blender_exe,
        blend_file=saved,
        startup_timeout_ms=15_000,
        policy=SafetyPolicy(),
    )) as session:
        reopened = capture_scene(BlenderController(session.client), saved)
    if reopened != original:
        raise ValueError("Saved Blender checkpoint content differs after independent reopen")
    return {"verified": True, "fingerprint": reopened["fingerprint"],
            "object_count": reopened["object_count"], "read_only": True,
            "mesh_geometry_verified": True, "mesh_count": reopened["mesh_count"],
            "total_vertices": reopened["total_vertices"], "total_faces": reopened["total_faces"]}
