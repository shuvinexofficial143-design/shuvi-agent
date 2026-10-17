"""Plan-only acceptance regression: no Blender process, no filesystem edits."""
import contextlib
import io
import json
import sys
import unittest

import shuvi_blender_acceptance as scenario

REV = "d" * 64
EXPECTED_OPS = {
    "model1": ["mesh.create", "mesh.translate_vertices", "scene.inspect",
               "device.create", "scene.inspect", "file.checkpoint"],
    "model2": ["device.create", "objects.list", "mesh.inspect",
               "mesh.translate_vertices", "scene.inspect", "file.checkpoint"],
    "render": ["render.configure", "scene.inspect", "render.execute"],
    "look": ["scene.inspect", "objects.list", "material.create_assign", "scene.inspect", "file.checkpoint"],
}


def lookup(source, path):
    result = source
    for segment in path:
        result = result[segment]
    return result


def assign(destination, path, value):
    result = destination
    for segment in path[:-1]:
        result = result[segment]
    result[path[-1]] = value


class AcceptanceRecipeTests(unittest.TestCase):
    def test_three_fixed_real_operation_sequences_fit_native_limits(self):
        for stage, operations in EXPECTED_OPS.items():
            recipe = scenario.build(stage, REV)
            self.assertEqual(recipe["timeout_ms"], 90000)
            self.assertEqual([s["request"]["operation"] for s in recipe["steps"]], operations)
            self.assertLessEqual(len(recipe["steps"]), 6)
            self.assertLess(len(json.dumps(recipe).encode()), 65536)
            self.assertEqual(recipe["steps"][-1]["request"]["operation"],
                             "render.execute" if stage == "render" else "file.checkpoint")

    def test_request_and_command_ids_distinct_including_across_phases(self):
        steps = [step for stage in EXPECTED_OPS
                 for step in scenario.build(stage, REV)["steps"]]
        requests = [step["request"]["request_id"] for step in steps]
        commands = [step["request"]["command_id"] for step in steps]
        self.assertEqual(len(requests), len(set(requests)))
        self.assertEqual(len(commands), len(set(commands)))
        self.assertTrue(set(requests).isdisjoint(set(commands)))

    def test_every_binding_references_existing_prior_step_and_payload_leaf(self):
        for stage in EXPECTED_OPS:
            seen = {}
            for step in scenario.build(stage, REV)["steps"]:
                for binding in step["bindings"]:
                    self.assertIn(binding["source_step"], seen)
                    self.assertGreaterEqual(len(binding["source_path"]), 2)
                    self.assertIsInstance(lookup(step["request"]["payload"],
                                                 binding["target_path"]), str)
                    self.assertTrue(lookup(step["request"]["payload"],
                                           binding["target_path"]).startswith("BOUND_"))
                seen[step["name"]] = step

    def test_geometry_is_five_vertices_and_closed_pyramid_faces(self):
        steps = scenario.build("model1", REV)["steps"]
        first = steps[0]["request"]["payload"]
        self.assertEqual(first["name"], scenario.MESH_NAME)
        self.assertEqual(first["expected_scene_revision"], REV)
        vertices = first["geometry"]["vertices"]
        faces = first["geometry"]["faces"]
        self.assertEqual(len(vertices), 5)
        self.assertEqual(len(faces), 5)
        for face in faces:
            self.assertTrue(all(0 <= n < len(vertices) for n in face))
            self.assertEqual(len(set(face)), len(face))
        self.assertEqual(steps[1]["request"]["payload"]["indices"], [4])
        self.assertEqual(steps[1]["request"]["payload"]["delta"], [0.0, 0.0, 0.25])

    def test_moving_mesh_binds_live_identity_and_geometry_revision(self):
        steps = scenario.build("model1", REV)["steps"]
        refs = steps[1]["bindings"]
        dests = [tuple(b["target_path"]) for b in refs]
        self.assertEqual(dests, [("target", "object_id"),
                                 ("target", "expected_revision"),
                                 ("expected_geometry_revision",)])
        outputs = {
            "create": {"data": {"after": {"object": {
                "object_id": "session:object-1", "revision": "c" * 64,
            }, "geometry": {"geometry_revision": "b" * 64}}}},
            "mesh_read": {"data": {"geometry_revision": "b" * 64}},
        }
        payload = json.loads(json.dumps(steps[1]["request"]["payload"]))
        for binding in refs:
            assign(payload, binding["target_path"],
                   lookup(outputs[binding["source_step"]], binding["source_path"]))
        self.assertEqual(payload["target"]["object_id"], "session:object-1")
        self.assertEqual(payload["target"]["expected_revision"], "c" * 64)
        self.assertEqual(payload["expected_geometry_revision"], "b" * 64)

    def test_second_plan_finds_exact_named_target_and_edits_same_session(self):
        steps = scenario.build("model2", REV)["steps"]
        self.assertEqual(steps[1]["request"]["payload"]["name_prefix"], scenario.MESH_NAME)
        self.assertEqual(steps[1]["request"]["payload"]["object_type"], "MESH")
        self.assertEqual(steps[3]["request"]["payload"]["target"]["expected_name"],
                         scenario.MESH_NAME)
        self.assertEqual(steps[3]["request"]["payload"]["delta"], [0.0, 0.0, 0.5])
        self.assertEqual(steps[-1]["request"]["payload"]["name"], scenario.STAGE2)

    def test_checkpoint_always_binds_post_mutation_scene_revision(self):
        for stage in ("model1", "model2"):
            steps = scenario.build(stage, REV)["steps"]
            self.assertEqual(steps[-2]["request"]["operation"], "scene.inspect")
            self.assertEqual(steps[-1]["bindings"], [
                {"source_step": "post_camera_scene" if stage == "model1" else "post_edit_scene",
                 "source_path": ["data", "revision"], "target_path": ["expected_scene_revision"]}
            ])
            self.assertTrue(steps[-1]["request"]["payload"]["name"].endswith(".blend"))

    def test_camera_and_lamp_have_explicit_safe_typed_properties(self):
        m1 = scenario.build("model1", REV)["steps"]
        camera = m1[3]["request"]["payload"]
        self.assertEqual(camera["kind"], "CAMERA")
        self.assertTrue(camera["settings"]["make_active"])
        self.assertEqual(camera["expected_scene_revision"], "BOUND_FROM_SCENE")
        self.assertEqual(m1[3]["bindings"][0]["source_step"], "post_edit_scene")
        self.assertEqual(m1[5]["bindings"][0]["source_step"], "post_camera_scene")
        m2 = scenario.build("model2", REV)["steps"]
        lamp = m2[0]["request"]["payload"]
        self.assertEqual(lamp["kind"], "POINT")
        self.assertEqual(lamp["name"], "Shuvi41ProofKey")
        self.assertEqual(lamp["expected_scene_revision"], REV)
        self.assertEqual(lamp["settings"]["energy"], 950.0)

    def test_look_builds_bounded_material_recipe_with_cas_bindings(self):
        steps = scenario.build("look", REV)["steps"]
        self.assertEqual(len(steps), 5)
        locate = steps[1]
        self.assertEqual(locate["request"]["payload"]["object_type"], "MESH")
        self.assertEqual(locate["request"]["payload"]["expected_revision"], "BOUND_FROM_SCENE")
        self.assertEqual(locate["bindings"][0]["source_step"], "scene")
        shader = steps[2]["request"]["payload"]
        self.assertEqual(shader["name"], "Shuvi41ProofCopper")
        self.assertEqual(shader["target"]["expected_name"], scenario.MESH_NAME)
        self.assertEqual(shader["base_color"], [0.8, 0.41, 0.16, 1.0])
        self.assertEqual([shader["metallic"], shader["roughness"]], [0.65, 0.31])
        self.assertEqual(steps[-1]["request"]["payload"]["name"], scenario.LOOK)
        self.assertEqual(steps[-1]["bindings"][0]["source_step"], "post_look_scene")

    def test_look_never_uses_render_or_replaces_original_stage_artifacts(self):
        look = scenario.build("look", REV)
        self.assertTrue(all(step["request"]["operation"] != "render.execute"
                            for step in look["steps"]))
        self.assertNotEqual(scenario.LOOK, scenario.STAGE2)
        self.assertNotEqual(scenario.LOOK, scenario.STAGE1)
        self.assertEqual(look["timeout_ms"], 90000)

    def test_look_cli_requires_separate_approved_source_session(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            rc = scenario.main(["--stage", "look", "--scene-revision", REV])
        self.assertEqual(rc, 0)
        message = json.loads(stdout.getvalue())
        self.assertTrue(message["supplementary_not_three_stage_acceptance"])
        self.assertTrue(message["requires_new_session_loading_verified_stage2"])
        self.assertFalse(message["render_action_approval_required"])
        self.assertEqual(message["output_file"], scenario.LOOK)

    def test_render_uses_small_cpu_budget_and_fresh_configured_revision(self):
        steps = scenario.build("render", REV)["steps"]
        cfg = steps[0]["request"]["payload"]
        self.assertEqual([cfg[k] for k in ("width", "height", "samples")], [64, 64, 1])
        self.assertEqual(cfg["expected_scene_revision"], REV)
        self.assertEqual(steps[-1]["request"]["payload"]["name"], scenario.STAGE3)
        self.assertEqual(steps[-1]["bindings"][0]["source_step"], "configured_scene")

    def test_stale_or_malformed_revision_is_rejected_before_plan(self):
        for bad in ("", "0" * 63, "g" * 64, "F" * 64, None, 1):
            for stage in EXPECTED_OPS:
                with self.assertRaises(ValueError):
                    scenario.build(stage, bad)

    def test_unknown_operation_or_stage_cannot_be_injected(self):
        with self.assertRaises(ValueError):
            scenario.build("arbitrary.python.run", REV)
        with self.assertRaises(ValueError):
            scenario.build("execute", REV)

    def test_cli_only_prints_plan_and_never_launches_blender(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = scenario.main(["--stage", "model1", "--scene-revision", REV])
        self.assertEqual(status, 0)
        message = json.loads(stdout.getvalue())
        self.assertEqual(message["mode"], "PLAN_ONLY_NO_BLENDER_LAUNCH")
        self.assertTrue(message["requires_separate_native_owner_approval"])
        self.assertFalse(message["render_action_approval_required"])
        self.assertEqual(message["plan"]["steps"][0]["request"]["operation"], "mesh.create")
        self.assertNotIn("bpy", sys.modules)


if __name__ == "__main__":
    unittest.main()
