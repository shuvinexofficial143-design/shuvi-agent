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
MAX_REOPEN_TOTAL_FACE_INDICES = 32768
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


def _near_vector(actual, expected, *, tolerance=0.0002):
    return (isinstance(actual, (list, tuple)) and len(actual) == len(expected)
            and all(type(value) in (int, float) and abs(value - target) <= tolerance
                    for value, target in zip(actual, expected)))


def _copper_mesh_has_genuine_3d_faces(vertices: list, faces: list) -> bool:
    """Supplementary pyramid look cannot certify a collapsed/flat fake mesh.

    Independent readback verifies actual local-space 3D extent and at
    least five polygons with nonzero area, not merely five face records
    whose SHA may legitimately describe wholly degenerate geometry.
    """
    from math import isfinite

    if len(vertices) < 5 or len(faces) < 5:
        return False
    for axis in range(3):
        values = [point[axis] for point in vertices]
        if (not all(isfinite(v) and abs(v) <= 1_000_000 for v in values)
                or max(values) - min(values) < 0.05):
            return False
    nondegenerate = 0
    seen_polygons = set()
    for face in faces:
        polygon_key = tuple(sorted(face))
        if polygon_key in seen_polygons:
            continue
        seen_polygons.add(polygon_key)
        points = [vertices[i] for i in face]
        origin = points[0]
        normal_area_sq = 0.0
        for index in range(1, len(points) - 1):
            a = [points[index][k] - origin[k] for k in range(3)]
            b = [points[index + 1][k] - origin[k] for k in range(3)]
            cross = [a[1] * b[2] - a[2] * b[1],
                     a[2] * b[0] - a[0] * b[2],
                     a[0] * b[1] - a[1] * b[0]]
            normal_area_sq += sum(component * component for component in cross)
        if normal_area_sq > 1e-10:
            nondegenerate += 1
    return nondegenerate >= 5


def _proof_camera(item, is_active):
    transform, camera = item.get("transform"), item.get("camera")
    visibility = item.get("visibility")
    return (
        is_active and item.get("name") == "Shuvi41ProofCamera"
        and item.get("type") == "CAMERA" and isinstance(camera, dict)
        and isinstance(transform, dict) and isinstance(visibility, dict)
        and visibility.get("hide_render") is False
        and camera.get("type") == "PERSP"
        and _near_vector([camera.get("lens"), camera.get("clip_start"), camera.get("clip_end")],
                         [50.0, 0.1, 100.0])
        and _near_vector(transform.get("location"), [4.0, -6.0, 4.0])
        and _near_vector(transform.get("rotation_euler"), [1.15, 0.0, 0.58])
        and _near_vector(transform.get("scale"), [1.0, 1.0, 1.0])
    )


def _proof_key_light(item):
    transform, light = item.get("transform"), item.get("light")
    visibility = item.get("visibility")
    return (
        item.get("name") == "Shuvi41ProofKey"
        and item.get("type") == "LIGHT" and isinstance(light, dict)
        and isinstance(transform, dict) and isinstance(visibility, dict)
        and visibility.get("hide_render") is False
        and light.get("type") == "POINT"
        and _near_vector([light.get("energy")], [950.0])
        and _near_vector(light.get("color"), [1.0, 0.94, 0.85])
        and _near_vector(transform.get("location"), [2.0, -3.0, 5.0])
    )


def _reopen_page_items(page: dict, *, session_id: str, revision: str,
                       total: int, offset: int, seen_ids: set,
                       seen_names: set) -> list:
    """Check an exact upstream read-only page BEFORE secondary mesh queries.

    Cursor, count, identities, object names and source snapshots must be
    independently verified on every page; a duplicate item must not
    silently displace a missing mesh in a saved-checkpoint fingerprint.
    """
    if not isinstance(page, dict):
        raise ValueError("Blender reopen object page is not a mapping")
    items = page.get("items")
    expected = min(PAGE_SIZE, max(0, total - offset))
    expected_next = offset + PAGE_SIZE if offset + PAGE_SIZE < total else None
    if (page.get("session_id") != session_id
            or page.get("revision") != revision
            or type(page.get("total")) is not int
            or page["total"] != total
            or type(page.get("offset")) is not int
            or page["offset"] != offset
            or not isinstance(items, list)
            or len(items) != expected
            or page.get("next_offset") != expected_next
            or type(page.get("next_offset")) not in (int, type(None))):
        raise ValueError("Blender reopen page length, cursor or scene identity changed")
    current_ids = set()
    current_names = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Blender object page has invalid row type")
        identity, name, kind, object_revision = (
            item.get("object_id"), item.get("name"),
            item.get("type"), item.get("revision"))
        if (not isinstance(identity, str) or not identity.startswith(session_id + ":")
                or not 1 <= len(identity) <= 256
                or identity in seen_ids or identity in current_ids
                or not isinstance(name, str) or not 1 <= len(name) <= 256
                or "\x00" in name or name in seen_names or name in current_names
                or not isinstance(kind, str) or not 1 <= len(kind) <= 32
                or not isinstance(object_revision, str)
                or len(object_revision) != 64
                or any(c not in "0123456789abcdef" for c in object_revision)):
            raise ValueError("Blender reopen object identity, name or revision duplicated or invalid")
        current_ids.add(identity)
        current_names.add(name)
    seen_ids.update(current_ids)
    seen_names.update(current_names)
    return items


