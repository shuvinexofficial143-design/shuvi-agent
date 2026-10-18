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
    if not isinstance(message, dict) or set(message) - {"version", "session_id", "op", "plan", "allow_render", "expected_scene_revision", "query"}:
        raise ValueError("Invalid broker command")
    if message.get("version") != 1 or message.get("session_id") != session_id:
        raise ValueError("Broker session identity mismatch")
    operation = message.get("op")
    if operation not in ("ping", "inspect", "objects", "run_plan", "close"):
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
    if operation == "objects":
        if set(message) != {"version", "session_id", "op", "query", "expected_scene_revision"}:
            raise ValueError("Read-only object page needs exact query and revision")
        revision = message["expected_scene_revision"]
        if (not isinstance(revision, str) or len(revision) != 64
                or any(c not in "0123456789abcdef" for c in revision)):
            raise ValueError("Read-only object query requires a fresh lowercase scene revision")
        query = message["query"]
        if (not isinstance(query, dict)
                or set(query) != {"offset", "limit", "name_prefix", "object_type"}
                or type(query["offset"]) is not int or not 0 <= query["offset"] <= 1000
                or type(query["limit"]) is not int or not 1 <= query["limit"] <= 5
                or not isinstance(query["name_prefix"], str)
                or len(query["name_prefix"]) > 80
                or "\x00" in query["name_prefix"]
                or (query["object_type"] is not None
                    and (not isinstance(query["object_type"], str)
                         or not 1 <= len(query["object_type"]) <= 32))):
            raise ValueError("Read-only Blender object query exceeds allowlisted bounds")
        return operation, query, False, revision
    if set(message) != {"version", "session_id", "op"}:
        raise ValueError("Unexpected broker payload")
    return operation, None, False, None


MATERIAL_RENDER_NAME = "shuvi41-proof-material-render.png"
MATERIAL_CHECKPOINT_NAME = "shuvi41-proof-material.blend"


def _is_material_render(plan: object) -> bool:
    """Only the fixed optional material-still output activates this guard."""
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), list):
        return False
    for step in plan["steps"]:
        if not isinstance(step, dict):
            continue
        request = step.get("request")
        if (isinstance(request, dict) and request.get("operation") == "render.execute"
                and isinstance(request.get("payload"), dict)
                and request["payload"].get("name") == MATERIAL_RENDER_NAME):
            return True
    return False


