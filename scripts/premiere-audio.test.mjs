import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const moduleContext = {module: {exports: {}}}; vm.createContext(moduleContext);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/audio-plans.js", import.meta.url), "utf8"), moduleContext);
const {buildAudioPlan} = moduleContext.module.exports;
const request = {mode: "duck", duration_seconds: 20, baseline: 1, value_unit: "linear_amplitude", reduction_db: 20, attack_seconds: 0.5, release_seconds: 1, regions: [{start: 2, end: 5}]};
const inspected = {current: 1, keyframesSupported: true, timeVarying: false};
const plan = changes => buildAudioPlan({...request, ...changes}, {component_match_name: "native", param_display_name: "Volume"}, inspected);
test("ducking computes amplitude ratio and ordered attack/hold/release points", () => {
 const result = plan({}); assert.equal(result.applied, false); assert.equal(result.automaticSpeechDetection, false);
 assert.deepEqual(Array.from(result.settings, key => [key.seconds, key.value]), [[0,1],[1.5,1],[2,0.1],[5,0.1],[6,1],[20,1]]);
});
test("overlapping regions and short gaps merge deterministically", () => {
 const result = plan({regions: [{start: 6, end: 8}, {start: 2, end: 5}, {start: 3, end: 4}]});
 assert.equal(result.mergedRegions.length, 1); assert.equal(result.mergedRegions[0].end, 8);
 assert.equal(result.settings.filter(key => key.value === 0.1).length, 2);
});
test("dialogue at duration boundaries has no duplicate keys or false final recovery", () => {
 const result = plan({regions: [{start: 0, end: 20}]});
 assert.deepEqual(Array.from(result.settings, key => [key.seconds, key.value]), [[0,0.1],[20,0.1]]);
});
test("dB values use subtraction and native targets need explicit bounds", () => {
 const result = buildAudioPlan({...request, baseline: -3, value_unit: "db", reduction_db: 12}, {}, {...inspected, current: -3});
 assert.equal(result.settings[2].value, -15);
 assert.throws(() => plan({value_unit: "native", reduction_db: null, target_value: 0.3}), /bounds/);
});
test("fade and pan remain separate from dialogue input", () => {
 const result = plan({mode: "fade_out", regions: [], reduction_db: null, target_value: 0});
 assert.equal(result.settings.length, 2); assert.equal(result.settings[1].value, 0);
 assert.throws(() => plan({mode: "fade_in", regions: [], reduction_db: null, target_value: 0}), /direction/);
});
test("rejects stale baseline, existing automation, malformed regions and excessive keys", () => {
 assert.throws(() => buildAudioPlan(request, {}, {...inspected, current: 2}), /Baseline/);
 assert.throws(() => buildAudioPlan(request, {}, {...inspected, timeVarying: true}), /unanimated/);
 for (const changes of [{regions: []}, {regions: [{start: -1, end: 2}]}, {regions: [{start: 2, end: 21}]}, {attack_seconds: 0}, {reduction_db: 61}]) assert.throws(() => plan(changes));
 assert.throws(() => plan({duration_seconds: 100, regions: Array.from({length: 17}, (_,i) => ({start: 2 + i * 5, end: 3 + i * 5}))}), /64 keys/);
});
