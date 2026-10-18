"""Persistent broker fixture tests. No actual Blender/Windows process is launched."""
import hashlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import shuvi_blender_session as worker


SESSION_ID = "f3933170-cc01-4c20-8079-b4dbd72b93ad"


class FakeRequest:
    def __init__(self, operation, payload=None, timeout_ms=10000):
        self.operation = operation
        self.payload = payload or {}


class FakeResult:
    def __init__(self, status, data):
        self.status, self.data = status, data


class FakeController:
    clients = []
    loaded_file = None
    def __init__(self, client):
        self.clients.append(client)

    def execute(self, request):
        if request.operation == "scene.inspect":
            return FakeResult("succeeded", {"session_id": SESSION_ID,
                                            "revision": "f" * 64, "object_count": 2,
                                            "file": FakeController.loaded_file or ""})
        if request.operation == "system.ping":
            return FakeResult("succeeded", {"ready": True})
        if request.operation == "objects.list":
            return FakeResult("succeeded", {
                "session_id": SESSION_ID, "revision": "f" * 64,
                "offset": request.payload["offset"], "total": 2,
                "next_offset": None,
                "items": [
                    {"object_id": SESSION_ID + ":mesh-one", "name": "ShuviMesh",
                     "type": "MESH", "revision": "a" * 64, "details_truncated": False},
                    {"object_id": SESSION_ID + ":camera", "name": "ShuviCamera",
                     "type": "CAMERA", "revision": "b" * 64, "details_truncated": False},
                ],
            })
        raise AssertionError("Unapproved fake operation")


class FakeSession:
    def __init__(self):
        self.client = object()
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True


class PersistentSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.blender = self.root / "blender.exe"
        self.blender.write_bytes(b"fixed fixture")
        self.output = self.root / "out"
        self.output.mkdir()
        self.sessions = []
        self.launch_configs = []
        cls = self
        packages = {
            "shuvi_blender_agent": types.ModuleType("shuvi_blender_agent"),
            "shuvi_blender_agent.client": types.ModuleType("shuvi_blender_agent.client"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
            "shuvi_blender_agent.process": types.ModuleType("shuvi_blender_agent.process"),
            "shuvi_blender_agent.safety": types.ModuleType("shuvi_blender_agent.safety"),
        }
        class SafetyPolicy:
            def __init__(self, **kwargs):
                self.permissions = kwargs

        class LaunchConfig:
            def __init__(self, **kwargs):
                cls.launch_configs.append(kwargs)

        def launch(_cfg):
            session = FakeSession()
            cls.sessions.append(session)
            return session

        packages["shuvi_blender_agent.client"].BlenderController = FakeController
        packages["shuvi_blender_agent.contracts"].Request = FakeRequest
        packages["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(SUCCEEDED="succeeded", VERIFIED="verified")
        packages["shuvi_blender_agent.process"].LaunchConfig = LaunchConfig
        packages["shuvi_blender_agent.process"].launch = launch
        packages["shuvi_blender_agent.safety"].SafetyPolicy = SafetyPolicy
        self.stub = patch.dict(sys.modules, packages)
        self.stub.start()
        self.addCleanup(self.stub.stop)
        FakeController.clients.clear()
        FakeController.loaded_file = None
        self.source_input = None

    def args(self, allow_render=False):
        out = ["--blender-exe", str(self.blender), "--output-dir", str(self.output)]
        if allow_render:
            out.append("--allow-render")
        if self.source_input is not None:
            path, digest = self.source_input
            out.extend(["--blend-file", str(path), "--expected-blend-sha256", digest])
        return out

    def frame(self, op, **kwargs):
        if op == "run_plan" and "expected_scene_revision" not in kwargs:
            kwargs["expected_scene_revision"] = "f" * 64
        return json.dumps({"version": 1, "session_id": SESSION_ID,
                           "op": op, **kwargs}) + "\n"

    def serve(self, frames, *, allow_render=False, fake_plan=None):
        stdout = io.StringIO()
        armed = '{"version":1,"op":"arm"}' + "\n" + frames
        stdin = types.SimpleNamespace(buffer=io.BytesIO(armed.encode("utf-8")))
        with patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout):
            if fake_plan is None:
                code = worker.serve(self.args(allow_render))
            else:
                with patch.object(worker, "checked_plan", fake_plan):
                    code = worker.serve(self.args(allow_render))
        replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
        return code, replies

    def test_reject_unknown_operation(self):
        with self.assertRaisesRegex(ValueError, "not supported"):
            worker.validate({"version": 1, "session_id": SESSION_ID, "op": "exec"}, SESSION_ID)

    def test_reject_wrong_session(self):
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            worker.validate(json.loads(self.frame("ping",).strip().replace(SESSION_ID, "wrong")), SESSION_ID)

    def test_reject_extra_mutation_or_payload(self):
        with self.assertRaisesRegex(ValueError, "Invalid broker command"):
            worker.validate({"version": 1, "session_id": SESSION_ID,
                             "op": "ping", "python": "print('unsafe')"}, SESSION_ID)

    def test_render_approval_must_be_explicit_bool(self):
        with self.assertRaisesRegex(ValueError, "explicit boolean"):
            worker.validate({"version": 1, "session_id": SESSION_ID, "op": "run_plan",
                             "plan": {}, "allow_render": 1,
                             "expected_scene_revision": "f" * 64}, SESSION_ID)

    def test_real_command_sequence_reuses_one_owned_fixture_session(self):
        code, replies = self.serve(self.frame("ping") + self.frame("inspect") + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies],
                         ["ready", "alive", "alive", "closing"])
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)
        self.assertEqual(len(FakeController.clients), 1)
        self.assertFalse(self.launch_configs[0]["policy"].permissions["allow_destructive"])

    def test_multiple_approved_plans_share_one_session_and_close(self):
        calls = []
        def plan(controller, data, root, executable, render, expected_revision):
            calls.append((id(controller), data, render, expected_revision))
            return {"status": "verified", "complete": True, "artifact": {"sha256": "a"*64}}
        inputs = (self.frame("run_plan", plan={"steps": ["first"]}, allow_render=False)
                  + self.frame("run_plan", plan={"steps": ["second"]}, allow_render=False)
                  + self.frame("close"))
        code, replies = self.serve(inputs, fake_plan=plan)
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies], ["ready", "verified", "verified", "closing"])
        self.assertEqual([r[1]["steps"][0] for r in calls], ["first", "second"])
        self.assertEqual(calls[0][0], calls[1][0])
        self.assertEqual(calls[0][3], "f" * 64)
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_render_above_session_ceiling_fails_before_dispatch(self):
        calls = []
        def plan(*args):
            calls.append(args)
        code, replies = self.serve(self.frame("run_plan", plan={}, allow_render=True),
                                   fake_plan=plan)
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertFalse(replies[-1]["retry_automatically"])
        self.assertEqual(calls, [])
        self.assertTrue(self.sessions[0].closed)

    def test_failed_plan_does_not_run_later_queued_commands(self):
        calls = []
        def plan(*args):
            calls.append(True)
            raise ValueError("Simulated partial side-effect; not safe to retry")
        frames = self.frame("run_plan", plan={}, allow_render=False) + self.frame("ping")
        code, replies = self.serve(frames, fake_plan=plan)
        self.assertEqual(code, 4)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)

    def test_disconnect_closes_blender(self):
        code, replies = self.serve("")
        self.assertEqual(code, 0)
        self.assertEqual(len(replies), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_startup_requires_exact_arm_before_creating_blender(self):
        stdout = io.StringIO()
        wrong = types.SimpleNamespace(buffer=io.BytesIO(b'{"version":1,"op":"ping"}\\n'))
        with patch.object(sys, "stdin", wrong), patch.object(sys, "stdout", stdout):
            code = worker.serve(self.args())
        self.assertEqual(code, 4)
        self.assertEqual(len(self.sessions), 0)
        self.assertEqual(json.loads(stdout.getvalue())["status"], "outcome_unknown")

    def test_run_plan_rejects_missing_or_nonhex_revision(self):
        for bad in [None, "x" * 64, "F" * 64, "f" * 63]:
            message = {"version": 1, "session_id": SESSION_ID,
                       "op": "run_plan", "allow_render": False, "plan": {}}
            if bad is not None:
                message["expected_scene_revision"] = bad
            with self.assertRaises(ValueError):
                worker.validate(message, SESSION_ID)

    def test_stale_revision_stops_before_any_modeling_operation(self):
        packages = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
        }
        class FakeStep:
            name = "checkpoint"
            request = types.SimpleNamespace(operation="file.checkpoint")
        class FakePlan:
            steps = [FakeStep()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return FakePlan()
        executed = []
        class FakePlanRunner:
            def __init__(self, _):
                pass
            def run(self, _):
                executed.append("unsafe")
                raise AssertionError("No mutation should occur after stale revision")
        packages["shuvi_blender_agent.plans"].Plan = FakePlan
        packages["shuvi_blender_agent.plans"].PlanRunner = FakePlanRunner
        packages["shuvi_blender_agent.files"].read_output = lambda *_: None
        with patch.dict(sys.modules, packages):
            with self.assertRaisesRegex(ValueError, "Stale Blender scene revision"):
                worker.checked_plan(FakeController(object()), {"steps": [1]},
                                    self.output, self.blender, False, "e" * 64)
        self.assertEqual(executed, [])

    def test_verified_persistent_png_requires_exact_approved_output_filename(self):
        requested = self.output / "expected.png"
        returned = self.output / "wrong.png"
        requested.write_bytes(b"png fixture: expected")
        returned.write_bytes(b"png fixture: wrong")
        import hashlib as _hashlib
        fake = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
        }
        class Step:
            name = "render"
            request = types.SimpleNamespace(
                operation="render.execute", payload={"name": "expected.png"})
        class Plan:
            steps = [Step()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return Plan()
        delivered = {"path": str(requested)}
        calls = []
        class PlanRunner:
            def __init__(self, _):
                pass
            def run(self, _):
                calls.append("render")
                path = Path(delivered["path"])
                digest = _hashlib.sha256(path.read_bytes()).hexdigest()
                return types.SimpleNamespace(
                    completed=True,
                    results={"render": FakeResult("verified",
                        {"after": {"path": str(path), "sha256": digest}})})
        def read_output(path, kind):
            self.assertEqual(kind, "PNG")
            return {"path": str(path), "sha256": _hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                    "format": "PNG", "bytes": Path(path).stat().st_size}
        fake["shuvi_blender_agent.plans"].Plan = Plan
        fake["shuvi_blender_agent.plans"].PlanRunner = PlanRunner
        fake["shuvi_blender_agent.files"].read_output = read_output
        fake["shuvi_blender_agent.contracts"].Request = FakeRequest
        fake["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(
            SUCCEEDED="succeeded", VERIFIED="verified")
        with patch.dict(sys.modules, fake):
            for wrong in [str(returned), str(self.output / "nested.png")]:
                if not Path(wrong).exists():
                    Path(wrong).write_bytes(b"simulated different output")
                delivered["path"] = wrong
                with self.subTest(wrong=wrong):
                    with self.assertRaisesRegex(ValueError, "does not match approved plan destination"):
                        worker.checked_plan(FakeController(object()), {"steps": [1]},
                                            self.output, self.blender, True, "f" * 64)
            delivered["path"] = str(requested)
            accepted = worker.checked_plan(FakeController(object()), {"steps": [1]},
                                           self.output, self.blender, True, "f" * 64)
        self.assertEqual(accepted["status"], "verified")
        self.assertEqual(accepted["artifact"]["path"], str(requested))
        self.assertEqual(len(calls), 3)

    def test_persistent_png_final_plan_filename_must_not_be_nested_or_wrong_extension(self):
        fake = {
            "shuvi_blender_agent.plans": types.ModuleType("shuvi_blender_agent.plans"),
            "shuvi_blender_agent.files": types.ModuleType("shuvi_blender_agent.files"),
            "shuvi_blender_agent.contracts": types.ModuleType("shuvi_blender_agent.contracts"),
        }
        requested = self.output / "correct.png"
        requested.write_bytes(b"fixture data")
        class Step:
            name = "render"
            request = types.SimpleNamespace(operation="render.execute", payload={"name": "correct.png"})
        class Plan:
            steps = [Step()]
            timeout_ms = 10_000
            @staticmethod
            def from_dict(_):
                return Plan()
        class Runner:
            def __init__(self, _):
                pass
            def run(self, _):
                return types.SimpleNamespace(completed=True,
                    results={"render": FakeResult("verified",
                        {"after": {"path": str(requested), "sha256": "0"*64}})})
        fake["shuvi_blender_agent.plans"].Plan = Plan
        fake["shuvi_blender_agent.plans"].PlanRunner = Runner
        fake["shuvi_blender_agent.files"].read_output = lambda *_: None
        fake["shuvi_blender_agent.contracts"].Request = FakeRequest
        fake["shuvi_blender_agent.contracts"].Status = types.SimpleNamespace(
            SUCCEEDED="succeeded", VERIFIED="verified")
        with patch.dict(sys.modules, fake):
            for name in ["nested/correct.png", "wrong.blend", ""]:
                with self.subTest(name=name), patch.object(Step.request, "payload", {"name": name}):
                    with self.assertRaisesRegex(ValueError, "Approved persistent plan output filename"):
                        worker.checked_plan(FakeController(object()), {"steps": [1]},
                                            self.output, self.blender, True, "f" * 64)

    def test_complete_plan_receipt_cannot_skip_early_successful_steps(self):
        steps = [
            types.SimpleNamespace(name="inspect"),
            types.SimpleNamespace(name="configure"),
            types.SimpleNamespace(name="render"),
        ]
        plan = types.SimpleNamespace(steps=steps)
        complete = types.SimpleNamespace(
            completed=True, unexecuted_steps=(),
            results={
                "inspect": FakeResult("succeeded", {}),
                "configure": FakeResult("verified", {}),
                "render": FakeResult("verified", {}),
            })
        self.assertEqual(worker.require_complete_step_report(plan, complete), 3)
        for forged in [
            {"results": {"render": complete.results["render"]}},
            {"results": {"inspect": complete.results["inspect"],
                         "configure": complete.results["configure"],
                         "wrong": complete.results["render"]}},
            {"unexecuted_steps": ("configure",)},
            {"completed": False},
        ]:
            with self.subTest(forged=forged):
                with self.assertRaisesRegex(ValueError, "transcript"):
                    worker.require_complete_step_report(
                        plan, types.SimpleNamespace(**{**complete.__dict__, **forged}))
        malformed = types.SimpleNamespace(
            steps=[types.SimpleNamespace(name="inspect"),
                   types.SimpleNamespace(name="inspect")])
        with self.assertRaisesRegex(ValueError, "transcript"):
            worker.require_complete_step_report(malformed, complete)

    @staticmethod
    def rich_item(kind="MESH"):
        value = {
            "name": "ProofObject", "type": kind,
            "details_truncated": False,
            "transform": {"location": [1, 2, 3],
                          "rotation_euler": [0.1, 0.2, 0.3],
                          "scale": [1, 1, 1]},
            "dimensions": [2, 3, 4],
            "visibility": {"hide_render": False, "hide_viewport": False},
            "materials": ["Copper", None],
            "material_slot_count": 2,
            "modifiers": [{"name": "Bevel", "type": "BEVEL",
                           "show_render": True}],
            "modifier_count": 1,
        }
        if kind == "CAMERA":
            value["camera"] = {"type": "PERSP", "lens": 50.,
                               "clip_start": .1, "clip_end": 100.}
        elif kind == "LIGHT":
            value["light"] = {"type": "POINT", "energy": 950.,
                              "color": [1., .94, .85]}
        return value

    def test_live_object_details_projects_materials_transform_and_modifiers(self):
        result = worker.bounded_object_details(self.rich_item())
        self.assertTrue(result["details_available"])
        self.assertFalse(result["details_truncated"])
        self.assertEqual(result["details"]["materials"], ["Copper", None])
        self.assertEqual(result["details"]["location"], [1., 2., 3.])
        self.assertEqual(result["details"]["modifiers"][0]["type"], "BEVEL")
        self.assertFalse(result["shader_nodes_inspected"])
        self.assertFalse(result["mesh_topology_inspected"])

    def test_read_only_camera_and_lighting_properties_are_not_guessed(self):
        for kind in ("CAMERA", "LIGHT"):
            record = worker.bounded_object_details(self.rich_item(kind))
            self.assertTrue(record["details_available"])
            if kind == "CAMERA":
                self.assertEqual(record["details"]["camera"]["lens"], 50.)
            else:
                self.assertEqual(record["details"]["light"]["energy"], 950.)
        fake = self.rich_item("CAMERA")
        del fake["camera"]
        with self.assertRaisesRegex(ValueError, "camera properties"):
            worker.bounded_object_details(fake)
        fake = self.rich_item("LIGHT")
        fake["light"]["energy"] = float("inf")
        with self.assertRaisesRegex(ValueError, "energy"):
            worker.bounded_object_details(fake)

    def test_missing_legacy_or_truncated_details_do_not_claim_readback(self):
        self.assertEqual(worker.bounded_object_details(
            {"details_truncated": False}),
            {"details_available": False, "details_truncated": False})
        self.assertEqual(worker.bounded_object_details(
            {**self.rich_item(), "details_truncated": True}),
            {"details_available": False, "details_truncated": True})
        oversize = self.rich_item()
        oversize["materials"] = ["Copper"] * 17
        oversize["material_slot_count"] = 17
        self.assertFalse(worker.bounded_object_details(oversize)["details_available"])

    def test_live_object_details_reject_partial_and_false_material_evidence(self):
        for key in ("transform", "dimensions", "visibility", "materials",
                    "material_slot_count", "modifiers", "modifier_count"):
            broken = self.rich_item()
            del broken[key]
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "incomplete"):
                worker.bounded_object_details(broken)
        for key, changed in [
            ("materials", ["Copper", 4]), ("material_slot_count", 3),
            ("dimensions", [float("nan"), 0., 1.]),
            ("modifiers", [{"name": "X", "type": "BEVEL", "show_render": "yes"}]),
        ]:
            broken = self.rich_item()
            broken[key] = changed
            with self.subTest(key=key), self.assertRaises(ValueError):
                worker.bounded_object_details(broken)

    @staticmethod
    def small_topology():
        return {
            "vertices": [[0., 0., 0.], [1., 0., 0.],
                         [1., 1., 0.], [0., 1., 0.]],
            "faces": [[0, 1, 2], [0, 2, 3]],
        }

    def test_real_small_mesh_returns_all_vertices_faces_and_sha_readback(self):
        geometry = self.small_topology()
        actual = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        expected_id = SESSION_ID + ":mesh-one"
        class Controller:
            calls = []
            def execute(self, request):
                self.calls.append(request.operation)
                self.last = request
                return FakeResult("succeeded", {
                    **geometry, "geometry_revision": actual,
                    "object_id": expected_id, "name": "ShuviMesh",
                })
        controller = Controller()
        item = {"object_id": expected_id, "name": "ShuviMesh"}
        result = worker.read_bounded_mesh_topology(controller, item, SESSION_ID)
        self.assertEqual(controller.calls, ["mesh.inspect"])
        self.assertEqual(controller.last.payload, {"object_id": expected_id})
        self.assertTrue(result["geometry_available"])
        self.assertTrue(result["mesh_topology_inspected"])
        self.assertFalse(result["geometry_truncated"])
        self.assertEqual(result["mesh_geometry_summary"]["faces"], geometry["faces"])
        self.assertEqual(result["mesh_geometry_summary"]["geometry_sha256"], actual)
        self.assertTrue(result["mesh_geometry_summary"]["digest_checked_in_authenticated_broker"])
        self.assertFalse(result["mesh_geometry_summary"]["native_digest_recomputed"])

    def test_large_mesh_geometry_is_unavailable_without_claiming_digest(self):
        class Controller:
            def execute(self, request):
                raise AssertionError("Oversized source must not call mesh.inspect")
        result = worker.read_bounded_mesh_topology(
            Controller(), {"object_id": SESSION_ID + ":mesh-one",
                           "name": "ShuviMesh",
                           "data": {"object_type": "MESH", "vertices": 250_000,
                                    "polygons": 200_000, "edges": 400_000}},
            SESSION_ID)
        self.assertFalse(result["geometry_available"])
        self.assertFalse(result["mesh_topology_inspected"])
        self.assertTrue(result["geometry_truncated"])
        self.assertFalse(result["mesh_overview_available"])
        self.assertIsNone(result["mesh_geometry_summary"])
        self.assertEqual(result["mesh_inspection_skipped"], "upstream_geometry_limit")
        self.assertEqual(result["mesh_counts"]["vertex_count"], 250_000)
        self.assertFalse(result["mesh_counts"]["topology_verified_by_counts"])

    @staticmethod
    def medium_topology():
        return {
            "vertices": [[float(i), float(i % 7), 0.0] for i in range(200)],
            "faces": [[0, i, i + 1] for i in range(1, 199)],
        }

    def test_medium_mesh_reports_verified_compact_overview_without_vertex_arrays(self):
        geometry = self.medium_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        identity = SESSION_ID + ":mesh-one"
        class Controller:
            def execute(self, request):
                return FakeResult("succeeded", {
                    **geometry, "geometry_revision": digest,
                    "object_id": identity, "name": "ShuviMesh"})
        result = worker.read_bounded_mesh_topology(
            Controller(), {"object_id": identity, "name": "ShuviMesh"}, SESSION_ID)
        self.assertFalse(result["geometry_available"])
        self.assertFalse(result["mesh_topology_inspected"])
        self.assertTrue(result["geometry_truncated"])
        self.assertTrue(result["mesh_overview_available"])
        self.assertIsNone(result["mesh_geometry_summary"])
        overview = result["mesh_overview"]
        self.assertEqual(overview["vertex_count"], 200)
        self.assertEqual(overview["face_count"], 198)
        self.assertEqual(overview["face_index_count"], 594)
        self.assertEqual(overview["bounds_min"], [0., 0., 0.])
        self.assertEqual(overview["bounds_max"], [199., 6., 0.])
        self.assertEqual(overview["geometry_sha256"], digest)
        self.assertFalse(overview["full_vertex_face_arrays_transferred"])
        self.assertNotIn("vertices", overview)
        self.assertNotIn("faces", overview)

    def test_medium_mesh_detects_tampered_geometry_instead_of_reporting_summary(self):
        geometry = self.medium_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        changed_cases = [
            {"faces": [[0, 1, 1]] + geometry["faces"][1:]},
            {"faces": [[0, 1, 999]] + geometry["faces"][1:]},
            {"vertices": [[float("nan"), 0., 0.]] + geometry["vertices"][1:]},
            {"vertices": [[float("inf"), 0., 0.]] + geometry["vertices"][1:]},
            {"vertices": [[2000000., 0., 0.]] + geometry["vertices"][1:]},
            {"geometry_revision": "0" * 64},
        ]
        identity = SESSION_ID + ":mesh-one"
        for changes in changed_cases:
            with self.subTest(changes=changes):
                payload = {**geometry, "geometry_revision": digest,
                           "object_id": identity, "name": "ShuviMesh", **changes}
                class Controller:
                    def execute(self, request):
                        return FakeResult("succeeded", payload)
                with self.assertRaises(ValueError):
                    worker.read_bounded_mesh_topology(
                        Controller(), {"object_id": identity, "name": "ShuviMesh"},
                        SESSION_ID)

    def test_broker_page_includes_compact_medium_mesh_and_uses_same_revision(self):
        geometry = self.medium_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        original = FakeController.execute
        calls = []
        def enriched(controller, request):
            calls.append(request.operation)
            if request.operation == "mesh.inspect":
                return FakeResult("succeeded", {**geometry,
                    "geometry_revision": digest, "name": "ShuviMesh",
                    "object_id": SESSION_ID + ":mesh-one"})
            result = original(controller, request)
            if request.operation == "objects.list":
                result.data["items"][0].update(self.rich_item())
                result.data["items"][0]["name"] = "ShuviMesh"
            return result
        with patch.object(FakeController, "execute", enriched):
            code, replies = self.serve(self.frame("objects", query={
                "offset": 0, "limit": 5, "name_prefix": "Shuvi",
                "object_type": None}, expected_scene_revision="f" * 64)
                + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertIn("mesh.inspect", calls)
        self.assertGreaterEqual(calls.count("scene.inspect"), 2)
        result = replies[1]["objects"][0]
        self.assertTrue(result["mesh_overview_available"])
        self.assertFalse(result["mesh_topology_inspected"])
        self.assertFalse(result["geometry_available"])
        self.assertEqual(result["mesh_overview"]["vertex_count"], 200)
        self.assertNotIn("vertices", result["mesh_overview"])

    def test_upstream_4096_limit_supports_large_compact_summaries_without_arrays(self):
        geometry = {"vertices": [[float(i), float(i % 3), 0.0]
                                 for i in range(1200)],
                    "faces": [[0, i, i + 1] for i in range(1, 1199)]}
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        identity = SESSION_ID + ":mesh-one"
        calls = []
        class Controller:
            def execute(self, request):
                calls.append(request.operation)
                return FakeResult("succeeded", {**geometry,
                    "geometry_revision": digest, "object_id": identity,
                    "name": "ShuviMesh"})
        item = {"object_id": identity, "name": "ShuviMesh",
                "data": {"object_type": "MESH", "vertices": 1200,
                         "polygons": 1198, "edges": 2500}}
        report = worker.read_bounded_mesh_topology(Controller(), item, SESSION_ID)
        self.assertEqual(calls, ["mesh.inspect"])
        self.assertTrue(report["mesh_overview_available"])
        self.assertFalse(report["geometry_available"])
        self.assertEqual(report["mesh_overview"]["vertex_count"], 1200)
        self.assertEqual(report["mesh_overview"]["face_count"], 1198)
        self.assertFalse(report["mesh_overview"]["full_vertex_face_arrays_transferred"])
        self.assertEqual(report["mesh_counts"]["vertex_count"], 1200)

    def test_authenticated_counts_disagreeing_with_mesh_inspect_fail_closed(self):
        geometry = self.small_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        identity = SESSION_ID + ":mesh-one"
        class Controller:
            def execute(self, request):
                return FakeResult("succeeded", {**geometry,
                    "geometry_revision": digest, "object_id": identity,
                    "name": "ShuviMesh"})
        for changed in [5, 6]:
            with self.subTest(changed=changed):
                item = {"object_id": identity, "name": "ShuviMesh",
                        "data": {"object_type": "MESH", "vertices": changed,
                                 "polygons": 2, "edges": 5}}
                with self.assertRaisesRegex(ValueError, "metadata differs"):
                    worker.read_bounded_mesh_topology(
                        Controller(), item, SESSION_ID)

    def test_invalid_count_metadata_or_empty_mesh_never_claims_topology(self):
        identity = SESSION_ID + ":mesh-one"
        class Controller:
            def execute(self, request):
                raise AssertionError("Empty or invalid count must not launch mesh inspect")
        item = {"object_id": identity, "name": "ShuviMesh",
                "data": {"object_type": "MESH", "vertices": 0,
                         "polygons": 0, "edges": 0}}
        report = worker.read_bounded_mesh_topology(Controller(), item, SESSION_ID)
        self.assertEqual(report["mesh_inspection_skipped"], "empty_or_degenerate_mesh")
        self.assertTrue(report["mesh_counts_available"])
        self.assertFalse(report["mesh_topology_inspected"])
        for invalid in [
            {"vertices": -1},
            {"vertices": 100_000_001},
            {"polygons": True},
            {"edges": 0.5},
            {"object_type": "CAMERA"},
        ]:
            bad = {"object_id": identity, "name": "ShuviMesh",
                   "data": {**item["data"], **invalid}}
            with self.subTest(invalid=invalid), self.assertRaisesRegex(
                    ValueError, "metadata"):
                worker.read_bounded_mesh_topology(Controller(), bad, SESSION_ID)

    def test_oversized_object_list_delivers_counts_without_mesh_inspect(self):
        original = FakeController.execute
        calls = []
        def fixture(controller, request):
            calls.append(request.operation)
            if request.operation == "mesh.inspect":
                raise AssertionError("Oversized object may not use mesh.inspect")
            response = original(controller, request)
            if request.operation == "objects.list":
                response.data["items"][0].update(self.rich_item())
                response.data["items"][0]["name"] = "ShuviMesh"
                response.data["items"][0]["data"] = {
                    "object_type": "MESH", "vertices": 123456,
                    "polygons": 87654, "edges": 234567}
            return response
        with patch.object(FakeController, "execute", fixture):
            code, replies = self.serve(self.frame("objects", query={
                "offset": 0, "limit": 5, "name_prefix": "Shuvi",
                "object_type": None}, expected_scene_revision="f" * 64)
                + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertNotIn("mesh.inspect", calls)
        self.assertEqual(replies[1]["objects"][0]["mesh_counts"]["vertex_count"], 123456)
        self.assertEqual(replies[1]["objects"][0]["mesh_inspection_skipped"], "upstream_geometry_limit")

    def test_mesh_readback_rejects_tampered_faces_wrong_identity_and_sha(self):
        geometry = self.small_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        item = {"object_id": SESSION_ID + ":mesh-one", "name": "ShuviMesh"}
        for data in [
            {**geometry, "geometry_revision": "0" * 64},
            {**geometry, "faces": [[0, 1, 1]], "geometry_revision": digest},
            {**geometry, "faces": [[0, 1, 99]], "geometry_revision": digest},
            {**geometry, "vertices": [[float("nan"), 0., 0.]] + geometry["vertices"][1:],
             "geometry_revision": digest},
            {**geometry, "name": "WrongName", "geometry_revision": digest},
            {**geometry, "object_id": "different:object", "geometry_revision": digest},
        ]:
            with self.subTest(data=data):
                class Controller:
                    def execute(self, request):
                        return FakeResult("succeeded", {
                            **data,
                            "name": data.get("name", "ShuviMesh"),
                            "object_id": data.get("object_id", SESSION_ID + ":mesh-one")})
                with self.assertRaises(ValueError):
                    worker.read_bounded_mesh_topology(Controller(), item, SESSION_ID)

    def test_authenticated_object_page_includes_small_mesh_topology(self):
        geometry = self.small_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        original = FakeController.execute
        def enriched(controller, request):
            if request.operation == "mesh.inspect":
                return FakeResult("succeeded", {**geometry,
                    "geometry_revision": digest,
                    "name": "ShuviMesh",
                    "object_id": SESSION_ID + ":mesh-one"})
            value = original(controller, request)
            if request.operation == "objects.list":
                obj = value.data["items"][0]
                obj.update(self.rich_item())
                obj["name"], obj["type"] = "ShuviMesh", "MESH"
            return value
        with patch.object(FakeController, "execute", enriched):
            code, replies = self.serve(
                self.frame("objects", query={
                    "offset": 0, "limit": 5, "name_prefix": "Shuvi",
                    "object_type": None}, expected_scene_revision="f" * 64)
                + self.frame("close"))
        self.assertEqual(code, 0)
        page = replies[1]["objects"]
        self.assertEqual(len(page), 2)
        self.assertTrue(page[0]["geometry_available"])
        self.assertEqual(page[0]["mesh_geometry_summary"]["vertex_count"], 4)
        self.assertFalse(page[1]["details_available"])
        self.assertTrue(self.sessions[0].closed)

    def test_mid_mesh_inspection_scene_revision_change_closes_owned_session(self):
        geometry = self.small_topology()
        digest = hashlib.sha256(json.dumps(
            geometry, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest()
        original = FakeController.execute
        seen = {"mesh": False}
        def changed(controller, request):
            if request.operation == "mesh.inspect":
                seen["mesh"] = True
                return FakeResult("succeeded", {**geometry,
                    "geometry_revision": digest,
                    "name": "ShuviMesh",
                    "object_id": SESSION_ID + ":mesh-one"})
            result = original(controller, request)
            if request.operation == "objects.list":
                result.data["items"][0].update(self.rich_item())
                result.data["items"][0]["name"] = "ShuviMesh"
            if request.operation == "scene.inspect" and seen["mesh"]:
                result.data["revision"] = "1" * 64
            return result
        with patch.object(FakeController, "execute", changed):
            code, replies = self.serve(self.frame("objects", query={
                "offset": 0, "limit": 5, "name_prefix": "Shuvi",
                "object_type": None}, expected_scene_revision="f" * 64))
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)

    def test_approved_source_is_hash_checked_and_loaded_in_authenticated_blender(self):
        path = self.root / "source.blend"
        data = b"BLENDER-v430" + b"safe-checkpoint" * 5
        path.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        self.source_input = (path, digest)
        FakeController.loaded_file = str(path)
        code, replies = self.serve(self.frame("inspect") + self.frame("close"))
        self.assertEqual(code, 0)
        self.assertEqual([r["status"] for r in replies],
                         ["ready", "alive", "closing"])
        source = replies[0]["input_checkpoint"]
        self.assertEqual(source["sha256"], digest)
        self.assertEqual(source["path"], str(path))
        self.assertEqual(source["bytes"], len(data))
        self.assertTrue(source["verified_loaded_file_path"])
        self.assertTrue(source["loaded_file_hash_checked"])
        self.assertTrue(self.sessions[0].closed)

    def test_wrong_loaded_file_fails_closed_after_bridge_launch(self):
        path = self.root / "source.blend"
        data = b"BLENDER-v430" + b"safe-checkpoint"
        path.write_bytes(data)
        self.source_input = (path, hashlib.sha256(data).hexdigest())
        different = self.root / "other.blend"
        different.write_bytes(data)
        FakeController.loaded_file = str(different)
        code, replies = self.serve("")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)

    def test_wrong_source_sha_fails_before_any_blender_launch(self):
        path = self.root / "source.blend"
        path.write_bytes(b"BLENDER-v430" + b"safe-checkpoint")
        self.source_input = (path, "0" * 64)
        code, replies = self.serve("")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertEqual(len(self.sessions), 0)

    def test_persistent_read_only_object_discovery_reuses_same_authenticated_session(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "Shuvi", "object_type": None}
        frames = (self.frame("objects", query=query, expected_scene_revision="f" * 64)
                  + self.frame("close"))
        code, replies = self.serve(frames)
        self.assertEqual(code, 0)
        self.assertEqual([v["status"] for v in replies],
                         ["ready", "alive", "closing"])
        result = replies[1]
        self.assertEqual(result["operation"], "objects")
        self.assertTrue(result["read_only"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["objects"]), 2)
        self.assertEqual(result["objects"][0]["name"], "ShuviMesh")
        self.assertEqual(result["objects"][0]["revision"], "a" * 64)
        self.assertFalse(result["objects"][0]["details_available"])
        self.assertFalse(result["objects"][0]["details_truncated"])
        self.assertNotIn("details", result["objects"][0])
        self.assertEqual(len(self.sessions), 1)
        self.assertTrue(self.sessions[0].closed)

    def test_read_only_object_query_rejects_oversized_or_malformed_payload(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "", "object_type": None}
        for wrong in [
            {**query, "limit": 6}, {**query, "offset": -1},
            {**query, "name_prefix": "x" * 81},
            {**query, "extra_python": "exec('unsafe')"},
        ]:
            with self.assertRaises(ValueError):
                worker.validate(json.loads(self.frame(
                    "objects", query=wrong, expected_scene_revision="f" * 64)), SESSION_ID)

    def test_read_only_objects_stale_revision_fails_closed(self):
        query = {"offset": 0, "limit": 5, "name_prefix": "", "object_type": None}
        code, replies = self.serve(self.frame(
            "objects", query=query, expected_scene_revision="e" * 64))
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertFalse(replies[-1]["retry_automatically"])
        self.assertTrue(self.sessions[0].closed)

    def test_oversized_command_denied(self):
        code, replies = self.serve("x" * 65538 + "\n")
        self.assertEqual(code, 4)
        self.assertEqual(replies[-1]["status"], "outcome_unknown")
        self.assertTrue(self.sessions[0].closed)


if __name__ == "__main__":
    unittest.main()
