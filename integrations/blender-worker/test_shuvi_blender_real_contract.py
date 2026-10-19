"""Real upstream shuvi_blender_agent Plan.from_dict and PlanRunner contract tests.

NO bpy, Blender process, desktop, network calls or customer assets. The only
fake is the controller/transport: parsing, typed operation contracts, request
envelopes, result binding and multi-step scheduling use pinned REAL upstream
source from shuvi-blender-agent. CI must install that source via PYTHONPATH;
do not silently substitute mocks for imported upstream PlanRunner classes.
"""
from __future__ import annotations

import copy
import hashlib
import json
import unittest
from uuid import uuid4

from shuvi_blender_agent.contracts import Request, Result, Status
from shuvi_blender_agent.errors import AgentError
from shuvi_blender_agent.mesh import CreateMesh, TranslateVertices
from shuvi_blender_agent.appearance import CreateDevice, MaterialAssign
from shuvi_blender_agent.models import PageQuery
from shuvi_blender_agent.plans import Plan, PlanRunner
from shuvi_blender_agent.rendering import FileAction, RenderConfig
from shuvi_blender_agent.animation import InsertKeyframe, SetFrame

from shuvi_blender_acceptance import build

START_REV = "a" * 64
VALID_OPERATIONS = {
    "mesh.create", "mesh.inspect", "mesh.translate_vertices",
    "objects.list", "scene.inspect", "file.checkpoint",
    "render.configure", "render.execute", "device.create", "material.create_assign",
    "animation.insert_keyframe", "animation.set_frame",
}


