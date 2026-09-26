import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL("../integrations/premiere-uxp/speed-workflows.js", import.meta.url), "utf8"), context);
const { planSpeed } = context.module.exports;
const snapshot = { sourceInSeconds: 2, sourceOutSeconds: 12, reversed: false };
test("speed presets and duration calculate source-relative multipliers", () => {
  assert.equal(planSpeed(snapshot, { mode: "preset", preset: "slow_motion" }).plan.duration_seconds, 20);
  assert.equal(planSpeed(snapshot, { mode: "preset", preset: "fast_motion" }).plan.duration_seconds, 5);
  assert.equal(planSpeed(snapshot, { mode: "duration", duration_seconds: 40 }).plan.rate, 0.25);
});
test("all plans explicitly refuse execution and preserve pitch/reverse intent", () => {
  const result = planSpeed(snapshot, { mode: "rate", rate: 2, reverse: true, preserve_audio_pitch: true });
  assert.equal(result.applied, false);
  assert.equal(result.executable, false);
  assert.equal(result.capability.status, "unsupported");
  assert.equal(result.plan.reverse, true);
  assert.equal(result.plan.preserve_audio_pitch, true);
});
test("ramp integrates constant and linear source-time rates", () => {
  const ramp = (a, b) => planSpeed(snapshot, { mode: "ramp", points: [{ source_offset_seconds: 0, rate: a }, { source_offset_seconds: 10, rate: b }] });
  assert.equal(ramp(2, 2).plan.duration_seconds, 5);
  assert.ok(Math.abs(ramp(1, 2).plan.duration_seconds - 10 * Math.log(2)) < 1e-9);
});
test("freeze uses an in-range source frame and positive duration", () => {
  assert.equal(planSpeed(snapshot, { mode: "freeze", source_seconds: 3, duration_seconds: 5 }).plan.source_seconds, 3);
  assert.throws(() => planSpeed(snapshot, { mode: "freeze", source_seconds: 12, duration_seconds: 5 }), /exclusive/);
});
test("rejects malformed and unbounded plans", () => {
  for (const request of [
    { mode: "rate", rate: NaN }, { mode: "rate", rate: -1 }, { mode: "rate", rate: 101 },
    { mode: "rate", rate: "2" }, { mode: "rate", rate: 1, reverse: "yes" },
    { mode: "rate", rate: 1, arbitrary_js: "bad" }, { mode: "duration", duration_seconds: 0 },
    { mode: "preset", preset: "__proto__" }, { mode: "ramp", points: [] },
    { mode: "ramp", points: [{ source_offset_seconds: 0, rate: 1 }, { source_offset_seconds: 0, rate: 2 }] },
    { mode: "ramp", points: [{ source_offset_seconds: 1, rate: 1 }, { source_offset_seconds: 10, rate: 2 }] }
  ]) assert.throws(() => planSpeed(snapshot, request));
  assert.throws(() => planSpeed({ ...snapshot, sourceOutSeconds: 1 }, { mode: "rate", rate: 1 }), /positive/);
});

test("native route reads the inspected clip and never starts an edit transaction", async () => {
  const item = {
    getName: async () => "Example", getStartTime: async () => ({ seconds: 5 }),
    getEndTime: async () => ({ seconds: 15 }), getInPoint: async () => ({ seconds: 2 }),
    getOutPoint: async () => ({ seconds: 12 }), getSpeed: async () => 1,
    isSpeedReversed: async () => 0
  };
  const sequence = { guid: "seq", getVideoTrack: async () => ({ getTrackItems: async () => [item] }) };
  const project = { guid: "proj", getActiveSequence: async () => sequence,
    executeTransaction: () => { throw new Error("Planner attempted a write"); } };
  const premiere = { Project: { getActiveProject: async () => project }, Constants: { TrackItemType: { CLIP: 1 } } };
  const panel = { require: name => {
    if (name === "./project-diagnostics.js") return {};
    if (name === "./caption-workflows.js" || name === "./mogrt-workflows.js" || name === "./graphics-batch.js") return {};
    if (name === "./audio-plans.js") return {};
    if (name === "./recipe-plans.js") return {};
    if (name === "uxp") return { entrypoints: { setup() {} } };
    if (name === "premierepro") return premiere;
    if (name === "./speed-workflows.js") return context.module.exports;
    throw new Error(`Unexpected module: ${name}`);
  } };
  vm.createContext(panel);
  vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8"), panel);
  const result = await panel.executeCommand({ action: "plan_clip_speed", arguments: { kind: "video", track: 0, clipIndex: 0, request: { mode: "rate", rate: 2 } } });
  assert.equal(result.plan.duration_seconds, 5);
  assert.equal(result.target.sequenceGuid, "seq");
  assert.equal(result.target.name, "Example");
  assert.equal(result.applied, false);
  await assert.rejects(panel.executeCommand({ action: "inspect_clip_speed", arguments: { kind: "video", track: 0, clipIndex: 1 } }), /not found/);
});