def _saved_mesh_metadata(item: dict) -> tuple[int, int, int]:
    """Exact independent typed Blender objects.list Mesh datablock counts.

    Pinned upstream inspector reports data.object_type and vertex/polygon/
    edge counts. Check this before mesh.inspect; then bind its returned
    arrays to the object page, so a valid SHA for the *wrong* geometry
    cannot certify the saved object's mesh.
    """
    data = item.get("data")
    if not isinstance(data, dict) or data.get("object_type") != "MESH":
        raise ValueError("Blender saved mesh lacks authenticated datablock counts")
    counts = []
    for name in ("vertices", "polygons", "edges"):
        value = data.get(name)
        if type(value) is not int or not 0 <= value <= 100_000_000:
            raise ValueError("Blender saved mesh datablock count is malformed")
        counts.append(value)
    if counts[0] > 4096 or counts[1] > 4096:
        raise ValueError("Blender saved mesh exceeds upstream topology readback")
    return tuple(counts)


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
    if (not isinstance(session_id, str) or not 1 <= len(session_id) <= 128
            or not isinstance(revision, str) or len(revision) != 64
            or any(c not in "0123456789abcdef" for c in revision)):
        raise ValueError("Blender scene has no stable readback snapshot")
    expected_type_counts = scene.get("object_counts_by_type")
    if (not isinstance(expected_type_counts, dict)
            or any(not isinstance(kind, str) or not kind
                   or type(count) is not int or count < 0 or count > total
                   for kind, count in expected_type_counts.items())
            or sum(expected_type_counts.values()) != total):
        raise ValueError("Blender scene object-type census is not trustworthy")

    # Scene.camera_id is session-local. Resolve it to a stable named camera
    # from the authenticated, revision-consistent object pages.
    active_id = scene.get("camera_id")
    if active_id is not None and (
        not isinstance(active_id, str) or not active_id.startswith(session_id + ":")
    ):
        raise ValueError("Blender active camera identity is malformed")
    active_camera_name = None
    proof_camera_verified = False
    proof_key_light_verified = False
    proof_copper_meshes_seen = 0
    proof_copper_material_verified_count = 0
    objects = []
    mesh_count = 0
    total_vertices = 0
    total_faces = 0
    total_face_indices = 0
    observed_type_counts = {}
    seen_ids = set()
    seen_names = set()
    offset = 0
    # Even an empty scene is explicitly paged to check the object count.
    while True:
        payload = {"offset": offset, "limit": PAGE_SIZE}
        if offset:
            payload["expected_revision"] = revision
        page = call("objects.list", payload)
        items = _reopen_page_items(
            page, session_id=session_id, revision=revision,
            total=total, offset=offset, seen_ids=seen_ids,
            seen_names=seen_names)
        for item in items:
            kind = item["type"]
            observed_type_counts[kind] = observed_type_counts.get(kind, 0) + 1
            if not isinstance(item, dict) or item.get("details_truncated") is not False:
                raise ValueError("Blender object snapshot was truncated")
            if any(field not in item for field in OBJECT_FIELDS if field not in ("camera", "light")):
                raise ValueError("Blender object readback missing required fields")
            stable = {field: item.get(field) for field in OBJECT_FIELDS}
            if active_id is not None and item.get("object_id") == active_id:
                if active_camera_name is not None or item.get("type") != "CAMERA":
                    raise ValueError("Active Blender camera does not resolve to one camera object")
                active_camera_name = item.get("name")
            if _proof_camera(item, item.get("object_id") == active_id):
                proof_camera_verified = True
            if _proof_key_light(item):
                proof_key_light_verified = True
            if item.get("type") == "MESH":
                # Object names, transforms and counts alone DO NOT prove a
                # modeled mesh survived: read actual vertex/face topology.
                mesh_count += 1
                if mesh_count > MAX_REOPEN_MESHES:
                    raise ValueError("Blender mesh proof exceeds the bounded mesh budget")
                object_id = item.get("object_id")
                if not isinstance(object_id, str) or not object_id.startswith(session_id + ":"):
                    raise ValueError("Blender mesh lacks live session-local object identity")
                metadata_vertices, metadata_faces, _ = _saved_mesh_metadata(item)
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
                if len(vertices) != metadata_vertices or len(faces) != metadata_faces:
                    raise ValueError("Blender saved mesh datablock census contradicts inspected topology")
                if any(len(set(face)) != len(face) for face in faces):
                    raise ValueError("Blender mesh polygon contains a repeated index")
                total_vertices += len(vertices)
                total_faces += len(faces)
                total_face_indices += sum(len(face) for face in faces)
                if (total_vertices > MAX_REOPEN_TOTAL_VERTICES
                        or total_faces > MAX_REOPEN_TOTAL_FACES
                        or total_face_indices > MAX_REOPEN_TOTAL_FACE_INDICES):
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
                if item["name"] == "Shuvi41ProofMesh":
                    proof_copper_meshes_seen += 1
                    if (item["materials"] == ["Shuvi41ProofCopper"]
                            and item["material_slot_count"] == 1
                            and item["visibility"].get("hide_render") is False
                            and _copper_mesh_has_genuine_3d_faces(vertices, faces)):
                        proof_copper_material_verified_count += 1
            objects.append(stable)
        offset += len(items)
        next_offset = page.get("next_offset")
        if offset == total:
            if next_offset is not None:
                raise ValueError("Unexpected extra Blender readback page")
            break
        if next_offset != offset:
            raise ValueError("Non-contiguous Blender readback pagination")

    if active_id is not None and active_camera_name is None:
        raise ValueError("Blender active camera is absent from paged objects")
    if (len(seen_ids) != total or len(seen_names) != total
            or {k: v for k, v in expected_type_counts.items() if v}
               != observed_type_counts):
        raise ValueError("Blender reopen object census differs from paged scene proof")

    proof_copper_material_verified = (
        proof_copper_meshes_seen == 1
        and proof_copper_material_verified_count == 1
    )
    # Require independent typed read-only shader inspection at save/reopen,
    # not merely the material slot name persisted on a particular mesh.
    proof_copper_shader_verified = False
    proof_copper_shader_revision = None
    if saved.name == "shuvi41-proof-material.blend" and proof_copper_material_verified:
        from shuvi_blender_session import verify_shuvi41_copper_shader
        observed_shader = call("material.shader_inspect", {
            "material_name": "Shuvi41ProofCopper"})
        proof_copper_shader_revision = verify_shuvi41_copper_shader(observed_shader)
        proof_copper_shader_verified = True

    # Geometry readback may take multiple calls. Ensure all pages and mesh
    # snapshots belong to one unchanged source revision, not a mixed scene.
    final_scene = call("scene.inspect")
    if (final_scene.get("session_id") != session_id
            or final_scene.get("revision") != revision
            or final_scene.get("object_count") != total):
        raise ValueError("Blender scene changed during geometry proof")

    payload = {
        "scene": {field: scene[field] for field in SCENE_FIELDS},
        "active_camera_name": active_camera_name,
        "objects": objects,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    topology = [(item["name"], item["geometry_sha256"])
                for item in objects if item["type"] == "MESH"]
    topology_bytes = json.dumps(
        topology, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return {"fingerprint": hashlib.sha256(encoded).hexdigest(),
            "mesh_fingerprint": hashlib.sha256(topology_bytes).hexdigest(),
            "object_count": total, "mesh_count": mesh_count,
            "total_vertices": total_vertices, "total_faces": total_faces,
            "active_camera_name": active_camera_name,
            "proof_camera_verified": proof_camera_verified,
            "proof_key_light_verified": proof_key_light_verified,
            "proof_copper_material_verified": proof_copper_material_verified,
             "proof_copper_shader_verified": proof_copper_shader_verified,
             "proof_copper_shader_revision": proof_copper_shader_revision}


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
    if saved.name == "shuvi41-proof-material.blend":
        if (original.get("proof_copper_material_verified") is not True
                or reopened.get("proof_copper_material_verified") is not True
                or reopened.get("proof_copper_shader_verified") is not True
                or original.get("proof_copper_shader_verified") is not True
                or reopened.get("proof_copper_shader_revision") !=
                    original.get("proof_copper_shader_revision")
                or reopened.get("proof_camera_verified") is not True
                or reopened.get("proof_key_light_verified") is not True
                or reopened.get("active_camera_name") != "Shuvi41ProofCamera"):
            raise ValueError("Saved copper material/look, proof camera or light missing after independent reopen")
    return {"verified": True, "fingerprint": reopened["fingerprint"],
            "mesh_fingerprint": reopened["mesh_fingerprint"],
            "object_count": reopened["object_count"], "read_only": True,
            "mesh_geometry_verified": True, "mesh_count": reopened["mesh_count"],
            "total_vertices": reopened["total_vertices"], "total_faces": reopened["total_faces"],
            "active_camera_name": reopened["active_camera_name"],
            "proof_camera_verified": reopened["proof_camera_verified"],
            "proof_key_light_verified": reopened["proof_key_light_verified"],
            "proof_copper_material_verified": reopened["proof_copper_material_verified"],
            "shader_parameters_independently_verified":
                 saved.name == "shuvi41-proof-material.blend"
                 and reopened["proof_copper_shader_verified"] is True,
             "proof_copper_shader_revision": reopened["proof_copper_shader_revision"]}