def validate_material_render_source(controller, input_checkpoint: dict | None,
                                    expected_revision: str, allow_render: bool) -> None:
    """Read-only source/scene/material gate before the first render mutation.

    Exact, source-hashed sample look only. Material SLOT NAME is verified, not
    internal Principled BSDF shader parameters (upstream page lacks those).
    """
    from shuvi_blender_agent.contracts import Request, Status
    from shuvi_blender_reopen import _proof_camera, _proof_key_light

    if not allow_render:
        raise ValueError("Material render requires explicit rendering approval")
    if (not isinstance(input_checkpoint, dict)
            or input_checkpoint.get("verified_loaded_file_path") is not True
            or input_checkpoint.get("loaded_file_hash_checked") is not True
            or not isinstance(input_checkpoint.get("path"), str)
            or Path(input_checkpoint["path"]).name != MATERIAL_CHECKPOINT_NAME
            or not isinstance(input_checkpoint.get("sha256"), str)):
        raise ValueError("Material render must load authenticated material checkpoint")
    # The source is pinned from the authenticated broker startup. Rehash its
    # bytes before every optional render to detect changes in long sessions.
    current_source = inspect_input_source(Path(input_checkpoint["path"]),
                                          input_checkpoint["sha256"])
    if current_source != input_checkpoint:
        raise ValueError("Material checkpoint changed after session startup")

    def read(operation, payload=None):
        result = controller.execute(Request(operation, payload or {}, timeout_ms=10_000))
        if result.status != Status.SUCCEEDED or not isinstance(result.data, dict):
            raise ValueError("Material render preflight readback failed")
        return result.data

    scene = read("scene.inspect")
    session, revision = scene.get("session_id"), scene.get("revision")
    if (not isinstance(session, str) or not session
            or revision != expected_revision or
            not isinstance(scene.get("file"), str)
            or Path(scene["file"]).resolve(strict=True)
               != Path(input_checkpoint["path"]).resolve(strict=True)):
        raise ValueError("Material render session or source scene is stale")
    camera_id = scene.get("camera_id")
    if not isinstance(camera_id, str) or not camera_id.startswith(session + ":"):
        raise ValueError("Material render has no authenticated active camera")

    expected = (
        ("Shuvi41ProofMesh", "MESH"),
        ("Shuvi41ProofCamera", "CAMERA"),
        ("Shuvi41ProofKey", "LIGHT"),
    )
    found = {}
    for name, kind in expected:
        page = read("objects.list", {
            "offset": 0, "limit": 5, "name_prefix": name,
            "object_type": kind, "expected_revision": revision,
        })
        items = page.get("items")
        if (page.get("session_id") != session or page.get("revision") != revision
                or page.get("offset") != 0 or page.get("total") != 1
                or page.get("next_offset") is not None or
                not isinstance(items, list) or len(items) != 1):
            raise ValueError("Material render named object proof missing or ambiguous")
        obj = items[0]
        if (not isinstance(obj, dict) or obj.get("name") != name
                or obj.get("type") != kind or obj.get("details_truncated") is not False
                or not isinstance(obj.get("object_id"), str)
                or not obj["object_id"].startswith(session + ":")):
            raise ValueError("Material render object identity proof invalid")
        found[kind] = obj

    mesh = found["MESH"]
    if (mesh.get("materials") != ["Shuvi41ProofCopper"]
            or mesh.get("material_slot_count") != 1
            or not isinstance(mesh.get("visibility"), dict)
            or mesh["visibility"].get("hide_render") is not False):
        raise ValueError("Material render requires one persisted copper material slot")
    if not _proof_camera(found["CAMERA"], found["CAMERA"]["object_id"] == camera_id):
        raise ValueError("Material render proof camera missing or inactive")
    if not _proof_key_light(found["LIGHT"]):
        raise ValueError("Material render proof key light missing")

    final = read("scene.inspect")
    if (final.get("revision") != revision or final.get("session_id") != session
            or final.get("camera_id") != camera_id):
        raise ValueError("Material render scene changed during preflight")
    # Pre-mutation evidence only. This is NOT a render result, a shader-node
    # attestation or the approval itself. Native Rust rechecks these fields.
    return {
        "schema_version": 1, "verified": True, "read_only_preflight": True,
        "session_id": session, "source_scene_revision": revision,
        "source_blend_path": input_checkpoint["path"],
        "source_sha256": input_checkpoint["sha256"],
        "source_bytes": input_checkpoint["bytes"],
        "mesh_name": "Shuvi41ProofMesh",
        "material_slot_name": "Shuvi41ProofCopper",
        "active_camera_name": "Shuvi41ProofCamera",
        "key_light_name": "Shuvi41ProofKey",
        "shader_parameters_independently_verified": False,
        "render_completed_by_preflight": False,
        "approval_reauthenticated_by_preflight": False,
    }


def require_complete_step_report(plan, report):
    """Validate a completed PlanRunner transcript before any delivery claim.

    Upstream PlanRunner normally supplies exactly one Result for every typed
    step. Never trust only its boolean completed flag or a verified final
    output: all distinct declared step names must have an observed successful
    result and there must be no remaining steps.
    """
    from shuvi_blender_agent.contracts import Status
    steps = getattr(plan, "steps", ())
    names = [step.name for step in steps]
    results = getattr(report, "results", None)
    if (not getattr(report, "completed", False)
            or not isinstance(results, dict)
            or not names or len(names) > 6
            or len(set(names)) != len(names)
            or len(results) != len(names)
            or set(results) != set(names)
            or getattr(report, "unexecuted_steps", ())):
        raise ValueError("Blender PlanRunner transcript lacks all approved typed steps")
    for name in names:
        result = results[name]
        if getattr(result, "status", None) not in (Status.SUCCEEDED, Status.VERIFIED):
            raise ValueError("Blender PlanRunner transcript contains an unverified or failed step")
    return len(names)


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
    executed_steps = require_complete_step_report(plan, report)
    last = report.results.get(final_step.name)
    if last is None or last.status != Status.VERIFIED:
        raise ValueError("Plan partially executed or output not verified")
    if not isinstance(last.data, dict) or not isinstance(last.data.get("after"), dict):
        raise ValueError("Final output evidence missing")
    receipt = last.data["after"]
    kind = "BLEND" if final_step.request.operation == "file.checkpoint" else "PNG"
    extension = ".blend" if kind == "BLEND" else ".png"
    # A verified file in the right directory is insufficient when its name
    # differs from the already-approved PlanRunner typed destination.
    expected_name = final_step.request.payload.get("name")
    if (not isinstance(expected_name, str) or not expected_name
            or Path(expected_name).name != expected_name
            or "/" in expected_name or "\\" in expected_name
            or not expected_name.lower().endswith(extension)):
        raise ValueError("Approved persistent plan output filename is invalid")
    actual = Path(receipt["path"]).resolve(strict=True)
    if (actual.name != expected_name
            or actual.suffix.lower() != extension
            or actual.parent != output_dir.resolve(strict=True)):
        raise ValueError("Blender output file does not match approved plan destination")
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
        "checkpoint_reopen": reopened, "executed_steps": executed_steps,
        "final_operation": final_step.request.operation,
        "render_approved": allow_render, "destructive_allowed": False,
        "authenticated_blender_plan": True,
    }


