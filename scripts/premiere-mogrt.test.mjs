import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../integrations/premiere-uxp/mogrt-workflows.js", import.meta.url), "utf8");
const moduleContext = {module: {exports: {}}}; vm.createContext(moduleContext); vm.runInContext(source, moduleContext);
const {inspectProperties, planRecipe, capability, LIMITS, primitive} = moduleContext.module.exports;
function fixture(value = "Original") {
 const param = {displayName: "Native Field", getStartValue: async () => ({value}), areKeyframesSupported: async () => true, isTimeVarying: () => false, createKeyframe() {}, createSetValueAction() {}};
 const params = [param];
 const component = {getMatchName: async () => "native.graphics", getDisplayName: async () => "Localized Component", getParamCount: () => params.length, getParam: index => params[index]};
 const components = [component];
 const item = {getName: async () => "Clip", getMatchName: async () => "opaque.clip", getComponentChain: async () => ({getComponentCount: () => components.length, getComponentAtIndex: index => components[index]})};
 const field = {role: "text", component_match_name: "native.graphics", param_display_name: "Native Field", value: "New title"};
 const request = {preset: "title", fields: [field]};
 return {param, params, component, components, item, field, request};
}
for (const [value, next] of [["Original", "Title"], [12, 15], [true, false]]) test("inspects and plans primitive " + typeof value, async () => {
 const f = fixture(value); f.field.role = typeof value === "string" ? "text" : "property"; f.field.value = next;
 const inspected = await inspectProperties(f.item); const property = inspected.components[0].params[0];
 assert.equal(property.type, typeof value); assert.equal(property.value, value); assert.equal(property.editable, true);
 const plan = planRecipe(f.request, inspected); assert.equal(plan.settings[0].value, next); assert.equal(plan.applied, false);
});
test("text role on numeric parameter is skipped even when its name says Text", async () => {
 const f = fixture(12); f.param.displayName = "Text"; f.field.param_display_name = "Text";
 const result = planRecipe(f.request, await inspectProperties(f.item)); assert.equal(result.settings.length, 0); assert.match(result.skipped[0].reason, /string parameter/);
});
test("type mismatch never coerces", async () => {
 const f = fixture(12); f.field.role = "property";
 const result = planRecipe(f.request, await inspectProperties(f.item)); assert.equal(result.settings.length, 0); assert.match(result.skipped[0].reason, /no coercion/);
});
for (const mode of ["missing component", "ambiguous component", "missing parameter", "ambiguous parameter"]) test(mode + " cannot produce settings", async () => {
 const f = fixture();
 if (mode === "missing component") f.field.component_match_name = "missing";
 if (mode === "ambiguous component") f.components.push(f.component);
 if (mode === "missing parameter") f.field.param_display_name = "missing";
 if (mode === "ambiguous parameter") f.params.push(f.param);
 const result = planRecipe(f.request, await inspectProperties(f.item)); assert.equal(result.settings.length, 0); assert.equal(result.skipped.length, 1);
});
test("time-varying and unknown state are not static-editable", async () => {
 const f = fixture();
 for (const value of [true, null]) { f.param.isTimeVarying = () => value; const result = planRecipe(f.request, await inspectProperties(f.item)); assert.equal(result.settings.length, 0); }
});
test("unsupported complex and cyclic native values are not serialized or coerced", async () => {
 const cyclic = {}; cyclic.self = cyclic;
 for (const value of [{text:"Complex"}, [1,2], cyclic, Infinity, null]) {
  const f = fixture(value); const inspected = await inspectProperties(f.item); assert.equal(inspected.components[0].params[0].supported, false);
  assert.doesNotThrow(() => JSON.stringify(inspected)); assert.equal(planRecipe(f.request, inspected).settings.length, 0);
 }
});
test("duplicate exact selectors and aliases to same parameter are rejected", async () => {
 const f = fixture(); const inspected = await inspectProperties(f.item); f.request.fields.push({...f.field});
 assert.throws(() => planRecipe(f.request, inspected), /Duplicate/);
 f.request.fields[1] = {...f.field, component_match_name: null, component_display_name: "Localized Component"};
 assert.throws(() => planRecipe(f.request, inspected), /same parameter/);
});
test("oversized strings and excessive fields are rejected", async () => {
 const f = fixture(); const inspected = await inspectProperties(f.item); f.field.value = "x".repeat(2049);
 assert.throws(() => planRecipe(f.request, inspected), /bounded native primitive/);
 f.field.value = "ok"; f.request.fields = Array.from({length:17}, () => f.field); assert.throws(() => planRecipe(f.request, inspected), /1–16/);
});
test("inspection bounds components, parameters and output", async () => {
 const f = fixture("x".repeat(2048)); f.params.push(...Array.from({length:127}, () => f.param)); f.components.push(...Array.from({length:128}, () => f.component));
 const result = await inspectProperties(f.item); assert.equal(result.truncated, true); assert.ok(result.inspectedParamCount <= LIMITS.totalParams);
 assert.ok(JSON.stringify(result).length < 50000); assert.equal(planRecipe(f.request, result).settings.length, 0);
});
test("missing native setter and unreadable value remain unsupported", async () => {
 const f = fixture(); f.param.createSetValueAction = undefined;
 let result = await inspectProperties(f.item); assert.equal(result.components[0].params[0].editable, false);
 f.param.getStartValue = () => {throw Error("unreadable");}; result = await inspectProperties(f.item); assert.equal(result.components[0].params[0].supported, false);
});
test("capabilities never assert MOGRT identity or semantic field roles", async () => {
 const f = fixture(); const inspected = await inspectProperties(f.item); const plan = planRecipe(f.request, inspected);
 assert.equal(capability().native_mogrt_identity, false); assert.equal(capability().semantic_field_roles, false); assert.equal(plan.semanticFieldInference, false);
 assert.equal(plan.executionTool, "premiere_apply_video_recipe");
});
test("native route returns exact expectation and never edits", async () => {
 const f = fixture(); let writes = 0;
 Object.assign(f.item, {getStartTime: async () => ({ticks:"0",seconds:0}),getEndTime: async () => ({ticks:"100",seconds:1}),getInPoint:async () => ({ticks:"0",seconds:0}),getOutPoint:async () => ({ticks:"100",seconds:1}),getProjectItem:async () => ({getId:async () => "media"})});
 const sequence = {guid:"sequence", getVideoTrack:async () => ({getTrackItems:async () => [f.item]})};
 const project = {guid:"project",path:"C:/test.prproj",getActiveSequence:async () => sequence,executeTransaction:() => {writes++; throw Error("Unexpected edit");}};
 const premiere = {Project:{getActiveProject:async () => project},ProjectItem:{cast: x => x},Constants:{TrackItemType:{CLIP:1}}};
 const panel = {require:name => name === "premierepro" ? premiere : name === "uxp" ? {entrypoints:{setup(){}}} : name === "./mogrt-workflows.js" ? moduleContext.module.exports : {}};
 vm.createContext(panel);vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8"),panel);
 const args = {track:0,clipIndex:0,request:f.request};
 const inspected = await panel.executeCommand({action:"inspect_mogrt_properties",arguments:args});
 const result = await panel.executeCommand({action:"plan_mogrt_recipe",arguments:args});
 assert.equal(result.expected.project_guid,"project"); assert.equal(result.expected.sequence_guid,"sequence");
 assert.equal(result.expected.clips[0].signature,inspected.expected.clips[0].signature);assert.equal(result.expected.clips[0].kind,"video"); assert.equal(writes,0);
});


test("PointF and Color values are inspected and planned without coercion", async () => {
  for (const [native,next,type] of [
    [{x:0.25,y:0.75},{type:"point",x:0.5,y:0.4},"point"],
    [{red:0.1,green:0.2,blue:0.3,alpha:1},{type:"color",red:0.4,green:0.5,blue:0.6,alpha:1},"color"]
  ]) {
    const f=fixture(native);f.field.role="property";f.field.value=next;
    const inspected=await inspectProperties(f.item);
    assert.equal(inspected.components[0].params[0].type,type);
    assert.equal(inspected.components[0].params[0].editable,true);
    const plan=planRecipe(f.request,inspected);
    assert.equal(plan.settings.length,1);assert.deepEqual(JSON.parse(JSON.stringify(plan.settings[0].value)),next);
  }
  assert.equal(primitive({type:"color",red:2,green:0,blue:0,alpha:1}).supported,false);
  assert.equal(capability().structured_static_editing,true);
});
