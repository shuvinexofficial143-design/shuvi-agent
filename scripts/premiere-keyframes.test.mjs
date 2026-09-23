import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function fixture(kind = "video") {
  const actions = [];
  const times = [{ ticks: "100", seconds: 1 }, { ticks: "200", seconds: 2 }];
  const param = {
    displayName: "Amount", areKeyframesSupported: async () => true,
    getKeyframeListAsTickTimes: () => times,
    getValueAtTime: async time => time.seconds * 10,
    getKeyframePtr: () => ({ getTemporalInterpolationMode: async () => 0 }),
    createRemoveKeyframeAction: (time, update) => ({ remove: time, update }),
    createSetInterpolationAtKeyframeAction: (time, mode, update) => ({ interpolate: time, mode, update })
  };
  const component = { getMatchName: async () => "effect.exact", getDisplayName: async () => "Localized effect", getParamCount: async () => 1, getParam: async () => param };
  const components = [component];
  const item = {
    createRemoveVideoTransitionAction: position => ({ transitionPosition: position }),
    getName: async () => "Clip", getStartTime: async () => ({ ticks: "0", seconds: 0 }),
    getEndTime: async () => ({ ticks: "1000", seconds: 10 }),
    getInPoint: async () => ({ ticks: "0", seconds: 0 }), getOutPoint: async () => ({ ticks: "1000", seconds: 10 }),
    getProjectItem: async () => ({ getId: async () => "media-id" }),
    getComponentChain: async () => ({ getComponentCount: async () => components.length, getComponentAtIndex: async i => components[i] })
  };
  const track = { getTrackItems: async () => [item] };
  const sequence = { guid: { toString: () => "sequence-id" }, getVideoTrack: async () => track, getAudioTrack: async () => track };
  const project = { guid: { toString: () => "project-id" }, getActiveSequence: async () => sequence,
    lockedAccess: callback => callback(), executeTransaction: callback => { callback({ addAction: action => actions.push(action) }); return true; } };
  const premiere = { Project: { getActiveProject: async () => project }, ProjectItem: { cast: item => item },
    Constants: { TrackItemType: { CLIP: 1 }, InterpolationMode: { LINEAR: 0, HOLD: 1, BEZIER: 2 }, TransitionPosition: { START: 0, END: 1 } } };
  const panel = { require: name => name === "premierepro" ? premiere : name === "uxp" ? { entrypoints: { setup() {} } } : {} };
  vm.createContext(panel);
  vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8"), panel);
  const args = { kind, track: 0, clipIndex: 0, componentMatchName: "effect.exact", paramDisplayName: "Amount" };
  return { panel, args, actions, times, param, components, item, project };
}

for (const kind of ["video", "audio"]) test(`${kind}: inspect then remove exact native keyframe in one transaction`, async () => {
  const f = fixture(kind);
  const inspected = await f.panel.executeCommand({ action: "inspect_keyframes", arguments: f.args });
  assert.equal(inspected.total, 2);
  assert.equal(inspected.timeDomain, "native_parameter_ticks");
  assert.equal(inspected.keyframes[0].value, 10);
  assert.equal(inspected.keyframes[0].interpolation, "linear");
  assert.match(inspected.targetSignature, /project-id/);
  const edited = await f.panel.executeCommand({ action: "edit_keyframe", arguments: { ...f.args, operation: "remove", ticks: inspected.keyframes[0].ticks, expectedSignature: inspected.targetSignature } });
  assert.equal(edited.edited, true);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0].remove, f.times[0]);
});

test("interpolation uses native named constants, including zero-valued linear", async () => {
  const f = fixture();
  const inspected = await f.panel.inspectKeyframes(f.args);
  await f.panel.editKeyframe({ ...f.args, operation: "interpolation", interpolation: "linear", ticks: "100", expectedSignature: inspected.targetSignature });
  assert.equal(f.actions[0].mode, 0);
});

test("stale clip, absent keyframe and unsupported API never start a transaction", async () => {
  const f = fixture();
  const inspected = await f.panel.inspectKeyframes(f.args);
  const request = { ...f.args, operation: "remove", ticks: "100", expectedSignature: inspected.targetSignature };
  await assert.rejects(f.panel.editKeyframe({ ...request, ticks: "101" }), /missing or ambiguous/);
  f.param.createRemoveKeyframeAction = undefined;
  await assert.rejects(f.panel.editKeyframe(request), /unsupported/);
  f.item.getStartTime = async () => ({ ticks: "5", seconds: 0.05 });
  await assert.rejects(f.panel.editKeyframe(request), /target changed/);
  assert.equal(f.actions.length, 0);
});

test("ambiguous named components are rejected", async () => {
  const f = fixture();
  f.components.push(f.components[0]);
  await assert.rejects(f.panel.inspectKeyframes(f.args), /2 components/);
  assert.equal(f.actions.length, 0);
});

test("native transaction failure is surfaced", async () => {
  const f = fixture();
  const inspected = await f.panel.inspectKeyframes(f.args);
  f.project.executeTransaction = () => false;
  await assert.rejects(f.panel.editKeyframe({ ...f.args, operation: "remove", ticks: "100", expectedSignature: inspected.targetSignature }), /rejected/);
});