def bounded_object_details(item: dict) -> dict:
    """Conservative projection of an authenticated upstream objects.list item.

    This is NOT topology/shader proof. Details can be unavailable for older or
    truncated upstream sources, but never silently converted into guessed
    values. Malformed available data is rejected rather than misrepresented.
    """
    from math import isfinite

    truncated = item.get("details_truncated")
    if type(truncated) is not bool:
        raise ValueError("Blender object inspection truncation flag is missing")
    fields = ("transform", "dimensions", "visibility", "materials",
              "material_slot_count", "modifiers", "modifier_count")
    present = [field in item for field in fields]
    if truncated:
        return {"details_available": False, "details_truncated": True}
    if not any(present):
        # Compatibility with prior read-only minimal synthetic sources.
        return {"details_available": False, "details_truncated": False}
    if not all(present):
        raise ValueError("Blender object inspection fields are incomplete")
    def vec(value):
        if (not isinstance(value, (list, tuple)) or len(value) != 3
                or any(type(n) not in (float, int) or
                       not isfinite(n) or abs(n) > 1_000_000 for n in value)):
            raise ValueError("Blender transform or dimension vector is malformed")
        return [float(n) for n in value]
    def name(value):
        if (not isinstance(value, str) or not 1 <= len(value) <= 128
                or "\x00" in value or any(ord(c) < 32 for c in value)):
            raise ValueError("Blender object material/modifier name is malformed")
        return value
    transform,visibility=item["transform"],item["visibility"]
    if (not isinstance(transform, dict) or not isinstance(visibility, dict)
            or type(visibility.get("hide_render")) is not bool
            or type(visibility.get("hide_viewport")) is not bool):
        raise ValueError("Blender object transform/visibility is malformed")
    materials,modifiers=item["materials"],item["modifiers"]
    if (not isinstance(materials, list)
            or type(item["material_slot_count"]) is not int
            or item["material_slot_count"] != len(materials)
            or not isinstance(modifiers, list)
            or type(item["modifier_count"]) is not int
            or item["modifier_count"] != len(modifiers)):
        raise ValueError("Blender material/modifier counts are inconsistent")
    if len(materials) > 16 or len(modifiers) > 16:
        return {"details_available": False, "details_truncated": True}
    if any(m is not None and not isinstance(m, str) for m in materials):
        raise ValueError("Blender material slot is malformed")
    clean_materials = [name(m) if m is not None else None for m in materials]
    clean_modifiers = []
    for mod in modifiers:
        if (not isinstance(mod, dict)
                or type(mod.get("show_render")) is not bool):
            raise ValueError("Blender modifier snapshot is malformed")
        clean_modifiers.append({"name": name(mod.get("name")),
                                "type": name(mod.get("type")),
                                "show_render": mod["show_render"]})
    details = {
        "location": vec(transform.get("location")),
        "rotation_euler": vec(transform.get("rotation_euler")),
        "scale": vec(transform.get("scale")),
        "dimensions": vec(item["dimensions"]),
        "hide_render": visibility["hide_render"],
        "hide_viewport": visibility["hide_viewport"],
        "materials": clean_materials,
        "material_slot_count": len(clean_materials),
        "modifiers": clean_modifiers,
        "modifier_count": len(clean_modifiers),
    }
    kind = item.get("type")
    if kind == "CAMERA":
        camera = item.get("camera")
        if not isinstance(camera, dict) or camera.get("type") not in ("PERSP", "ORTHO", "PANO"):
            raise ValueError("Blender read-only camera properties missing")
        for property_name in ("lens", "clip_start", "clip_end"):
            n = camera.get(property_name)
            if type(n) not in (int, float) or not isfinite(n) or n <= 0 or n > 100000:
                raise ValueError("Blender camera optics are unbounded")
        details["camera"] = {"type": camera["type"],
                             "lens": float(camera["lens"]),
                             "clip_start": float(camera["clip_start"]),
                             "clip_end": float(camera["clip_end"])}
    if kind == "LIGHT":
        light = item.get("light")
        if not isinstance(light, dict) or light.get("type") not in ("POINT", "SUN", "SPOT", "AREA"):
            raise ValueError("Blender read-only light properties missing")
        energy = light.get("energy")
        if type(energy) not in (int, float) or not isfinite(energy) or not 0 <= energy <= 1_000_000:
            raise ValueError("Blender light energy is unbounded")
        details["light"] = {"type": light["type"], "energy": float(energy),
                             "color": vec(light.get("color"))}
    return {"details_available": True, "details_truncated": False,
            "details": details,
            "shader_nodes_inspected": False,
            "mesh_topology_inspected": False}


