"""Read-only current-byte review of retained Shuvi 41 host-trial outputs.

This does not run Blender or authenticate who produced the unsigned JSON report.
Passing means the five or eight retained on-disk artifacts still match its bounded
historical receipts and checkpoint/session lineage; it does NOT approve a
native Shuvi action, certify visual quality, or prove a real Windows host run.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import struct
from uuid import UUID
import zlib

HEX64 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
STAGES = (
    ("model1", "shuvi41-proof-stage1.blend", "BLEND"),
    ("model2", "shuvi41-proof-stage2.blend", "BLEND"),
    ("render", "shuvi41-proof-render.png", "PNG"),
    ("look", "shuvi41-proof-material.blend", "BLEND"),
    ("look_render", "shuvi41-proof-material-render.png", "PNG"),
)
MOTION_STAGES = (
    ("motion", "shuvi41-proof-motion.blend", "BLEND"),
    ("motion_frame1", "shuvi41-proof-motion-frame001.png", "PNG"),
    ("motion_frame24", "shuvi41-proof-motion-frame024.png", "PNG"),
)
MAX_ARTIFACT = 128 * 1024 * 1024
MAX_PNG = 2 * 1024 * 1024
MAX_REPORT = 65536


def _no_links(path: Path) -> bool:
    for item in (path, *path.parents):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            return False
    return True


def _json_unique(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError("Duplicate key in acceptance report")
        data[key] = value
    return data


def _reject_nonfinite(value):
    raise ValueError("Non-finite acceptance report number: " + value)


def _check_blend(path: Path) -> None:
    with path.open("rb") as handle:
        header = handle.read(12)
    if (len(header) != 12 or header[:7] != b"BLENDER"
            or header[7:8] not in (b"_", b"-")
            or header[8:9] not in (b"v", b"V")
            or not all(48 <= value <= 57 for value in header[9:12])):
        raise ValueError("Checkpoint does not have a real Blender file header")



def _reconstructed_visible_digest(decoded: bytes, channels: int) -> str:
    """Invert PNG row filters, inspect actual RGBA pixels, and hash normalized pixels.

    Strictly bounded to 64x64 RGB/RGBA8. This is a coarse nonblank content
    guard, not model identification, colorimetry, image quality or host proof.
    """
    stride = 64 * channels
    prior = bytearray(stride)
    image_hash = hashlib.sha256()
    visible = 0
    colors = set()
    for y in range(64):
        row_start = y * (stride + 1)
        filter_type = decoded[row_start]
        if filter_type > 4:
            raise ValueError("PNG has an invalid scanline filter")
        row = bytearray(decoded[row_start + 1:row_start + 1 + stride])
        for pos in range(stride):
            left = row[pos - channels] if pos >= channels else 0
            above = prior[pos]
            above_left = prior[pos - channels] if pos >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            else:
                base = left + above - above_left
                dl = abs(base - left)
                da = abs(base - above)
                dc = abs(base - above_left)
                predictor = (left if dl <= da and dl <= dc
                             else above if da <= dc else above_left)
            row[pos] = (row[pos] + predictor) & 0xff
        for pos in range(0, stride, channels):
            rgb = bytes(row[pos:pos + 3])
            alpha = row[pos + 3] if channels == 4 else 255
            image_hash.update(rgb)
            image_hash.update(bytes((alpha,)))
            if alpha:
                visible += 1
                if len(colors) < 2:
                    colors.add(rgb)
        prior = row
    if visible < 16 or len(colors) < 2:
        raise ValueError("Proof PNG lacks nonuniform visible pixel content")
    return image_hash.hexdigest()


def _check_png(path: Path) -> str:
    """Independently decode bounded 64x64 PNG IDAT and check chunk CRC/filter."""
    if path.stat().st_size > MAX_PNG:
        raise ValueError("Fixed render is larger than PNG review budget")
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Proof render is not a PNG")
    position = 8
    channels = 0
    idats = []
    started = False
    ended = False
    complete = False
    while position < len(data):
        if len(data) - position < 12:
            raise ValueError("Truncated PNG chunk")
        length = struct.unpack_from(">I", data, position)[0]
        if length > MAX_PNG or length + 12 > len(data) - position:
            raise ValueError("PNG chunk exceeds bounds")
        kind = data[position + 4:position + 8]
        chunk = data[position + 8:position + 8 + length]
        crc = struct.unpack_from(">I", data, position + 8 + length)[0]
        if zlib.crc32(kind + chunk) & 0xffffffff != crc:
            raise ValueError("PNG chunk CRC disagrees with bytes")
        position += length + 12
        if channels == 0:
            if kind != b"IHDR" or length != 13:
                raise ValueError("PNG must begin with IHDR")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", chunk)
            if ((width, height) != (64, 64) or depth != 8 or color not in (2, 6)
                    or compression or filtering or interlace):
                raise ValueError("Fixed PNG must be 64x64 RGB/RGBA, noninterlaced")
            channels = 3 if color == 2 else 4
        elif kind == b"IHDR":
            raise ValueError("Duplicated PNG header")
        elif kind == b"IDAT":
            if ended:
                raise ValueError("Separated PNG IDAT chunks")
            idats.append(chunk)
            started = True
        elif kind == b"IEND":
            if length or not started or position != len(data):
                raise ValueError("PNG trailer or end chunk invalid")
            complete = True
            break
        else:
            if started:
                ended = True
            if kind == b"PLTE":
                if started or not length or length > 768 or length % 3:
                    raise ValueError("PNG palette invalid")
            elif kind and not kind[0] & 0x20:
                raise ValueError("Unknown critical PNG chunk")
    if not complete:
        raise ValueError("PNG missing valid IEND")
    row_stride = 64 * channels
    expected = 64 * (row_stride + 1)
    decomp = zlib.decompressobj()
    try:
        decoded = decomp.decompress(b"".join(idats), expected + 1)
    except zlib.error as exc:
        raise ValueError("PNG zlib stream cannot be decoded") from exc
    if (len(decoded) != expected or not decomp.eof or decomp.unused_data
            or decomp.unconsumed_tail):
        raise ValueError("PNG zlib scanlines are invalid or oversized")
    return _reconstructed_visible_digest(decoded, channels)


def _check_file(path: Path, digest: str, size: int, kind: str) -> str | None:
    if not path.is_file() or not _no_links(path):
        raise ValueError("Artifact must be an ordinary non-symlink file")
    if type(size) is not int or not 12 <= size <= MAX_ARTIFACT:
        raise ValueError("Invalid artifact size claim")
    if not isinstance(digest, str) or not HEX64.fullmatch(digest):
        raise ValueError("Invalid artifact hash claim")
    if path.stat().st_size != size:
        raise ValueError("Artifact bytes changed since host report")
    pixels_sha = None
    if kind == "BLEND":
        _check_blend(path)
    else:
        pixels_sha = _check_png(path)
    sha = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while block := handle.read(65536):
            total += len(block)
            if total > MAX_ARTIFACT:
                raise ValueError("Artifact exceeded byte budget while hashing")
            sha.update(block)
    if total != size or sha.hexdigest() != digest:
        raise ValueError("Artifact SHA-256 differs from host receipt")
    return pixels_sha


def reverify_artifacts(report: dict, output: Path) -> dict:
    """Recheck the fixed five or opt-in eight files, without host execution."""
    if not isinstance(report, dict):
        raise ValueError("Host report is not an object")
    output = output.resolve(strict=True)
    if not output.is_dir() or not _no_links(output):
        raise ValueError("Host output directory is invalid or linked")
    expected = {
        "schema_version": 1, "kind": "shuvi41_real_blender_upstream_trial",
        "status": "real_blender_upstream_acceptance_passed",
        "probe_only": False, "real_host_acceptance_verified": True,
        "stage1_stage2_same_real_blender_session": True,
        "material_shader_preflight_verified": True,
        "native_shuvi_action_executed": False,
        "native_owner_approval_reauthenticated": False,
        "visual_quality_verified": False, "adobe_import_performed": False,
        "automatic_retry_allowed": False, "output_directory": str(output),
    }
    for key, value in expected.items():
        if type(report.get(key)) is not type(value) or report[key] != value:
            raise ValueError("Host trial report contract mismatch at " + key)
    motion_requested = report.get("motion_pair_requested", False)
    if type(motion_requested) is not bool:
        raise ValueError("Motion pair opt-in report field must be a boolean")
    stages = STAGES + (MOTION_STAGES if motion_requested else ())
    items = report.get("completed_stages")
    if not isinstance(items, list) or len(items) != len(stages):
        raise ValueError("Report does not contain the exact opted-in stage count")
    previous = {}
    first_session = None
    other_sessions = set()
    checked = []
    for receipt, (stage, basename, kind) in zip(items, stages):
        if not isinstance(receipt, dict):
            raise ValueError("Malformed host stage receipt")
        session = receipt.get("blender_session_id")
        if not isinstance(session, str):
            raise ValueError("Missing host session ID")
        try:
            UUID(session)
        except (ValueError, AttributeError) as exc:
            raise ValueError("Invalid host session ID") from exc
        if stage == "model1":
            first_session = session
        elif stage == "model2":
            if session != first_session:
                raise ValueError("Stage 2 must use Stage 1's same host session")
        elif session == first_session or session in other_sessions:
            raise ValueError("Render/look stages require distinct fresh host sessions")
        else:
            other_sessions.add(session)
        if (receipt.get("stage") != stage or receipt.get("status") != "host_file_rehashed"
                or receipt.get("format") != kind
                or receipt.get("independent_blender_reopen_verified") is not (kind == "BLEND")
                or receipt.get("rendered_visual_quality_verified") is not False):
            raise ValueError("Host receipt stage or historical proof type differs")
        if stage == "motion":
            if receipt.get("motion_keyframes_independently_verified") is not True:
                raise ValueError("Motion receipt lacks independently reopened fixed keyframe claim")
        elif "motion_keyframes_independently_verified" in receipt:
            raise ValueError("Non-motion stage may not claim fixed motion keyframe evidence")
        source_role = ("look" if stage == "look_render" else
                       "motion" if stage in ("motion_frame1", "motion_frame24") else
                       "model2")
        source_sha = None if stage in ("model1", "model2") else previous[source_role]
        if receipt.get("input_source_sha256") != source_sha:
            raise ValueError("Host receipt input checkpoint SHA lineage invalid")
        artifact = output / basename
        if receipt.get("file") != str(artifact):
            raise ValueError("Host receipt output path differs from fixed proof location")
        pixels_sha = _check_file(artifact, receipt.get("sha256"), receipt.get("bytes"), kind)
        previous[stage] = receipt["sha256"]
        if pixels_sha is not None:
            previous[stage + "_pixels"] = pixels_sha
        current_receipt = {"stage": stage, "sha256": receipt["sha256"],
                           "bytes": receipt["bytes"], "format": kind}
        if stage == "motion":
            current_receipt["motion_keyframes_reported_reopened"] = True
        if pixels_sha is not None:
            current_receipt["decoded_rgba_sha256"] = pixels_sha
        checked.append(current_receipt)
    # The Copper look pass must actually change at least some decoded pixels;
    # different PNG compression, timestamps or file hashes alone do not count.
    if previous["render_pixels"] == previous["look_render_pixels"]:
        raise ValueError("Copper look render is pixel-identical to base render")
    if motion_requested and previous["motion_frame1_pixels"] == previous["motion_frame24_pixels"]:
        raise ValueError("Motion frames are pixel-identical after decoding actual RGBA pixels")
    return {
        "schema_version": 1,
        "kind": "shuvi41_host_artifact_offline_reverification",
        "current_artifacts_rehashed": True,
        "verified_current_file_count": len(checked),
        "motion_pair_requested": motion_requested,
        "motion_pair_pixels_differ": motion_requested,
        "motion_keyframes_reported_reopened": motion_requested,
        "current_file_receipts": checked,
        "report_is_unsigned_and_mutable": True,
        "historical_blender_execution_independently_authenticated": False,
        "native_shuvi_action_executed": False,
        "visual_quality_verified": False, "adobe_import_performed": False,
        "blender_launch_performed": False,
    }


def verify_report_file(report_path: Path) -> dict:
    """Read-only CLI entry: no Blender, git, subprocess or filesystem writes."""
    if (not report_path.is_absolute() or not report_path.is_file()
            or not _no_links(report_path) or report_path.name != "acceptance-report.json"
            or report_path.stat().st_size > MAX_REPORT):
        raise ValueError("Expected an absolute bounded non-symlink acceptance-report.json")
    with report_path.open("r", encoding="utf-8") as handle:
        report = json.load(handle, object_pairs_hook=_json_unique,
                           parse_constant=_reject_nonfinite)
    return reverify_artifacts(report, report_path.parent)
