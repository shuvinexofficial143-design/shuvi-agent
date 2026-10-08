import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";

const read = file => readFileSync(new URL("../" + file, import.meta.url),"utf8");
const modelText = read("src/timeline-model.ts");
const timelineText = read("src/task-timeline.ts");
const mainText = read("src/main.ts");
const html = read("index.html");
const css = read("src/task-timeline.css");
const compiled = await transform(modelText, {loader:"ts",format:"esm",target:"es2022"});
const model = await import("data:text/javascript;base64,"+Buffer.from(compiled.code).toString("base64"));

test("real planning records are ordered, deduplicated and bounded", () => {
  const events = [
    {id:"e1",type:"Task",message:"Created draft for Blender",createdAt:100},
    {id:"e2",type:"Model",message:"Selected provider preference",createdAt:300},
    {id:"e1",type:"Task",message:"Duplicate event",createdAt:200},
    {id:"bad",type:"Task",message:"Missing date",createdAt:NaN}
  ];
  const drafts = [
    {id:"d1",title:"Premiere short",type:"Premiere Pro",priority:"High",createdAt:50},
    {id:"d2",title:"Blender model",type:"Blender",priority:"Normal",createdAt:75},
    {id:"d2",title:"Duplicate",type:"Blender",priority:"Low",createdAt:75}
  ];
  const data = model.buildTimelineSummary(events,drafts);
  assert.equal(data.events.length,2);
  assert.equal(data.events[0].id,"e2");
  assert.equal(data.taskEvents,1);
  assert.equal(data.drafts.length,2);
  assert.equal(data.drafts[0].title,"Blender model");
  assert.equal(data.latestEvent.createdAt,300);
});

test("real filters search only saved activity and never invent execution events", () => {
  const data = model.buildTimelineSummary([
    {id:"e1",type:"Task",message:"Created Premiere task",createdAt:100},
    {id:"e2",type:"Settings",message:"Saved bridge preference",createdAt:110},
    {id:"e3",type:"Routing",message:"Model routing preset",createdAt:120}
  ],[]);
  assert.equal(model.filterTimelineEvents(data.events,"Task","premiere").length,1);
  assert.equal(model.filterTimelineEvents(data.events,"all","bridge").length,1);
  assert.equal(model.filterTimelineEvents(data.events,"Model","").length,0);
  assert.equal(model.filterTimelineEvents(data.events,"Task","no match").length,0);
  const none = model.buildTimelineSummary([],[]);
  assert.equal(none.latestEvent,null);
  assert.deepEqual(none.events,[]);
});

test("untrusted browser records and overlong messages are constrained", () => {
  assert.equal(model.normalizeTimelineEvent({type:"Task",message:"x",createdAt:-1}),null);
  assert.equal(model.normalizeTimelineDraft({id:"bad",title:"",type:"Blender",createdAt:25}),null);
  const event = model.normalizeTimelineEvent({id:"x1",type:"random",message:"A".repeat(1000),createdAt:25});
  assert.equal(event.type,"Other");
  assert.equal(event.message.length,360);
  const draft = model.normalizeTimelineDraft({id:"p1",title:"B".repeat(1000),type:"Coding",priority:"surprise",createdAt:30});
  assert.equal(draft.priority,"Normal");
  assert.equal(draft.title.length,160);
});

test("exported timeline is metadata-only, no native fake receipts or credentials", () => {
  const data = model.buildTimelineSummary([{id:"e1",type:"Task",message:"Created draft",createdAt:100}],
    [{id:"d1",title:"Edit video",type:"Premiere",createdAt:101}]);
  const exported = JSON.parse(model.createPlanningTimelineExport(data));
  assert.equal(exported.schema,"shuvi-browser-planning-timeline-v1");
  assert.equal(exported.events[0].message,"Created draft");
  assert.equal(exported.draftMetadata[0].title,"Edit video");
  assert.doesNotMatch(JSON.stringify(exported),/"apiKey"|"secret"|"verified":true|"screenshot"/i);
  assert.match(exported.origin,/no native execution/);
});

test("interactive UI exposes safe filters, inspector, genuine unavailable states and no native invocation", () => {
  for(const id of ["timelineFilter","timelineSearch","timelineFeed","timelineInspector",
    "timelineDraftList","timelineExport","timelineShowingCount","timelineEventCount",
    "timelineTaskEventCount","timelineDraftCount"]){
      assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  }
  assert.match(html,/Native task receipts/);
  assert.match(html,/Screenshot history/);
  assert.match(html,/Not synced/);
  assert.match(html,/aria-label="Not synced">—/);
  assert.match(mainText,/mountTaskTimeline\(\{/);
  assert.match(mainText,/taskTimeline\?\.refresh\(\)/);
  assert.match(timelineText,/URL\.revokeObjectURL/);
  assert.match(timelineText,/createPlanningTimelineExport/);
  assert.match(timelineText,/aria-pressed/);
  assert.doesNotMatch(timelineText,/\binvoke\(|\bfetch\(|window\.__TAURI__/);
  assert.match(css,/@media\(max-width:700px\)/);
});