def native_mesh_binary_commitment(vertices: list, faces: list) -> str:
    """Stable cross-language SHA-256 of the full geometry, independent of
    JSON floating-point formatting. This is not an upstream shader digest.
    Every coordinate is finite binary64; face indices are unsigned u32.
    """
    import struct

    h = hashlib.sha256()
    h.update(b"SHUVI41-MESH-NATIVE-V1" + bytes([0]))
    h.update(struct.pack(">I", len(vertices)))
    for xyz in vertices:
        for value in xyz:
            h.update(struct.pack(">d", float(value)))
    h.update(struct.pack(">I", len(faces)))
    for face in faces:
        h.update(struct.pack(">I", len(face)))
        for index in face:
            h.update(struct.pack(">I", index))
    return h.hexdigest()


def verify_object_page_contract(page: dict, query: dict, session_id: str,
                                revision: str) -> None:
    """Validate real upstream paging, filters, and unique object identities
    BEFORE any secondary mesh.inspect call can run.
    """
    if (page.get("session_id") != session_id
            or page.get("revision") != revision
            or type(page.get("offset")) is not int
            or page["offset"] != query["offset"]
            or type(page.get("total")) is not int
            or not 0 <= page["total"] <= 10000
            or not isinstance(page.get("items"), list)):
        raise ValueError("Blender object page does not match fresh scene identity")
    offset, limit, total = query["offset"], query["limit"], page["total"]
    expected_count = min(limit, max(0, total - offset))
    expected_next = offset + limit if offset + limit < total else None
    if (len(page["items"]) != expected_count
            or type(page.get("next_offset")) not in (int, type(None))
            or page.get("next_offset") != expected_next):
        raise ValueError("Blender object page continuation does not match approved bounds")
    seen = set()
    for item in page["items"]:
        if not isinstance(item, dict):
            raise ValueError("Invalid Blender object page item")
        object_id, name, kind, record_revision = (
            item.get("object_id"), item.get("name"),
            item.get("type"), item.get("revision"))
        if (not isinstance(object_id, str)
                or not object_id.startswith(session_id + ":")
                or object_id in seen
                or not isinstance(name, str) or not 1 <= len(name) <= 256
                or not name.startswith(query["name_prefix"])
                or not isinstance(kind, str) or not 1 <= len(kind) <= 32
                or (query["object_type"] is not None
                    and kind != query["object_type"])
                or not isinstance(record_revision, str)
                or len(record_revision) != 64
                or any(c not in "0123456789abcdef" for c in record_revision)):
            raise ValueError("Blender object page identity/filter/uniqueness failed")
        seen.add(object_id)


