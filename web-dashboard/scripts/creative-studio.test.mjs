import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const read = name => readFileSync(new URL("../"+name, import.meta.url),"utf8");
const markup = read("index.html");
const controller = read("src/creative-studio.ts");
const main = read("src/main.ts");
const stylesheet = read("src/creative-studio.css");
const data = read("src/dashboard-data.ts");
const compiled = await transform(data, {loader:"ts",format:"esm",target:"es2022"});
const {creativeModules,navItems} = await import("data:text/javascript;base64,"+Buffer.from(compiled.code).toString("base64"));

test("complete creative software inventory has the ten named Adobe integrations plus Blender and Remotion", () => {
  const expected = [
    "Premiere Pro", "After Effects", "Adobe Animate", "Audition", "Media Encoder",
    "Photoshop", "Illustrator", "Character Animator", "Substance 3D", "Frame.io",
    "Blender", "Remotion"
  ];
  assert.deepEqual(new Set(creativeModules.map(m => m.name)),new Set(expected));
  assert.equal(creativeModules.length,12);
  assert.equal(new Set(creativeModules.map(m => m.id)).size,12);
  for(const module of creativeModules){
    assert.ok(module.category && module.description && module.requirement,module.name+" missing details");
    assert.ok(module.capabilities.length >= 3,module.name+" needs capabilities");
    assert.ok(module.workflows.length >= 3,module.name+" needs workflow plans");
  }
  assert.ok(navItems.some(x=>x.id==="studio"));
});

test("each Level 9 control panel exposes functioning selections, tabs and workflow submission", () => {
  for(const id of [
    "studioAppSearch","studioAppList","studioHeroIcon","studioHeroName","studioHeroSource",
    "studioRuntimeSummary","studioPanelOverview","studioPanelCapabilities","studioPanelWorkflow",
    "studioOverviewWorkflows","studioFullCapabilities","studioPlanForm","studioPlanPreset",
    "studioPlanPriority","studioPlanTitle","studioDetailsButton","studioSettingsButton",
    "studioOpenTasks","studioPreflight","studioAppCount","creativeModuleGrid"
  ]){
    assert.ok(markup.includes('id="'+id+'"'),id+" element missing");
  }
  for(const name of ["overview","capabilities","workflow"]){
    assert.ok(controller.includes('"'+name+'"'),name+" tab missing");
    assert.ok(markup.includes('data-studio-tab="'+name+'"'));
  }
  assert.match(controller,/actions\.saveDraft\(summary, module\.name, priority\.value\)/);
  assert.match(controller,/actions\.navigate\("tasks"\)/);
  assert.match(controller,/button\.addEventListener\("click", \(\) => selectApp\(module\.id\)\)/);
  assert.match(controller,/localStorage\.setItem\(STORAGE_KEY,id\)/);
  assert.match(controller,/aria-selected/);
  assert.match(main,/mountCreativeStudio\(\{/);
  assert.match(main,/addDraftTask\(title, workspace, priority\)/);
});

test("no browser studio card can claim a verified connected Adobe or Blender runtime", () => {
  assert.match(controller,/Source available · runtime not verified/);
  assert.match(controller,/Separate repository · runtime not verified/);
  assert.match(markup,/Desktop bridge not connected/);
  assert.match(markup,/Not verified here/);
  assert.match(markup,/Source inventory ≠ runtime verified/);
  assert.match(markup,/Native acceptance/);
  assert.match(controller,/Review intended actions and approve them through the native permission gate/);
  assert.match(controller,/Pair an authenticated local Shuvi runtime/);
  assert.doesNotMatch(controller,/\binvoke\(|\bfetch\(|window\.__TAURI__|exec_command/);
  assert.doesNotMatch(controller,/api[_-]?key|private[_-]?token/i);
});

test("creative panels stay theme-responsive and keep old source catalog visible", () => {
  assert.match(main,/import "\.\/creative-studio\.css"/);
  assert.match(stylesheet,/var\(--shuvi-accent\)/);
  assert.match(stylesheet,/var\(--panel\)/);
  assert.match(stylesheet,/@media\(max-width:930px\)/);
  assert.match(stylesheet,/@media\(max-width:650px\)/);
  assert.match(markup,/<details class="studio-library-details">/);
  for(const filter of ["Video editing","Motion & VFX","3D & VFX","Audio",
    "Design & Image","Animation","Delivery","Review & Collaboration","Programmatic video"]){
      assert.ok(markup.includes('data-filter="'+filter+'"'),filter+" category filter missing");
  }
  assert.match(controller,/aria-pressed/);
});
