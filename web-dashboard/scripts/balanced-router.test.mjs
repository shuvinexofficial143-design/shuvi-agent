import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BALANCED_MODE, ROLE_IDS, ROUTER_DEFAULTS, TEAM_SCOPE,
  MAX_PARALLEL_PLANNING, MAX_DESKTOP_CONTROLLERS, classifyBalancedTask
} from "../src/balanced-router.mjs";

const source = name => readFileSync(new URL("../src/" + name, import.meta.url), "utf8");

test("Balanced policy retains all eight role IDs and adds the three planned specialists", () => {
  assert.equal(BALANCED_MODE, "balanced");
  assert.equal(TEAM_SCOPE, "browser_preferences_only");
  assert.equal(ROLE_IDS.length, 11);
  assert.equal(new Set(ROLE_IDS).size, 11);
  for (const id of ["master","launcher","project","coding","video","image","video_gen","blender",
                    "motion","vision","reviewer"]) {
    assert.ok(ROLE_IDS.includes(id), id);
    assert.ok(ROUTER_DEFAULTS[id]?.model, id);
  }
  assert.equal(MAX_PARALLEL_PLANNING, 2);
  assert.equal(MAX_DESKTOP_CONTROLLERS, 1);
});

test("Simple native app launch selects fast PC specialist", () => {
  const plan = classifyBalancedTask("Open Premiere Pro");
  assert.equal(plan.roleId, "launcher");
  assert.equal(plan.tier, "fast");
  assert.equal(plan.activeWorkers, 0);
  assert.equal(plan.verifiedAvailability, false);
});

test("Coding, video editing, motion, Blender and quality review get matching roles", () => {
  assert.equal(classifyBalancedTask("Debug a GitHub repository login bug").roleId, "coding");
  assert.equal(classifyBalancedTask("Edit captions on the Premiere timeline").roleId, "video");
  assert.deepEqual(
    [classifyBalancedTask("Make a professional After Effects animation").roleId,
     classifyBalancedTask("Build an advanced Blender 3D scene").roleId],
    ["motion", "blender"]
  );
  assert.equal(classifyBalancedTask("Review the exported video quality").roleId, "reviewer");
  assert.equal(classifyBalancedTask("Organize project folders").roleId, "project");
});

test("Image/video generation requires modality-compatible endpoint and cost approval", () => {
  const image = classifyBalancedTask("Generate a thumbnail image");
  const video = classifyBalancedTask("Generate 10 B-roll clips");
  const vision = classifyBalancedTask("Analyze reference image");
  assert.deepEqual([image.roleId,image.modality,image.requiresCostApproval], ["image","image",true]);
  assert.deepEqual([video.roleId,video.modality,video.requiresCostApproval], ["video_gen","video",true]);
  assert.deepEqual([vision.roleId,vision.modality,vision.requiresCostApproval], ["vision","vision",false]);
  assert.equal(video.estimatedCost, null);
});

test("Requests never become execution authorization or verified provider availability", () => {
  for (const input of ["", "launch Chrome", "delete all files", "SOL 6.1 is free", "Generate a video"]) {
    const result = classifyBalancedTask(input);
    assert.equal(result.scope, "browser_preferences_only");
    assert.equal(result.requiresNativeRuntime, true);
    assert.equal(result.activeWorkers, 0);
    assert.equal(result.verifiedAvailability, false);
    assert.equal(result.estimatedCost, null);
  }
});

test("11-role web UI preserves existing settings key and exposes the dry-run preview", () => {
  const ui=source("ai-team-web-planner.ts"),css=source("telegram-team.css");
  assert.match(ui, /shuvi\.web\.ai-team-model-assignments\.v1/);
  assert.match(ui, /assignmentFor\(role\.id\)/);
  for(const role of ["motion","vision","reviewer"])assert.match(ui,new RegExp('id: "'+role+'"'));
  assert.match(ui, /Preview task routing/);
  assert.match(ui, /classifyBalancedTask\(previewInput\.value\)/);
  assert.match(ui, /No external calls or PC actions/);
  assert.match(css, /\.shuvi-route-preview/);
  assert.match(css, /max-width:580px/);
  assert.doesNotMatch(ui, /invoke\(|fetch\(|telegram_send_message|execute_action/);
});