test("range uses [start,end), exact count, and one transaction", async () => {
  const f = fixture();
  const inspected = await f.panel.inspectKeyframes(f.args);
  const result = await f.panel.removeKeyframeRange({ ...f.args, startSeconds: 1, endSeconds: 2, expectedCount: 1, expectedSignature: inspected.targetSignature });
  assert.equal(result.count, 1);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0].remove.ticks, "100");
});

test("range rejects invalid bounds, stale counts and accidental all-key deletion", async () => {
  const f = fixture();
  const inspected = await f.panel.inspectKeyframes(f.args);
  const request = { ...f.args, startSeconds: 0, endSeconds: 3, expectedCount: 2, expectedSignature: inspected.targetSignature };
  for (const changes of [{ startSeconds: -1 }, { endSeconds: 0 }, { endSeconds: 86401 }, { expectedCount: 1 }, { expectedCount: 257 }]) {
    await assert.rejects(f.panel.removeKeyframeRange({ ...request, ...changes }));
  }
  await assert.rejects(f.panel.removeKeyframeRange(request), /every keyframe/);
  assert.equal(f.actions.length, 0);
  const result = await f.panel.removeKeyframeRange({ ...request, allowRemoveAll: true });
  assert.equal(result.count, 2);
});

test("unreadable or oversized keyframe values are explicitly unavailable", async () => {
  const f = fixture();
  f.param.getValueAtTime = async () => "large".repeat(1000);
  f.param.getKeyframePtr = () => { throw Error("not exposed"); };
  const inspected = await f.panel.inspectKeyframes(f.args);
  assert.equal(inspected.keyframes[0].valueAvailable, false);
  assert.equal(inspected.keyframes[0].interpolation, null);
});

for (const [position, native] of [["start", 0], ["end", 1]]) test(`transition removal targets only ${position}`, async () => {
  const f = fixture();
  const result = await f.panel.executeCommand({ action: "remove_video_transition", arguments: { track: 0, clipIndex: 0, position } });
  assert.equal(result.transactionSucceeded, true);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0].transitionPosition, native);
});

test("transition removal rejects both-ends, missing API and failed transaction", async () => {
  const f = fixture();
  const request = { track: 0, clipIndex: 0, position: "start" };
  await assert.rejects(f.panel.removeVideoTransition({ ...request, position: "both" }));
  f.project.executeTransaction = () => false;
  await assert.rejects(f.panel.removeVideoTransition(request), /rejected/);
  f.item.createRemoveVideoTransitionAction = undefined;
  await assert.rejects(f.panel.removeVideoTransition(request), /unsupported/);
  assert.equal(f.actions.length, 0);
});

async function expectedTarget(f) {
  const sequence = await f.project.getActiveSequence();
  return {project_guid: "project-id", sequence_guid: "sequence-id", clips: [{kind: "video", track: 0, clip_index: 0,
    signature: await f.panel.clipTargetSignature(f.project, sequence, f.item, "video", 0, 0)}]};
}

test("matching optional expectations permit a native edit", async () => {
  const f = fixture();
  await f.panel.executeCommand({action: "remove_video_transition", arguments: {track: 0, clipIndex: 0, position: "start", _expected: await expectedTarget(f)}});
  assert.equal(f.actions.length, 1);
});

for (const change of ["project", "sequence", "path", "clip"]) test(change + " changes fail before mutation and guard state resets", async () => {
  const f = fixture();
  const expected = await expectedTarget(f);
  if (change === "project") expected.project_guid = "other";
  if (change === "sequence") expected.sequence_guid = "other";
  if (change === "path") expected.project_path = "other.prproj";
  if (change === "clip") f.item.getStartTime = async () => ({ticks: "5", seconds: 0.05});
  const command = {action: "remove_video_transition", arguments: {track: 0, clipIndex: 0, position: "start", _expected: expected}};
  await assert.rejects(f.panel.executeCommand(command), /changed/);
  assert.equal(f.actions.length, 0);
  delete command.arguments._expected;
  await f.panel.executeCommand(command);
  assert.equal(f.actions.length, 1);
});

test("clip expectations must cover the edited target and both roll targets", async () => {
  const f = fixture(); const expected = await expectedTarget(f);
  await assert.rejects(f.panel.executeCommand({action: "remove_video_transition", arguments: {track: 0, clipIndex: 1, position: "start", _expected: expected}}), /cover/);
  await assert.rejects(f.panel.executeCommand({action: "roll_edit", arguments: {kind: "video", track: 0, leftClipIndex: 0, rightClipIndex: 1, _expected: expected}}), /cover/);
  assert.equal(f.actions.length, 0);
});

test("timeline produces inspectable signatures and plain project/sequence expectations", async () => {
  const f = fixture(); const sequence = await f.project.getActiveSequence();
  sequence.getVideoTrackCount = async () => 1; sequence.getAudioTrackCount = async () => 0;
  const track = await sequence.getVideoTrack(0); track.isMuted = async () => false;
  f.item.getDuration = async () => ({seconds: 10}); f.item.getSpeed = async () => 1;
  f.item.isDisabled = async () => false; f.item.getTrackIndex = async () => 0;
  const timeline = await f.panel.executeCommand({action: "inspect_timeline", arguments: {}});
  assert.equal(timeline.expected.project_guid, "project-id");
  assert.equal(timeline.expected.sequence_guid, "sequence-id");
  assert.equal(timeline.videoTracks[0].items[0].targetSignature, (await expectedTarget(f)).clips[0].signature);
});
