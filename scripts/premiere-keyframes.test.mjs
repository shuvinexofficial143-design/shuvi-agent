import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const recipes = {module: {exports: {}}}; vm.createContext(recipes);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/recipe-plans.js", import.meta.url), "utf8"), recipes);

const audioPlans = {module: {exports: {}}}; vm.createContext(audioPlans);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/audio-plans.js", import.meta.url), "utf8"), audioPlans);

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
  const panel = { require: name => name === "./audio-plans.js" ? audioPlans.module.exports : name === "./recipe-plans.js" ? recipes.module.exports : name === "premierepro" ? premiere : name === "uxp" ? { entrypoints: { setup() {} } } : {} };
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
  const result = await f.panel.executeCommand({ action: "remove_video_transition", arguments: { track: 0, clipIndex: 0, position, _expected: await expectedTarget(f) } });
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

test("matching inspected expectations permit a native edit", async () => {
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
  await assert.rejects(f.panel.executeCommand(command), /requires inspected/);
  command.arguments._expected = await expectedTarget(f);
  await f.panel.executeCommand(command);
  assert.equal(f.actions.length, 1);
});

test("empty clip evidence cannot authorize a clip mutation", async () => {
  const f = fixture(); const expected = await expectedTarget(f); expected.clips = [];
  await assert.rejects(f.panel.executeCommand({action:"remove_video_transition", arguments:{track:0,clipIndex:0,position:"start",_expected:expected}}), /cover/);
  assert.equal(f.actions.length, 0);
});

test("ambiguous effect chains stay inspectable but cannot authorize numeric mutation", async()=>{
  const f=fixture();f.components.push(f.components[0]);
  const result=await f.panel.inspectClipEffects(f.args);
  assert.equal(result.components.length,2);
  assert.equal(result.targetSignature,null);
  assert.equal(result.indexMutationSupported,false);
  assert.match(result.signatureUnavailableReason,/Ambiguous/);
});

