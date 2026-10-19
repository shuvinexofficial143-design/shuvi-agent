import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const host=read("integrations/blender-worker/shuvi_blender_host_acceptance.py");
const fixture=read("integrations/blender-worker/test_shuvi_blender_host_acceptance.py");
const workflow=read(".github/workflows/blender-upstream-contract-ci.yml");

test("Blender real-host harness cannot launch by ordinary import or read-only probe",()=>{
  assert.match(host,/if not args\.run:\s*\n\s*print\(json\.dumps\(probe/);
  assert.match(host,/os\.environ\.get\(OPT_IN_ENV\) != "disposable-only" or not probe\["ready"\]/);
  assert.match(host,/if os\.name != "nt":/);
  assert.match(host,/sys\.dont_write_bytecode = True/);
  assert.match(host,/upstream_head != UPSTREAM_SHA/);
  assert.match(host,/branch != SHUVI_BRANCH/);
  assert.match(host,/status", "--porcelain"/);
  assert.match(host,/if parent == Path\(parent\.anchor\)/);
  assert.match(host,/if not _no_links\(upstream\) or not _no_links\(repo\)/);
  assert.match(host,/tempfile\.mkdtemp\(/);
  assert.match(host,/prefix="shuvi41-live-acceptance-"/);
  assert.doesNotMatch(host,/shell=True|os\.system\(|\beval\(|\bexec\(/);
});

test("actual acceptance stages bind checked PlanRunner to SHA/reopened evidence",()=>{
  for(const signal of [
    'verify_in_session_stage1(controller, stage1, next_view["revision"])',
    'checked_plan(controller, build(stage, revision)',
    'inspect_input_source(source, digest)',
    'validate_material_render_source(',
    'if files[stage]["blender_session_id"] != current["session_id"]',
    'digest.hexdigest() != sha',
    '"checkpoint_file_sha256") != sha',
    '"real_blender_upstream_acceptance_passed"',
    '"failed_or_partial_outcome_unknown"',
    '"native_shuvi_action_executed": False',
    '"visual_quality_verified": False',
    '"automatic_retry_allowed": False'
  ]) assert.ok(host.includes(signal),signal);
  assert.match(workflow,/test_shuvi_blender_host_acceptance\.py/);
  assert.match(fixture,/test_run_refused_without_both_controls/);
  assert.match(fixture,/test_failure_keeps_partial_outputs_and_never_retries/);
});

test("optional motion host trial is gated and verifies actual frame pixel differences",()=>{
  const offline=read("integrations/blender-worker/shuvi_blender_host_reverify.py");
  for(const proof of [
    'parser.add_argument("--include-motion", action="store_true"',
    'if args.include_motion and not args.run:',
    'run_trial(*trial_args, include_motion=True)',
    'MOTION_RECIPE_NAMES',
    'record("motion", controller, current["revision"]',
    '("motion_frame1", "motion_frame24")',
    'inspect_input_source(motion_source, files["motion"]["sha256"])',
    'motion_pair_requested',
  ])assert.ok(host.includes(proof),proof);
  for(const proof of [
    'MOTION_STAGES',
    'report.get("motion_pair_requested", False)',
    'source_role = ("look"',
    'previous["motion_frame1_pixels"] == previous["motion_frame24_pixels"]',
    'motion_pair_pixels_differ',
  ])assert.ok(offline.includes(proof),proof);
  assert.match(fixture,/test_eight_stage_motion_files_require_distinct_pixels_and_sha_lineage/);
  assert.match(fixture,/test_motion_pair_rejects_same_decoded_pixels_even_with_different_png_bytes/);
  assert.match(fixture,/test_motion_opt_in_cannot_promote_five_stage_or_reused_session/);
});