def digest(data):
    return hashlib.sha256(json.dumps(
        data, sort_keys=True, allow_nan=False, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


class ContractController:
    """Deterministic state emulator using actual upstream typed parsing.

    This is NOT a pretend bpy runtime. It verifies that native PlanRunner
    resolves real source-result bindings into valid typed step payloads.
    """

    def __init__(self, *, existing=None, revision=START_REV):
        self.objects = copy.deepcopy(existing) if existing else {}
        self.session = str(uuid4())
        self.rev = revision
        self.calls = []
        self.saved = {}
        self.render_ready = False
        self.current_frame = 1
        self.active_camera = next((n for n, o in self.objects.items()
                                   if o.get("type") == "CAMERA" and o.get("settings", {}).get("make_active")), None)
        self.key_light = next((n for n, o in self.objects.items() if o.get("type") == "LIGHT"), None)
        self.checked_operations = []

    def capabilities(self, *, timeout_ms):
        if not 1 <= timeout_ms <= 10_000:
            raise AssertionError("Upstream plan capabilities deadline invalid")
        return {"operations": sorted(VALID_OPERATIONS)}

    def validate_operation(self, operation):
        if operation not in VALID_OPERATIONS:
            raise ValueError("Unexpected operation in contract test")
        self.checked_operations.append(operation)

    def validate_payload(self, request):
        op, value = request.operation, request.payload
        if op == "device.create":
            CreateDevice.parse(value)
        elif op == "material.create_assign":
            MaterialAssign.parse(value)
        elif op == "mesh.create":
            CreateMesh.parse(value)
        elif op == "mesh.translate_vertices":
            TranslateVertices.parse(value)
        elif op == "objects.list":
            PageQuery.parse(value)
        elif op == "animation.insert_keyframe":
            InsertKeyframe.parse(value)
        elif op == "animation.set_frame":
            SetFrame.parse(value)
        elif op == "render.configure":
            RenderConfig.parse(value)
        elif op == "render.execute":
            FileAction.parse_png(value)
        elif op == "file.checkpoint":
            FileAction.parse_blend(value)
        elif op == "mesh.inspect":
            if set(value) != {"object_id"} or not isinstance(value["object_id"], str):
                raise ValueError("mesh.inspect requires a real object_id")
        elif op == "scene.inspect":
            if value != {}:
                raise ValueError("scene.inspect must be read only without arguments")
        else:
            raise ValueError(f"Unexpected upstream Blender operation: {op}")

    def _result(self, request, data, verified=False):
        return Result(
            request.request_id, request.command_id,
            Status.VERIFIED if verified else Status.SUCCEEDED,
            data=data, verification={"matched": True} if verified else None,
        )

    def _advance(self, tag):
        self.rev = digest({"prior": self.rev, "change": tag, "calls": len(self.calls)})

    def execute(self, request: Request):
        self.validate_payload(request)
        op, payload = request.operation, request.payload
        self.calls.append(op)
        if op == "scene.inspect":
            return self._result(request, {
                "session_id": self.session,
                "revision": self.rev,
                "file": "",
                "object_count": len(self.objects),
                "camera_id": self.active_camera,
                "object_counts_by_type": {kind: sum(o.get("type") == kind for o in self.objects.values())
                                          for kind in ("MESH", "CAMERA", "LIGHT")},
            })
        if op == "device.create":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale device scene revision")
            if payload["name"] in self.objects:
                return self._result_failure(request, "duplicate device name")
            kind = payload["kind"]
            ident = self.session + ":" + str(uuid4())
            self.objects[payload["name"]] = {
                "object_id": ident, "name": payload["name"],
                "revision": digest({"identity": ident, "name": payload["name"]}),
                "type": "CAMERA" if kind == "CAMERA" else "LIGHT",
                "settings": copy.deepcopy(payload["settings"]),
                "transform": copy.deepcopy(payload["transform"]),
            }
            if kind == "CAMERA" and payload["settings"]["make_active"]:
                self.active_camera = payload["name"]
            if kind != "CAMERA":
                self.key_light = payload["name"]
            self._advance("device create")
            return self._result(request, {"after": copy.deepcopy(self.objects[payload["name"]])}, verified=True)
        if op == "mesh.create":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale create scene revision")
            if payload["name"] in self.objects:
                return self._result_failure(request, "duplicate mesh name")
            ident = self.session + ":" + str(uuid4())
            geometry = copy.deepcopy(payload["geometry"])
            obj = {
                "object_id": ident, "name": payload["name"], "type": "MESH",
                "revision": digest({"identity": ident, "name": payload["name"]}),
                "geometry": geometry,
            }
            self.objects[payload["name"]] = obj
            self._advance("create")
            return self._result(request, {"after": {
                "object": {k: obj[k] for k in ("object_id", "name", "revision")},
                "geometry": {**geometry, "geometry_revision": digest(geometry)},
            }}, verified=True)
        if op == "objects.list":
            if payload.get("expected_revision") not in (None, self.rev):
                return self._result_failure(request, "stale object page")
            items = [
                {k: obj[k] for k in ("object_id", "name", "revision")}
                for obj in sorted(self.objects.values(), key=lambda v: v["name"])
                if obj["name"].startswith(payload.get("name_prefix", ""))
                and (payload.get("object_type") is None or obj.get("type") == payload["object_type"])
            ]
            return self._result(request, {"items": items, "total": len(items),
                                          "offset": payload.get("offset", 0),
                                          "revision": self.rev})
        if op == "mesh.inspect":
            obj = next((item for item in self.objects.values()
                        if item["object_id"] == payload["object_id"]), None)
            if obj is None:
                return self._result_failure(request, "object id unknown")
            return self._result(request, {**copy.deepcopy(obj["geometry"]),
                                          "name": obj["name"],
                                          "object_id": obj["object_id"],
                                          "geometry_revision": digest(obj["geometry"])})
        if op == "mesh.translate_vertices":
            target = payload["target"]
            obj = self.objects.get(target["expected_name"])
            if obj is None or obj["object_id"] != target["object_id"]:
                return self._result_failure(request, "wrong object session/name")
            if obj["revision"] != target["expected_revision"]:
                return self._result_failure(request, "stale target revision")
            if digest(obj["geometry"]) != payload["expected_geometry_revision"]:
                return self._result_failure(request, "stale geometry revision")
            before = digest(obj["geometry"])
            for index in payload["indices"]:
                obj["geometry"]["vertices"][index] = [
                    float(a + b)
                    for a, b in zip(obj["geometry"]["vertices"][index],
                                    payload["delta"], strict=True)
                ]
            obj["revision"] = digest({"former": obj["revision"],
                                     "geometry": obj["geometry"]})
            self._advance("mesh vertex translation")
            if before == digest(obj["geometry"]):
                return self._result_failure(request, "geometry unchanged")
            return self._result(request, {"after": {"geometry_revision": digest(obj["geometry"]),
                                                   "object_revision": obj["revision"]}},
                                verified=True)
        if op == "material.create_assign":
            target = payload["target"]
            obj = self.objects.get(target["expected_name"])
            if obj is None or obj.get("type") != "MESH":
                return self._result_failure(request, "material target must be a mesh")
            if obj["object_id"] != target["object_id"] or obj["revision"] != target["expected_revision"]:
                return self._result_failure(request, "material target is stale")
            if payload["name"] in obj.get("materials", []):
                return self._result_failure(request, "material already assigned")
            obj.setdefault("materials", []).append(payload["name"])
            obj["revision"] = digest({"former": obj["revision"], "material": payload["name"]})
            self._advance("material assigned")
            return self._result(request, {"after": {
                "assigned_material": {
                    "name": payload["name"], "base_color": payload["base_color"],
                    "metallic": payload["metallic"], "roughness": payload["roughness"],
                    "slot_index": len(obj["materials"]) - 1,
                    "slot_material": payload["name"],
                }
            }}, verified=True)
        if op == "animation.insert_keyframe":
            target = payload["target"]
            obj = self.objects.get(target["expected_name"])
            if (obj is None or obj.get("type") != "MESH"
                    or obj["object_id"] != target["object_id"]
                    or obj["revision"] != target["expected_revision"]):
                return self._result_failure(request, "wrong or stale animation target")
            keys = obj.setdefault("keyframes", {})
            if str(payload["frame"]) in keys:
                return self._result_failure(request, "animation keyframe may not be overwritten")
            keys[str(payload["frame"])] = {
                "transform": copy.deepcopy(payload["transform"]),
                "interpolation": payload["interpolation"],
            }
            obj["revision"] = digest({
                "previous": obj["revision"], "keyframe": payload["frame"],
                "transform": payload["transform"],
            })
            self._advance("insert verified keyframe")
            return self._result(request, {"after": copy.deepcopy(obj)}, verified=True)
        if op == "animation.set_frame":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale animation scene revision")
            self.current_frame = payload["frame"]
            for obj in self.objects.values():
                keyed = obj.get("keyframes", {}).get(str(self.current_frame))
                if keyed:
                    obj["transform"] = copy.deepcopy(keyed["transform"])
            self._advance("set final Blender timeline frame")
            return self._result(request, {
                "after": {"revision": self.rev, "frames": {"current": self.current_frame}}
            }, verified=True)
        if op == "file.checkpoint":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale checkpoint scene revision")
            self.saved[payload["name"]] = {
                "geometry": copy.deepcopy(self.objects),
                "mesh_fingerprint": digest({
                    name: obj["geometry"] for name, obj in self.objects.items() if obj.get("type") == "MESH"
                }),
                "scene_revision": self.rev,
            }
            return self._result(request, {"after": {"path": payload["name"],
                                                    "sha256": digest(self.saved[payload["name"]]),
                                                    "format": "BLEND"}}, verified=True)
        if op == "render.configure":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale render configuration")
            self.render_ready = True
            self._advance("CPU render configured")
            return self._result(request, {"after": {"render": {
                "engine": "CYCLES", "device": "CPU",
                "resolution_x": payload["width"],
                "resolution_y": payload["height"],
                "samples": payload["samples"],
            }}}, verified=True)
        if op == "render.execute":
            if payload["expected_scene_revision"] != self.rev:
                return self._result_failure(request, "stale render scene")
            if not self.render_ready:
                return self._result_failure(request, "render was not configured")
            if not self.active_camera or not self.key_light:
                return self._result_failure(request, "render requires saved approved camera and key light")
            return self._result(request, {"after": {
                "path": payload["name"], "format": "PNG",
                "width": 64, "height": 64,
            }}, verified=True)
        raise AssertionError("Unrecognized typed upstream operation")

    def _result_failure(self, request, reason):
        from shuvi_blender_agent.errors import ErrorCode
        return Result(request.request_id, request.command_id, Status.FAILED,
                      data={}, error=AgentError(ErrorCode.STALE_STATE, reason))


class ActualUpstreamPlanRunnerTests(unittest.TestCase):
    def test_pinned_typed_shader_read_only_contract_matches_persistence_validator(self):
        # Exercise the *real pinned upstream* parser and typed tool registry;
        # fake Blender scene data here must not be mistaken for a bpy run.
        from shuvi_blender_agent.material_nodes import MaterialNodeOperations, ShaderInspect
        from shuvi_blender_agent.safety import SafetyClass
        from shuvi_blender_agent.inspection import revision
        from shuvi_blender_session import verify_shuvi41_copper_shader

        parsed = ShaderInspect.parse({"material_name": "Shuvi41ProofCopper"})
        self.assertEqual(parsed.material_name, "Shuvi41ProofCopper")
        tool = next(t for t in MaterialNodeOperations.__new__(MaterialNodeOperations).tools()
                    if t.name == "material.shader_inspect")
        self.assertEqual(tool.classification, SafetyClass.READ_ONLY)
        self.assertEqual(tool.parse({"material_name": "Shuvi41ProofCopper"}), parsed)
        snapshot = {
            "material_name": "Shuvi41ProofCopper",
            "node_count": 2, "link_count": 1,
            "nodes": [
                {"name": "Material Output", "type": "OUTPUT_MATERIAL", "image": None},
                {"name": "Principled BSDF", "type": "BSDF_PRINCIPLED", "image": None},
            ],
            "links": [["Principled BSDF", "BSDF", "Material Output", "Surface"]],
            "principled": {
                "base_color": [0.8, 0.41, 0.16, 1.0],
                "metallic": 0.65, "roughness": 0.31,
            },
            "auxiliary": {}, "textures": {},
        }
        snapshot["shader_revision"] = revision(snapshot)
        self.assertEqual(verify_shuvi41_copper_shader(snapshot),
                         snapshot["shader_revision"])

    def test_real_upstream_plan_runner_executes_motion_keys_and_saved_timeline(self):
        """Real upstream typed parsing and bindings; the controller is a fixture."""
        from shuvi_blender_agent.animation import InsertKeyframe, SetFrame
        recipe = build("motion", START_REV)
        plan = Plan.from_dict(recipe)
        self.assertEqual(len(plan.steps), 6)
        prior = ContractController()
        prior.objects["Shuvi41ProofMesh"] = {
            "object_id": prior.session + ":mesh",
            "name": "Shuvi41ProofMesh", "type": "MESH",
            "revision": digest({"new": "mesh"}),
            "geometry": {"vertices": [[0,0,0]], "faces": []},
        }
        report = PlanRunner(prior).run(plan)
        self.assertEqual(len(prior.saved), 1,
                         {"calls": prior.calls, "report": report.to_dict()})
        self.assertEqual(prior.calls, [
            "objects.list", "animation.insert_keyframe",
            "animation.insert_keyframe", "scene.inspect",
            "animation.set_frame", "file.checkpoint",
        ])
        self.assertEqual(prior.current_frame, 24)
        keys = prior.saved["shuvi41-proof-motion.blend"]["geometry"]["Shuvi41ProofMesh"]["keyframes"]
        self.assertEqual(set(keys), {"1", "24"})
        self.assertEqual(keys["1"]["transform"]["location"], [0.0, 0.0, 0.0])
        self.assertEqual(keys["24"]["transform"]["location"], [0.0, 0.0, 1.5])
        self.assertEqual(keys["24"]["interpolation"], "LINEAR")
        self.assertEqual(report.results["checkpoint"].status, Status.VERIFIED)
        self.assertIn("animation.insert_keyframe", prior.checked_operations)
        self.assertIn("animation.set_frame", prior.checked_operations)
        self.assertEqual(prior.saved["shuvi41-proof-motion.blend"]["geometry"]
                         ["Shuvi41ProofMesh"]["transform"]["location"], [0.0, 0.0, 1.5])

    def test_real_motion_runner_denies_missing_target_or_stale_first_key(self):
        recipe = build("motion", START_REV)
        empty = ContractController()
        report = PlanRunner(empty).run(Plan.from_dict(recipe))
        self.assertFalse(empty.saved)
        self.assertNotIn("file.checkpoint", empty.calls)
        self.assertNotEqual(report.results["checkpoint"].status
                            if "checkpoint" in report.results else None, Status.VERIFIED)

        class StaleSecondPose(ContractController):
            def execute(self, request):
                if request.operation == "animation.insert_keyframe" and request.payload["frame"] == 24:
                    obj = self.objects["Shuvi41ProofMesh"]
                    obj["revision"] = digest({"out_of_band": "object mutation"})
                return super().execute(request)
        stale = StaleSecondPose()
        stale.objects["Shuvi41ProofMesh"] = {
            "object_id": stale.session + ":mesh", "name": "Shuvi41ProofMesh",
            "type": "MESH", "revision": digest({"new": "mesh"}),
            "geometry": {"vertices": [[0,0,0]], "faces": []},
        }
        PlanRunner(stale).run(Plan.from_dict(recipe))
        self.assertFalse(stale.saved)
        self.assertNotIn("file.checkpoint", stale.calls)

    def test_real_upstream_render_frames_from_saved_motion_in_separate_sessions(self):
        """Actual typed PlanRunner/SetFrame/RenderConfig, fixture scene only."""
        creator = ContractController()
        for stage in ("model1", "model2"):
            report = PlanRunner(creator).run(Plan.from_dict(build(stage, creator.rev)))
            self.assertTrue(report.completed, report.to_dict())
        motion = ContractController(
            existing=creator.saved["shuvi41-proof-stage2.blend"]["geometry"],
            revision=digest({"loaded": "real-motion-source-fixture"}),
        )
        saved = PlanRunner(motion).run(Plan.from_dict(build("motion", motion.rev)))
        self.assertTrue(saved.completed, saved.to_dict())
        checkpoint = motion.saved["shuvi41-proof-motion.blend"]
        original_motion = copy.deepcopy(checkpoint)
        seen_sessions = set()
        for stage, frame, z, filename in (
            ("motion_frame1", 1, 0.0, "shuvi41-proof-motion-frame001.png"),
            ("motion_frame24", 24, 1.5, "shuvi41-proof-motion-frame024.png"),
        ):
            fresh = ContractController(
                existing=checkpoint["geometry"],
                revision=digest({"new_source": stage}),
            )
            self.assertNotIn(fresh.session, seen_sessions)
            seen_sessions.add(fresh.session)
            plan = Plan.from_dict(build(stage, fresh.rev))
            self.assertEqual(plan.to_dict()["steps"][0]["request"]["operation"],
                             "animation.set_frame")
            result = PlanRunner(fresh).run(plan)
            self.assertTrue(result.completed, result.to_dict())
            self.assertEqual(fresh.calls,
                             ["animation.set_frame", "render.configure",
                              "scene.inspect", "render.execute"])
            self.assertEqual(fresh.current_frame, frame)
            self.assertEqual(fresh.objects["Shuvi41ProofMesh"]["transform"]["location"],
                             [0.0, 0.0, z])
            self.assertEqual(result.results["render"].status, Status.VERIFIED)
            self.assertEqual(result.results["render"].data["after"]["path"], filename)
            self.assertTrue(fresh.render_ready)
            self.assertEqual(fresh.active_camera, "Shuvi41ProofCamera")
            self.assertEqual(fresh.key_light, "Shuvi41ProofKey")
        self.assertEqual(checkpoint, original_motion,
                         "Independent frame proof must never modify saved source bytes")

    def test_real_upstream_motion_render_denies_stale_scene_without_render(self):
        worker = ContractController()
        report = PlanRunner(worker).run(
            Plan.from_dict(build("motion_frame1", "f" * 64))
        )
        self.assertFalse(report.completed)
        self.assertEqual(report.results["seek"].status, Status.FAILED)
        self.assertEqual(report.unexecuted_steps,
                         ("configure", "configured_scene", "render"))
        self.assertFalse(worker.render_ready)
        self.assertNotIn("render.execute", worker.calls)

    def test_actual_upstream_parser_accepts_three_fixed_production_recipes(self):
        for stage in ("model1", "model2", "render", "look", "look_render",
                      "motion", "motion_frame1", "motion_frame24"):
            native = build(stage, START_REV)
            parsed = Plan.from_dict(native)
            self.assertEqual(parsed.to_dict(), native)
            self.assertLessEqual(len(parsed.steps), 6)
            self.assertEqual(parsed.timeout_ms, 90_000)
            self.assertEqual(parsed.steps[-1].request.operation,
                             "render.execute" if stage in ("render", "look_render",
                                                          "motion_frame1", "motion_frame24")
                             else "file.checkpoint")

    def test_real_plan_runner_resolves_all_bindings_and_preserves_two_stage_geometry(self):
        owner = ContractController()
        first = PlanRunner(owner).run(Plan.from_dict(build("model1", owner.rev)))
        self.assertTrue(first.completed, first.to_dict())
        self.assertEqual(len(first.results), 6)
        self.assertTrue(all(r.status != Status.FAILED for r in first.results.values()))
        self.assertEqual(first.results["checkpoint"].status, Status.VERIFIED)
        original = owner.saved["shuvi41-proof-stage1.blend"]["mesh_fingerprint"]
        apex = owner.objects["Shuvi41ProofMesh"]["geometry"]["vertices"][4]
        self.assertAlmostEqual(apex[2], 1.45)

        second = PlanRunner(owner).run(Plan.from_dict(build("model2", owner.rev)))
        self.assertTrue(second.completed, second.to_dict())
        self.assertEqual(len(second.results), 6)
        self.assertEqual(second.results["checkpoint"].status, Status.VERIFIED)
        revised = owner.saved["shuvi41-proof-stage2.blend"]["mesh_fingerprint"]
        self.assertNotEqual(original, revised)
        self.assertAlmostEqual(owner.objects["Shuvi41ProofMesh"]["geometry"]["vertices"][4][2], 1.95)
        self.assertEqual(len(owner.objects), 3)
        self.assertEqual(owner.active_camera, "Shuvi41ProofCamera")
        self.assertEqual(owner.key_light, "Shuvi41ProofKey")
        self.assertEqual(owner.calls.count("mesh.translate_vertices"), 2)

        # New process/session in the real runtime. Here a fresh mocked
        # controller receives an independent copy of the saved scene.
        fresh = ContractController(
            existing=owner.saved["shuvi41-proof-stage2.blend"]["geometry"],
            revision=digest({"load": "stage2", "prior": owner.rev}),
        )
        self.assertNotEqual(owner.session, fresh.session)
        third = PlanRunner(fresh).run(Plan.from_dict(build("render", fresh.rev)))
        self.assertTrue(third.completed, third.to_dict())
        self.assertEqual(third.results["render"].status, Status.VERIFIED)
        self.assertTrue(fresh.render_ready)
        self.assertEqual(fresh.active_camera, "Shuvi41ProofCamera")
        self.assertEqual(fresh.key_light, "Shuvi41ProofKey")
        self.assertEqual(fresh.calls, ["render.configure", "scene.inspect", "render.execute"])
        self.assertEqual(fresh.objects["Shuvi41ProofMesh"]["geometry"]["vertices"][4][2], 1.95)

    def test_look_executes_real_upstream_typed_material_parser_and_checkpoint(self):
        creator = ContractController()
        self.assertTrue(PlanRunner(creator).run(Plan.from_dict(build("model1", creator.rev))).completed)
        self.assertTrue(PlanRunner(creator).run(Plan.from_dict(build("model2", creator.rev))).completed)
        stage2 = creator.saved["shuvi41-proof-stage2.blend"]
        fresh = ContractController(
            existing=stage2["geometry"], revision=digest({"load": "stage2", "previous": creator.rev})
        )
        result = PlanRunner(fresh).run(Plan.from_dict(build("look", fresh.rev)))
        self.assertTrue(result.completed, result.to_dict())
        self.assertEqual(len(result.results), 5)
        self.assertEqual(result.results["assign"].status, Status.VERIFIED)
        self.assertEqual(result.results["checkpoint"].status, Status.VERIFIED)
        self.assertIn("Shuvi41ProofCopper", fresh.objects["Shuvi41ProofMesh"]["materials"])
        self.assertEqual(fresh.active_camera, "Shuvi41ProofCamera")
        self.assertEqual(fresh.key_light, "Shuvi41ProofKey")
        self.assertEqual(fresh.calls, [
            "scene.inspect", "objects.list", "material.create_assign",
            "scene.inspect", "file.checkpoint"
        ])
        self.assertIn("shuvi41-proof-material.blend", fresh.saved)
        self.assertIsNone(stage2["geometry"]["Shuvi41ProofMesh"].get("materials"))

    def test_look_fails_closed_on_missing_target_without_checkpoint(self):
        fake = ContractController()
        result = PlanRunner(fake).run(Plan.from_dict(build("look", fake.rev)))
        self.assertFalse(result.completed)
        self.assertEqual(result.results["assign"].status, Status.FAILED)
        self.assertEqual(result.unexecuted_steps, ("post_look_scene", "checkpoint"))
        self.assertEqual(fake.saved, {})

    def test_look_rejects_stale_target_readback_after_pagination(self):
        seed = ContractController()
        self.assertTrue(PlanRunner(seed).run(Plan.from_dict(build("model1", seed.rev))).completed)
        original = seed.execute

        def invalidate_target(request):
            if request.operation == "material.create_assign":
                seed.objects["Shuvi41ProofMesh"]["revision"] = "f" * 64
            return original(request)

        seed.execute = invalidate_target
        result = PlanRunner(seed).run(Plan.from_dict(build("look", seed.rev)))
        self.assertFalse(result.completed)
        self.assertEqual(result.results["assign"].status, Status.FAILED)
        self.assertNotIn("shuvi41-proof-material.blend", seed.saved)

    def test_materialized_png_uses_separate_saved_look_checkpoint(self):
        worker = ContractController()
        for stage in ("model1", "model2"):
            self.assertTrue(PlanRunner(worker).run(Plan.from_dict(build(stage, worker.rev))).completed)
        look = ContractController(
            existing=worker.saved["shuvi41-proof-stage2.blend"]["geometry"],
            revision=digest({"material_source": "stage2"}))
        self.assertTrue(PlanRunner(look).run(Plan.from_dict(build("look", look.rev))).completed)
        self.assertIn("shuvi41-proof-material.blend", look.saved)
        saved = look.saved["shuvi41-proof-material.blend"]
        rendering = ContractController(
            existing=saved["geometry"], revision=digest({"render_source": "material"}))
        self.assertNotEqual(rendering.session, look.session)
        self.assertEqual(rendering.objects["Shuvi41ProofMesh"]["materials"],
                         ["Shuvi41ProofCopper"])
        report = PlanRunner(rendering).run(Plan.from_dict(build("look_render", rendering.rev)))
        self.assertTrue(report.completed, report.to_dict())
        self.assertEqual(report.results["render"].status, Status.VERIFIED)
        self.assertEqual(report.results["render"].data["after"]["path"],
                         "shuvi41-proof-material-render.png")
        self.assertEqual(rendering.calls,
                         ["render.configure", "scene.inspect", "render.execute"])
        self.assertNotIn("Shuvi41ProofCopper",
                         worker.saved["shuvi41-proof-stage2.blend"]["geometry"]["Shuvi41ProofMesh"].get("materials", []))

    def test_render_does_not_pass_without_verified_camera_and_key_light(self):
        fake = ContractController()
        result = PlanRunner(fake).run(Plan.from_dict(build("render", fake.rev)))
        self.assertFalse(result.completed)
        self.assertEqual(result.results["render"].status, Status.FAILED)
        self.assertIsNone(fake.active_camera)
        self.assertIsNone(fake.key_light)

    def test_camera_setup_failure_after_mesh_edit_never_saves_checkpoint(self):
        fake = ContractController()
        original = fake.execute

        def fail_camera(request):
            if request.operation == "device.create":
                return fake._result_failure(request, "camera creation failed")
            return original(request)

        fake.execute = fail_camera
        report = PlanRunner(fake).run(Plan.from_dict(build("model1", fake.rev)))
        self.assertFalse(report.completed)
        self.assertEqual(report.results["camera"].status, Status.FAILED)
        self.assertEqual(report.unexecuted_steps, ("post_camera_scene", "checkpoint"))
        self.assertEqual(fake.saved, {})

    def test_real_runner_does_not_run_following_commands_after_stale_first_step(self):
        ctrl = ContractController()
        wrong = build("model1", "0" * 64)
        report = PlanRunner(ctrl).run(Plan.from_dict(wrong))
        self.assertFalse(report.completed)
        self.assertEqual(report.results["create"].status, Status.FAILED)
        self.assertEqual(report.unexecuted_steps,
                         ("shape", "post_edit_scene", "camera", "post_camera_scene", "checkpoint"))
        self.assertEqual(ctrl.calls, ["mesh.create"])
        self.assertEqual(ctrl.saved, {})

    def test_real_parser_rejects_unknown_bindings_and_duplicate_requests(self):
        bad = build("model1", START_REV)
        bad["steps"][1]["bindings"][0]["source_step"] = "future_not_yet_run"
        with self.assertRaises(AgentError):
            Plan.from_dict(bad)
        duplicate = build("model1", START_REV)
        duplicate["steps"][1]["request"]["command_id"] = duplicate["steps"][0]["request"]["command_id"]
        with self.assertRaises(AgentError):
            Plan.from_dict(duplicate)

    def test_upstream_payload_decoders_enforce_geometry_and_render_bounds(self):
        first = build("model1", START_REV)["steps"][0]["request"]["payload"]
        created = CreateMesh.parse(first)
        self.assertEqual(len(created.geometry.vertices), 5)
        self.assertEqual(len(created.geometry.faces), 5)
        bad = copy.deepcopy(first)
        bad["geometry"]["faces"][0] = [0, 0, 1]
        with self.assertRaises(AgentError):
            CreateMesh.parse(bad)
        camera = build("model1", START_REV)["steps"][3]["request"]["payload"]
        self.assertTrue(CreateDevice.parse(camera).settings["make_active"])
        invalid_camera = copy.deepcopy(camera)
        invalid_camera["settings"]["clip_end"] = 0.05
        with self.assertRaises(AgentError):
            CreateDevice.parse(invalid_camera)
        lamp = build("model2", START_REV)["steps"][0]["request"]["payload"]
        self.assertEqual(CreateDevice.parse(lamp).settings["energy"], 950.0)
        config = build("render", START_REV)["steps"][0]["request"]["payload"]
        self.assertEqual(RenderConfig.parse(config).samples, 1)
        config["samples"] = 17
        with self.assertRaises(AgentError):
            RenderConfig.parse(config)

    def test_real_plan_runner_stops_after_post_mutation_checkpoint_failure(self):
        # The first mesh edit has already changed the virtual scene.
        # A checkpoint failure must NEVER be reported as completed or cause
        # a blind second attempt by the typed PlanRunner.
        from shuvi_blender_agent.errors import ErrorCode
        ctrl = ContractController()
        original = ctrl.execute

        def fail_checkpoint(request):
            if request.operation == "file.checkpoint":
                ctrl.calls.append("file.checkpoint")
                return Result(
                    request.request_id, request.command_id, Status.FAILED,
                    data={"outcome": "unknown"},
                    error=AgentError(ErrorCode.EXECUTION_ERROR, "Checkpoint outcome unknown"),
                )
            return original(request)

        ctrl.execute = fail_checkpoint
        result = PlanRunner(ctrl).run(Plan.from_dict(build("model1", START_REV)))
        self.assertFalse(result.completed)
        self.assertEqual(result.results["checkpoint"].status, Status.FAILED)
        self.assertTrue(result.to_dict()["outcome_unknown"])
        self.assertEqual(ctrl.calls.count("file.checkpoint"), 1)
        self.assertEqual(ctrl.calls.count("mesh.translate_vertices"), 1)
        self.assertEqual(ctrl.saved, {})

    def test_real_runner_rejects_mid_plan_geometry_state_change(self):
        # A different edit between mesh.inspect and vertex mutation makes
        # a previously bound geometry revision stale. The final checkpoint
        # must remain unexecuted.
        ctrl = ContractController()
        original = ctrl.execute

        def disturb(request):
            if request.operation == "mesh.translate_vertices":
                obj = ctrl.objects["Shuvi41ProofMesh"]
                obj["geometry"]["vertices"][4][2] += 0.75
            return original(request)

        ctrl.execute = disturb
        report = PlanRunner(ctrl).run(Plan.from_dict(build("model1", START_REV)))
        self.assertFalse(report.completed)
        self.assertEqual(report.results["shape"].status, Status.FAILED)
        self.assertEqual(report.unexecuted_steps, ("post_edit_scene", "camera", "post_camera_scene", "checkpoint"))
        self.assertEqual(ctrl.saved, {})

    def test_upstream_preflight_rejects_unknown_operation_before_dispatch(self):
        ctrl = ContractController()
        malicious = build("model1", START_REV)
        malicious["steps"][1]["request"]["operation"] = "python.exec"
        with self.assertRaises(ValueError):
            PlanRunner(ctrl).run(Plan.from_dict(malicious))
        self.assertEqual(ctrl.calls, [])
        self.assertEqual(ctrl.objects, {})

    def test_separate_stage_recipe_is_not_an_authorization_to_launch_or_replay(self):
        ctrl = ContractController()
        wrong_render = build("render", START_REV)
        ctrl.rev = "f" * 64
        report = PlanRunner(ctrl).run(Plan.from_dict(wrong_render))
        self.assertFalse(report.completed)
        self.assertEqual(ctrl.calls, ["render.configure"])
        self.assertEqual(report.results["configure"].status, Status.FAILED)
        self.assertEqual(report.unexecuted_steps, ("configured_scene", "render"))
        self.assertFalse(ctrl.render_ready)


if __name__ == "__main__":
    unittest.main()
