import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("src/visual-flow-store.ts");
const ui=read("src/visual-workflow-ui.ts");
const main=read("src/main.ts");
const markup=read("index.html");
const nav=read("src/dashboard-data.ts");
const styles=read("src/visual-workflows.css");
const projects=read("src/project-workspace.ts");
const compiled=await transform(source,{loader:"ts",format:"esm",target:"es2022"});
const model=await import("data:text/javascript;base64,"+Buffer.from(compiled.code).toString("base64"));

test("five safe workflow templates are complete, distinct and source-only",()=>{
 assert.deepEqual(model.TEMPLATES.map(t=>t.id),["blender","premiere","motion","coding","blank"]);
 for(const template of model.TEMPLATES){
  assert.ok(template.label && template.description && template.app);
  assert.ok(template.nodes.length>=1 && template.nodes.length<=model.MAX_NODES);
  for(const step of template.nodes){
   assert.ok(model.NODE_KINDS.includes(step.kind) && step.title.trim());
  }
 }
 assert.ok(model.TEMPLATES[0].nodes.some(s=>s.kind==="Approval"));
 assert.equal(model.MAX_FLOWS,24);
 assert.equal(model.MAX_NODES,12);
});

test("create, reorder, edit, add and delete steps without executing native actions",()=>{
 const flow=model.makeFlow("blender","project-12");
 assert.equal(flow.projectId,"project-12");
 assert.equal(flow.nodes.length,6);
 const original=flow.nodes.map(s=>s.id);
 const changed=model.moveNode(flow,original[1],1);
 assert.equal(changed.nodes[1].id,original[2]);
 assert.equal(changed.nodes[2].id,original[1]);
 assert.equal(flow.nodes[1].id,original[1]);
 assert.equal(model.moveNode(flow,original[0],-1),flow);
 const edited=model.updateNode(flow,{...flow.nodes[0],kind:"Review",title:"Updated check",details:"Maharaj Mahakal"});
 assert.equal(edited.nodes[0].title,"Updated check");
 assert.equal(edited.nodes[0].kind,"Review");
 const extended=model.addNode(flow);
 assert.equal(extended.nodes.length,flow.nodes.length+1);
 const removed=model.removeNode(extended,extended.nodes.at(-1).id);
 assert.equal(removed.nodes.length,flow.nodes.length);
 const blank=model.makeFlow("blank");
 assert.equal(model.removeNode(blank,blank.nodes[0].id),blank);
 assert.equal(model.addNode({...flow,nodes:Array.from({length:12},(_,i)=>({...flow.nodes[0],id:"node-"+i}))}).nodes.length,12);
});

test("stored data rejects invalid records, duplicates and oversized user input",()=>{
 const flow=model.makeFlow("coding");
 const injected={...flow,id:"<bad>",nodes:flow.nodes};
 assert.equal(model.normalizeFlow(injected),null);
 assert.equal(model.normalizeFlow({...flow,nodes:[]}),null);
 assert.equal(model.normalizeFlow({...flow,createdAt:Infinity}),null);
 assert.equal(model.normalizeFlow({...flow,nodes:[{id:"bad",title:"",kind:"Start",details:""}]}),null);
 const over={...flow,title:"T".repeat(200),nodes:Array.from({length:22},(_,i)=>({
  id:"step-"+i,kind:"unknown",title:"M".repeat(200),details:"D".repeat(600)
 }))};
 const normalized=model.normalizeFlow(over);
 assert.equal(normalized.title.length,100);
 assert.equal(normalized.nodes.length,12);
 assert.equal(normalized.nodes[0].title.length,100);
 assert.equal(normalized.nodes[0].details.length,400);
 assert.equal(normalized.nodes[0].kind,"Action");
 assert.equal(model.normalizeFlows([flow,flow]).length,1);
 assert.equal(model.normalizeFlows(Array.from({length:40},(_,i)=>({...flow,id:"plan-"+i}))).length,24);
});

test("JSON export is versioned and strictly browser planning metadata",()=>{
 const flow=model.makeFlow("premiere");
 const payload=JSON.parse(model.exportFlow(flow));
 assert.equal(payload.schema,"shuvi-web-visual-workflow-v1");
 assert.equal(payload.workflow.nodes.length,6);
 assert.match(payload.origin,/browser planning only/);
 assert.doesNotMatch(source,/fetch\(|\binvoke\(|__TAURI__|WebSocket\(|spawn\(|exec\(/);
 assert.doesNotMatch(ui,/fetch\(|\binvoke\(|__TAURI__|WebSocket\(|spawn\(|exec\(/);
});

test("Level 12 UI has functional templates, inspector, project and task integration with safe status",()=>{
 for(const id of ["view-workflows","flowSavedList","flowTemplateList","flowEmptyState","flowCanvasWorkspace",
  "flowNodeCanvas","flowTotalCount","flowStepCount","flowLinkedProjectCount",
  "flowAddStep","flowSaveTask","flowSettingsForm","flowName","flowProject","flowStepForm",
  "flowNodeKind","flowNodeTitle","flowNodeDetails","flowMoveUp","flowMoveDown",
  "flowRemoveStep","flowExport","flowDelete","flowInspectorWorkspace"]){
   assert.ok(markup.includes('id="'+id+'"'),"Missing "+id);
 }
 assert.match(markup,/Runtime disconnected · Planning mode/);
 assert.match(markup,/An Approval step is a planned checkpoint/);
 assert.match(markup,/no application or AI worker executes them/);
 assert.match(ui,/writeFlows\(\[plan,\.\.\.current\]\)/);
 assert.match(ui,/persist\(updateNode\(plan/);
 assert.match(ui,/actions\.saveTaskDraft\(plan.title/);
 assert.match(ui,/actions\.onChange\(\)/);
 assert.match(ui,/URL\.revokeObjectURL\(url\)/);
 assert.match(main,/mountWorkflowBuilder\(\{/);
 assert.match(main,/workflowBuilder\?\.selectProject\(projectId\)/);
 assert.match(main,/if \(event.key === FLOW_KEY\)/);
 assert.match(nav,/id: "workflows", label: "Workflows"/);
 assert.match(projects,/readFlows\(\)\.filter\(flow=>flow.projectId===project.id\)/);
 assert.match(markup,/id="projectOpenVisual"/);
 assert.match(styles,/@media\(max-width:900px\)/);
 assert.match(styles,/var\(--shuvi-accent\)/);
});
