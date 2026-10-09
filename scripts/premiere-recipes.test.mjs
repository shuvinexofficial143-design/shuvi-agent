import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const context = {module: {exports: {}}}; vm.createContext(context);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/recipe-plans.js", import.meta.url), "utf8"), context);
const {buildRecipePlan, COLOR} = context.module.exports;
const uxpSource=readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8");
const rustSource=readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const binding = (role, extra = {}) => ({role, component_match_name: "exact", param_display_name: role, start_value: 100, end_value: 110, keyframesSupported: true, timeVarying: false, ...extra});

test("zoom uses discovered selectors and native values without applying anything", () => {
 const plan = buildRecipePlan({preset: "zoom_in", start_seconds: 1, end_seconds: 3}, [binding("scale")]);
 assert.equal(plan.applied, false); assert.equal(plan.settings.length, 2);
 assert.equal(plan.settings[0].seconds, 1); assert.equal(plan.settings[1].seconds, 3); assert.equal(plan.settings[1].value, 110);
 assert.equal(plan.settings[0].param_display_name, "scale"); assert.equal(plan.frameReviewRequired, true);
});
test("Ken Burns and deterministic handheld produce bounded scalar/vector keys", () => {
 for (const preset of ["ken_burns", "handheld"]) {
  const bindings = [binding("position", {start_value: [0, 0], end_value: [10, 5]}), binding("scale"), binding("rotation", {start_value: 0, end_value: 0.5})];
  const request = {preset, start_seconds: 0, end_seconds: 4};
  const plan = buildRecipePlan(request, bindings);
  assert.deepEqual(plan, buildRecipePlan(request, bindings));
  assert.equal(plan.settings.length, preset === "handheld" ? 14 : 4);
  assert.ok(plan.settings.every(setting => setting.seconds >= 0 && setting.seconds <= 4));
 }
});
test("all eight color packs use explicit units, report missing roles and clamp bounds", () => {
 assert.equal(Object.keys(COLOR).length, 8);
 for (const preset of Object.keys(COLOR)) {
  const plan = buildRecipePlan({preset}, [binding("contrast", {current: 99, unit: 100, min: -100, max: 100})]);
  assert.equal(plan.applied, false); assert.equal(plan.settings.length, 1);
  assert.ok(plan.settings[0].value >= -100 && plan.settings[0].value <= 100);
  assert.ok(plan.skipped.length > 0);
 }
});
test("unsupported and animated color parameters are skipped without fabricated values", () => {
 const plan = buildRecipePlan({preset: "natural_correction"}, [binding("contrast", {unsupported: "not installed"}), binding("saturation", {timeVarying: true})]);
 assert.equal(plan.settings.length, 0); assert.equal(plan.skipped.length, 2);
});
test("invalid direction, times, strength, selectors and units fail", () => {
 assert.throws(() => buildRecipePlan({preset: "zoom_out", start_seconds: 0, end_seconds: 1}, [binding("scale")]), /decreasing/);
 assert.throws(() => buildRecipePlan({preset: "zoom_in", start_seconds: 2, end_seconds: 1}, [binding("scale")]), /seconds/);
 assert.throws(() => buildRecipePlan({preset: "zoom_in", start_seconds: 0, end_seconds: 1, strength: 2}, [binding("scale")]), /strength/);
 assert.throws(() => buildRecipePlan({preset: "natural_correction"}, [binding("contrast", {current: 0})]), /unit/);
 assert.throws(() => buildRecipePlan({preset: "natural_correction"}, [binding("contrast"), binding("contrast")]), /Duplicate/);
 assert.throws(() => buildRecipePlan({preset: "unknown"}, []), /Unknown/);
});


test("recipe application verifies every native setting readback",()=>{
 const video=uxpSource.slice(uxpSource.indexOf("async function applyVideoRecipe"),uxpSource.indexOf("async function applyAudioRecipe"));
 const audio=uxpSource.slice(uxpSource.indexOf("async function applyAudioRecipe"),uxpSource.indexOf("async function rollEdit"));
 for(const body of [video,audio]){
  assert.match(body,/settingReadbacks/);
  assert.match(body,/readAddedKeyframe/);
  assert.match(body,/readStaticEffectValue/);
  assert.match(body,/settingReadbacks\.length === settings\.length/);
  assert.match(body,/verificationStatus: verified \? "verified_recipe" : "accepted_unverified"/);
  assert.match(body,/retrySafe: false/);
 }
});

test("desktop recipe callers do not promote accepted-unverified mutations",()=>{
 for(const name of ["PremiereApplyVideoRecipe","PremiereApplyAudioRecipe","PremierePopulateMogrt","PremiereTranscriptDucking","PremiereApplySavedRecipe {"]){
  const start=rustSource.lastIndexOf("ToolAction::"+name);
  const end=rustSource.indexOf("\n        ToolAction::Premiere",start+10);
  const arm=rustSource.slice(start,end);
  assert.match(arm,/verified_recipe/);
  assert.match(arm,/success:\s*verified/);
 }
 const batch=rustSource.slice(rustSource.lastIndexOf("ToolAction::PremiereApplySavedRecipeBatch"),rustSource.indexOf("\n        ToolAction::PremiereDeleteRecipe",rustSource.lastIndexOf("ToolAction::PremiereApplySavedRecipeBatch")));
 assert.match(batch,/uncertain":!verified/);
 assert.match(batch,/if !verified/);
});