def authenticated_mesh_counts(item: dict) -> dict | None:
    """Read authoritative Blender mesh metadata from the existing object page.

    These are counts only. They neither prove mesh topology nor constitute
    consent to edit. Older minimal snapshots may omit the data member.
    """
    if "data" not in item:
        return None
    data = item["data"]
    if not isinstance(data, dict) or data.get("object_type") != "MESH":
        raise ValueError("Blender object mesh metadata has the wrong data type")
    for key in ("vertices", "polygons", "edges"):
        value = data.get(key)
        if type(value) is not int or not 0 <= value <= 100_000_000:
            raise ValueError("Blender mesh metadata count is not trustworthy")
    return {"vertex_count": data["vertices"], "face_count": data["polygons"],
            "edge_count": data["edges"], "source": "authenticated_objects_list",
            "topology_verified_by_counts": False}


def read_bounded_mesh_topology(controller, item: dict, session_id: str) -> dict:
    """Read-only bounded mesh inspection and truthful large-mesh fallback.

    Meshes > pinned upstream 4096 vertex/face limit skip mesh.inspect
    altogether and retain counts from the authenticated object snapshot.
    Up to that upstream limit, inspect *all* geometry, SHA-check it in the
    broker, and transmit full small geometry or a compact preview only.
    """
    from math import isfinite
    from shuvi_blender_agent.contracts import Request, Status

    identity = item["object_id"]
    if not isinstance(identity, str) or not identity.startswith(session_id + ":"):
        raise ValueError("Mesh inspection object identity is stale")
    counts = authenticated_mesh_counts(item)
    metadata = {"mesh_counts_available": counts is not None, "mesh_counts": counts}
    if counts is not None and (counts["vertex_count"] > 4096
                              or counts["face_count"] > 4096
                              or counts["vertex_count"] < 3
                              or counts["face_count"] < 1):
        return {**metadata, "mesh_topology_inspected": False,
                "geometry_available": False, "geometry_truncated": True,
                "mesh_geometry_summary": None, "mesh_overview_available": False,
                "mesh_overview": None,
                "mesh_inspection_skipped": "upstream_geometry_limit"
                    if counts["vertex_count"] > 4096 or counts["face_count"] > 4096
                    else "empty_or_degenerate_mesh"}

    result = controller.execute(Request(
        "mesh.inspect", {"object_id": identity}, timeout_ms=10_000))
    if result.status != Status.SUCCEEDED or not isinstance(result.data, dict):
        raise ValueError("Authenticated mesh.inspect failed or exceeded upstream limits")
    mesh = result.data
    if mesh.get("object_id") != identity or mesh.get("name") != item["name"]:
        raise ValueError("Mesh geometry readback belongs to a different object")
    vertices, faces = mesh.get("vertices"), mesh.get("faces")
    if (not isinstance(vertices, list) or not 3 <= len(vertices) <= 4096
            or not isinstance(faces, list) or not 1 <= len(faces) <= 4096):
        raise ValueError("Mesh geometry readback has invalid counts")
    if counts is not None and (counts["vertex_count"] != len(vertices)
                               or counts["face_count"] != len(faces)):
        raise ValueError("Mesh object metadata differs from actual mesh topology")
    loops = sum(len(face) if isinstance(face, list) else 32769 for face in faces)
    if loops > 32768:
        raise ValueError("Mesh polygon loops exceed bounded upstream contract")
    for vertex in vertices:
        if (not isinstance(vertex, list) or len(vertex) != 3
                or any(type(n) not in (int, float) or not isfinite(n)
                       or abs(n) > 1_000_000 for n in vertex)):
            raise ValueError("Mesh read-only vertex coordinates are invalid")
    for face in faces:
        if (not isinstance(face, list) or not 3 <= len(face) <= 32
                or any(type(index) is not int or not 0 <= index < len(vertices)
                       for index in face) or len(set(face)) != len(face)):
            raise ValueError("Mesh read-only face references are invalid")
    canonical = json.dumps({"vertices": vertices, "faces": faces},
                           sort_keys=True, separators=(",", ":"),
                           allow_nan=False).encode("utf-8")
    calculated = hashlib.sha256(canonical).hexdigest()
    if mesh.get("geometry_revision") != calculated:
        raise ValueError("Mesh read-only topology digest differs from actual vertices/faces")
    if len(vertices) <= 128 and len(faces) <= 128 and loops <= 512:
        return {**metadata, "mesh_topology_inspected": True, "geometry_available": True,
                "geometry_truncated": False, "mesh_overview_available": False,
                "mesh_overview": None, "mesh_inspection_skipped": None,
                "mesh_geometry_summary": {
                    "vertex_count": len(vertices), "face_count": len(faces),
                    "vertices": vertices, "faces": faces, "geometry_sha256": calculated,
                    "digest_checked_in_authenticated_broker": True,
                    "native_digest_recomputed": False,
                    "native_binary_commitment_sha256":
                        native_mesh_binary_commitment(vertices, faces),
                    "native_binary_commitment_recomputed": False}}
    bounds_min = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
    bounds_max = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
    return {**metadata, "mesh_topology_inspected": False, "geometry_available": False,
            "geometry_truncated": True, "mesh_geometry_summary": None,
            "mesh_overview_available": True, "mesh_inspection_skipped": None,
            "mesh_overview": {
                "vertex_count": len(vertices), "face_count": len(faces),
                "face_index_count": loops,
                "bounds_min": bounds_min, "bounds_max": bounds_max,
                "geometry_sha256": calculated,
                "digest_checked_in_authenticated_broker": True,
                "native_digest_recomputed": False,
                "complete_source_validated_in_broker": True,
                "full_vertex_face_arrays_transferred": False}}


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
                    preflight = None
                    if _is_material_render(payload):
                        preflight = validate_material_render_source(
                            controller, source_before, expected_revision, request_allow_render
                        )
                    result = checked_plan(controller, payload, args.output_dir,
                                          args.blender_exe, request_allow_render, expected_revision)
                    # The evidence is emitted only AFTER an actual verified
                    # output, never as a stand-alone or premature success.
                    if preflight is not None:
                        result["material_render_preflight"] = preflight
                    protocol({"version": 1, "session_id": session_id, **result})
                    continue
                if operation == "objects":
                    from shuvi_blender_agent.contracts import Request
                    result = controller.execute(Request("objects.list", payload={
                        "offset": payload["offset"], "limit": payload["limit"],
                        "name_prefix": payload["name_prefix"],
                        "object_type": payload["object_type"],
                        "expected_revision": expected_revision,
                    }, timeout_ms=10000))
                    if result.status != Status.SUCCEEDED or not isinstance(result.data, dict):
                        raise ValueError("Authenticated Blender object page failed")
                    page = result.data
                    verify_object_page_contract(
                        page, payload, session_id, expected_revision)
                    objects = []
                    for item in page["items"]:
                        if not isinstance(item, dict):
                            raise ValueError("Invalid Blender object page item")
                        obj_id, name, kind, rev = (
                            item.get("object_id"), item.get("name"),
                            item.get("type"), item.get("revision"))
                        if (not isinstance(obj_id, str)
                                or not obj_id.startswith(session_id + ":")
                                or not isinstance(name, str) or len(name) > 256
                                or not isinstance(kind, str) or len(kind) > 32
                                or not isinstance(rev, str) or len(rev) != 64):
                            raise ValueError("Blender object page item identity is invalid")
                        observed = bounded_object_details(item)
                        # The old minimal object response remains supported,
                        # without an invented topology claim.
                        if kind == "MESH" and observed["details_available"]:
                            observed.update(read_bounded_mesh_topology(
                                controller, item, session_id))
                        objects.append({
                            "object_id": obj_id, "name": name,
                            "type": kind, "revision": rev,
                            **observed,
                        })
                    # Mesh reads cross multiple authenticated requests.
                    # Reject mixed scene revisions rather than giving stale
                    # geometry to an AI planning a follow-up mutation.
                    if any(row.get("geometry_available") is True or row.get("mesh_overview_available") is True or row.get("mesh_counts_available") is True for row in objects):
                        final_scene = controller.execute(Request(
                            "scene.inspect", timeout_ms=10_000))
                        if (final_scene.status != Status.SUCCEEDED
                                or not isinstance(final_scene.data, dict)
                                or final_scene.data.get("session_id") != session_id
                                or final_scene.data.get("revision") != expected_revision):
                            raise ValueError("Blender scene changed during read-only geometry page")
                    protocol({"version": 1, "status": "alive", "session_id": session_id,
                              "operation": "objects", "scene_revision": expected_revision,
                              "total": page["total"], "offset": payload["offset"],
                              "next_offset": page.get("next_offset"),
                              "objects": objects, "read_only": True})
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