for (const kind of ['video','audio']) test(`${kind}: numeric effect indexes reject missing or changed chain evidence`, async () => {
  const f=fixture(kind); const sequence=await f.project.getActiveSequence();
  const signature=await f.panel.effectIndexSignature({project:f.project,sequence,item:f.item},kind,0,0);
  const resolve=kind==='video' ? f.panel.resolveEffectParam : f.panel.resolveAudioEffectParam;
  await assert.rejects(resolve(0,0,0,0), /inspect effects/);
  await resolve(0,0,0,0,signature);
  f.param.displayName='Changed';
  await assert.rejects(resolve(0,0,0,0,signature), /chain or clip changed/);
  assert.equal(f.actions.length,0);
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

test("timeline capability report refuses to infer vertical move, links, nesting or multicam", async () => {
  const f = fixture(); const report = await f.panel.executeCommand({action: "timeline_capabilities", arguments: {}});
  for (const name of ["verticalMove", "nativeLinkInspection", "replacementNesting", "multicam"]) {
    assert.equal(report[name].supported, false); assert.equal(report[name].fallbackImplemented, false);
  }
  assert.equal(report.verticalClone.supported, false);
  assert.equal(f.actions.length, 0);
});

test("timeline distinguishes selected state from unknown link membership", async () => {
  const f = fixture();
  Object.assign(f.item, {getDuration: async () => ({seconds: 10}), getSpeed: async () => 1, isDisabled: async () => false, getTrackIndex: async () => 0, getIsSelected: async () => true});
  const item = await f.panel.summarizeTrackItem(f.item, 0);
  assert.equal(item.selected, true); assert.equal(item.linkedGroup.supported, false);
});

test("clone rejects nonexistent vertical destination before creating native actions", async () => {
  const f = fixture(); const sequence = await f.project.getActiveSequence();
  sequence.getVideoTrackCount = async () => 1;
  for (const offset of [-1, 1]) await assert.rejects(f.panel.cloneClip({kind: "video", track: 0, clipIndex: 0, videoTrackOffset: offset}), /existing track/);
  assert.equal(f.actions.length, 0);
});

test("subsequence restores selection even if setting the temporary selection fails", async () => {
  const f = fixture(); const sequence = await f.project.getActiveSequence();
  const previous = {name: "previous"}; let selected = [previous]; let calls = 0;
  sequence.getSelection = async () => ({getTrackItems: async () => [...selected], removeItem: item => {selected = selected.filter(x => x !== item);}, addItem: item => selected.push(item)});
  sequence.setSelection = () => ++calls > 1;
  await assert.rejects(f.panel.createSubsequence({targets: [{kind: "video", track: 0, clipIndex: 0}]}), /could not set/);
  assert.equal(calls, 2); assert.deepEqual(selected, [previous]);
});

test("subsequence reports failed restoration without claiming selected-only content", async () => {
  const f = fixture(); const sequence = await f.project.getActiveSequence(); let calls = 0;
  sequence.getSelection = async () => ({getTrackItems: async () => [], removeItem() {}, addItem() {}});
  sequence.setSelection = () => ++calls === 1;
  sequence.createSubsequence = async () => ({guid: "new-sequence", getProjectItem: async () => ({getId: async () => "new-item"})});
  const result = await f.panel.createSubsequence({targets: [{kind: "video", track: 0, clipIndex: 0}]});
  assert.equal(result.created, true); assert.equal(result.selectionRestored, false); assert.equal(result.selectionSemanticsVerified, false);
});

function effectFixture(kind = "video") {
  const f = fixture(kind);
  const chain = {getComponentCount: () => f.components.length, getComponentAtIndex: index => f.components[index], createRemoveComponentAction: component => ({removeComponent: component})};
  f.item.getComponentChain = async () => chain;
  const {paramDisplayName, ...args} = f.args;
  return {...f, args, chain};
}
for (const kind of ["video", "audio"]) test(kind + ": inspected component removal uses one exact native action", async () => {
  const f = effectFixture(kind);
  const inspected = await f.panel.executeCommand({action: "inspect_effect_lifecycle", arguments: f.args});
  assert.equal(inspected.removal.supported, true); assert.equal(inspected.enableDisable.supported, false); assert.equal(inspected.enabled, null);
  const result = await f.panel.executeCommand({action: "remove_effect", arguments: {...f.args, expectedSignature: inspected.targetSignature}});
  assert.equal(result.transactionSucceeded, true); assert.equal(f.actions.length, 1); assert.equal(f.actions[0].removeComponent, f.components[0]);
});
test("component lifecycle rejects ambiguity and changed chain before edits", async () => {
  const f = effectFixture(); const inspected = await f.panel.inspectEffectLifecycle(f.args);
  f.components.unshift({getMatchName: () => "different", getDisplayName: () => "Different"});
  await assert.rejects(f.panel.removeEffect({...f.args, expectedSignature: inspected.targetSignature}), /chain changed/);
  f.components.push(f.components[1]);
  await assert.rejects(f.panel.inspectEffectLifecycle(f.args), /2 components/);
  assert.equal(f.actions.length, 0);
});
test("component lifecycle exposes missing removal API and rejected transaction", async () => {
  const f = effectFixture(); const inspected = await f.panel.inspectEffectLifecycle(f.args);
  f.chain.createRemoveComponentAction = undefined;
  assert.equal((await f.panel.inspectEffectLifecycle(f.args)).removal.supported, false);
  await assert.rejects(f.panel.removeEffect({...f.args, expectedSignature: inspected.targetSignature}), /unsupported/);
  assert.equal(f.actions.length, 0);
  f.chain.createRemoveComponentAction = () => ({}); f.project.executeTransaction = () => false;
  await assert.rejects(f.panel.removeEffect({...f.args, expectedSignature: inspected.targetSignature}), /rejected/);
});

test("recipe planning inspects exact parameter and returns an expectation without editing", async () => {
 const f = fixture(); f.param.getStartValue = async () => ({value: 100}); f.param.isTimeVarying = async () => false;
 const result = await f.panel.executeCommand({action: "plan_video_recipe", arguments: {track: 0, clipIndex: 0, request: {preset: "zoom_in", start_seconds: 0, end_seconds: 1, bindings: [{role: "scale", component_match_name: "effect.exact", param_display_name: "Amount", start_value: 100, end_value: 110}]}}});
 assert.equal(result.settings.length, 2); assert.equal(result.expected.clips.length, 1); assert.equal(result.applied, false); assert.equal(f.actions.length, 0);
});

test("audio automation route resolves named audio parameter without edits", async () => {
 const f = fixture("audio"); f.param.getStartValue = async () => ({value: 1}); f.param.isTimeVarying = async () => false;
 const result = await f.panel.executeCommand({action: "plan_audio_automation", arguments: {...f.args, request: {mode: "duck", duration_seconds: 10, baseline: 1, value_unit: "linear_amplitude", reduction_db: 12, attack_seconds: 0.2, release_seconds: 0.5, regions: [{start: 2, end: 5}]}}});
 assert.equal(result.applied, false); assert.equal(result.expected.clips[0].kind, "audio"); assert.equal(f.actions.length, 0);
 assert.equal(result.settings[0].param_display_name, "Amount");
});

test("shared clip resolvers revalidate active inspected signatures after async target lookup",()=>{
  assert.match(uxp,/async function assertResolvedClipMatchesActiveExpectation/);
  assert.match(uxp,/activeExpectation\?\.clips/);
  assert.match(uxp,/await clipTargetSignature\(project,sequence,item,kind,trackIndex,clipIndex\)/);
  assert.match(uxp,/Resolved Premiere clip changed after command preflight/);
  const video=uxp.slice(uxp.indexOf("async function getVideoClipTarget"),uxp.indexOf("async function listVideoEffects"));
  assert.match(video,/assertResolvedClipMatchesActiveExpectation\(project,sequence,item,"video",trackIndex,clipIndex\)/);
  const audio=uxp.slice(uxp.indexOf("async function getAudioClipTarget"),uxp.indexOf("async function listAudioEffects"));
  assert.match(audio,/assertResolvedClipMatchesActiveExpectation\(project,sequence,item,"audio",trackIndex,clipIndex\)/);
});

test("video and audio effect append require an exact bounded post-state delta",()=>{
  assert.match(uxp,/function unchangedComponentPrefix/);
  const video=uxp.slice(uxp.indexOf("async function addVideoEffect"),uxp.indexOf("async function resolveEffectParam"));
  assert.match(video,/before = await inspectClipEffects/);
  assert.match(video,/after = await inspectClipEffects/);
  assert.match(video,/after\.componentCount === before\.componentCount \+ 1/);
  assert.match(video,/unchangedComponentPrefix\(before\.components,after\.components\)/);
  assert.match(video,/verificationStatus:appended \? "verified_delta" : "accepted_unverified"/);
  const audio=uxp.slice(uxp.indexOf("async function addAudioEffect"),uxp.indexOf("async function resolveAudioEffectParam"));
  assert.match(audio,/before = await inspectAudioClipEffects/);
  assert.match(audio,/after = await inspectAudioClipEffects/);
  assert.match(audio,/after\.componentCount === before\.componentCount \+ 1/);
  assert.match(audio,/retrySafe:false/);
});

test("effect removal requires an exact bounded post-chain delta",()=>{
  const remove=uxp.slice(uxp.indexOf("async function removeEffect"),uxp.indexOf("// Rebuild writes only"));
  assert.match(remove,/before = args\.kind === "video"/);
  assert.match(remove,/after = args\.kind === "video"/);
  assert.match(remove,/after\.componentCount === before\.componentCount - 1/);
  assert.match(remove,/beforeSuffix\.length === afterSuffix\.length/);
  assert.match(remove,/verificationStatus:removed \? "verified_delta" : "accepted_unverified"/);
  assert.match(remove,/retrySafe:false/);
});

test("static video and audio parameter writes require native value readback",()=>{
  assert.match(uxp,/async function readStaticEffectValue/);
  assert.match(uxp,/param\.getStartValue\(\)/);
  assert.match(uxp,/verificationStatus:equivalentStaticEffectValue\(expected,observed\) \? "verified_readback" : "accepted_unverified"/);
  assert.match(uxp,/Math\.max\(0\.000001,Math\.abs\(expected\)\*0\.000001\)/);
  for(const [name,next] of [
    ["setEffectParam","addEffectKeyframe"],
    ["setVideoParamNamed","addVideoKeyframeNamed"],
    ["setAudioEffectParam","addAudioEffectKeyframe"],
    ["setAudioParamNamed","addAudioKeyframeNamed"]
  ]){
    const block=uxp.slice(uxp.indexOf("async function "+name),uxp.indexOf("async function "+next));
    assert.match(block,/await readStaticEffectValue/);
    assert.match(block,/retrySafe:false/);
  }
});
