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
  assert.match(host,/report\["blender_launch_performed"\] = True/);
  assert.match(host,/report\["post_trial_artifacts_rehashed"\] = False/);
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

test("fixed-motion proof checks exact saved action rather than sampling noise",()=>{
  const reopen=read("integrations/blender-worker/shuvi_blender_reopen.py");
  const offline=read("integrations/blender-worker/shuvi_blender_host_reverify.py");
  const regress=read("integrations/blender-worker/test_shuvi_blender_reopen.py");
  for(const signal of [
    "def _fixed_motion_keyframes_match(",
    'frames["current"] != 24',
    '"Shuvi41ProofMesh"',
    '"location"',
    'len(action["channels"]) != len(expected)',
    'point.get("interpolation") != "LINEAR"',
    'saved.name == "shuvi41-proof-motion.blend"',
    '"fixed_motion_keyframes_verified": reopened["fixed_motion_keyframes_verified"]',
  ]) assert.ok(reopen.includes(signal),signal);
  assert.match(host,/reopened\.get\("fixed_motion_keyframes_verified"\) is not True/);
  assert.match(host,/Motion result differs from authenticated source session/);
  assert.match(host,/Motion render differs from authenticated source session/);
  assert.match(offline,/receipt\.get\("motion_keyframes_independently_verified"\) is not True/);
  assert.match(regress,/test_fixed_motion_requires_real_z_motion_at_exact_frames_and_live_pose/);
  assert.match(fixture,/test_opted_motion_report_cannot_claim_semantics_without_receipt/);
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

test("real Windows Blender CI is tied to the triggering SHA and reruns when worker code changes",()=>{
  const real=read(".github/workflows/blender-windows-host-acceptance.yml");
  for(const path of [
    "feature/shuvi41-blender-worker",
    ".github/workflows/blender-upstream-contract-ci.yml",
    "'integrations/blender-worker/**'",
    "'src-tauri/src/blender_*.rs'",
    "src-tauri/src/lib.rs",
    "'scripts/blender-*.test.mjs'",
  ]) assert.ok(real.includes(path), "missing host CI change trigger: "+path);
  for(const proof of [
    "ref: ${{ github.sha }}",
    "$headBefore -ne $env:GITHUB_SHA",
    "git switch --quiet -c feature/shuvi41-blender-worker",
    "$trial.shuvi_source_sha -ne $env:GITHUB_SHA",
    "$trial.blender_launch_performed -ne $true",
    "$trial.completed_stages.Count -ne 8",
    "--verify-report $reports[0].FullName",
    "if: github.ref == 'refs/heads/feature/shuvi41-blender-worker'",
    "retention-days: 7",
  ]) assert.ok(real.includes(proof), "missing pinned live Windows proof guard: "+proof);
  assert.ok(!real.includes("ref: feature/shuvi41-blender-worker\n"), "must checkout immutable event SHA");
});
