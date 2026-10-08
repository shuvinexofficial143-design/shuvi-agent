import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("src/project-store.ts");
const ui=read("src/project-workspace.ts");
const html=read("index.html");
const main=read("src/main.ts");
const nav=read("src/dashboard-data.ts");
const css=read("src/project-workspace.css");
const {code}=await transform(source,{loader:"ts",format:"esm",target:"es2022"});
const store=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));

test("Project Workspace preserves only validated bounded browser metadata",()=>{
 const now=Date.now();
 const p={id:"proj-1",name:"Mahakal Lok 3D",description:"B".repeat(500),createdAt:now,updatedAt:now,
  taskIds:["task-1","task-1","bad<script>"],
  assets:[{id:"asset-1",label:"Reference",kind:"Image",reference:"C:\\images\\ref.jpg",createdAt:now}],
  notes:[{id:"note-1",text:"Review Cesium layout",createdAt:now}],
  history:[{id:"evt-1",kind:"Project",detail:"Created project",createdAt:now}]};
 const project=store.normalizeProject(p);
 assert.equal(project.name,"Mahakal Lok 3D");
 assert.equal(project.description.length,300);
 assert.deepEqual(project.taskIds,["task-1"]);
 assert.equal(project.assets[0].label,"Reference");
 assert.equal(project.notes[0].text,"Review Cesium layout");
 assert.equal(project.history[0].detail,"Created project");
 assert.equal(store.normalizeProject({...p,id:"<script>"}),null);
 assert.equal(store.normalizeProject({...p,createdAt:NaN}),null);
 assert.equal(store.normalizeProject({...p,name:"   "}),null);
 assert.equal(store.normalizeProjects([p,p]).length,1);
 assert.equal(store.MAX_PROJECTS,12);
 assert.equal(store.MAX_ASSETS,40);
 assert.equal(store.MAX_NOTES,40);
 assert.equal(store.MAX_HISTORY,60);
});

test("task association and unlinking are non-destructive to existing drafts",()=>{
 const now=Date.now();
 const base=store.normalizeProject({id:"pr",name:"Temple",description:"",createdAt:now,updatedAt:now,taskIds:[],assets:[],notes:[],history:[]});
 const linked=store.associateTask(base,"task-xyz",true);
 assert.deepEqual(linked.taskIds,["task-xyz"]);
 assert.deepEqual(store.associateTask(linked,"task-xyz",true).taskIds,["task-xyz"]);
 assert.deepEqual(store.associateTask(linked,"task-xyz",false).taskIds,[]);
 assert.deepEqual(base.taskIds,[]);
 assert.deepEqual(store.associateTask(base,"bad<script>",true).taskIds,[]);
});

test("asset references, notes and project history are data-only and bounded",()=>{
 const now=Date.now();
 let p=store.normalizeProject({id:"pr",name:"Temple",createdAt:now,updatedAt:now,taskIds:[],assets:[],notes:[],history:[]});
 p=store.addAsset(p,"Main reference","3D Model","temple.blend");
 assert.equal(p.assets[0].label,"Main reference");
 assert.equal(p.assets[0].kind,"3D Model");
 p=store.addNote(p,"Use top-view dimensions");
 assert.equal(p.notes[0].text,"Use top-view dimensions");
 p=store.withProjectEvent(p,"Asset","Saved a reference");
 assert.equal(p.history.length,1);
 assert.equal(p.history[0].detail,"Saved a reference");
 assert.equal(store.addAsset(p,"","",""),null);
 assert.equal(store.addNote(p,"   "),null);
 assert.doesNotMatch(source,/\bfetch\(|\binvoke\(|__TAURI__|new WebSocket|readFileSync\(/);
 assert.doesNotMatch(ui,/\bfetch\(|\binvoke\(|__TAURI__|new WebSocket/);
});

test("Project Workspace has functioning project create, link, asset, notes, history and deletion controls",()=>{
 for(const id of ["view-projects","projectCreateForm","projectCreateName","projectCreateDescription",
   "projectList","projectDetail","projectActiveTitle","projectDelete","projectTaskChecklist",
   "projectDelegations","projectAssetForm","projectAssetName","projectAssetType","projectAssetRef",
   "projectAssetList","projectNoteForm","projectNoteText","projectNoteList",
   "projectHistoryList","projectTabTasks","projectTabAssets","projectTabHistory"]){
    assert.ok(html.includes('id="'+id+'"'),"missing "+id);
 }
 assert.match(ui,/writeProjects\(\[saved,\.\.\.projects\]\)/);
 assert.match(ui,/associateTask\(project,task.id,checkbox.checked\)/);
 assert.match(ui,/readDelegations\(\)\.filter\(plan=>project.taskIds.includes\(plan.draftId\)\)/);
 assert.match(ui,/commit\(updated,"Asset"/);
 assert.match(ui,/commit\(updated,"Note"/);
 assert.match(ui,/window\.confirm\(/);
 assert.match(ui,/Existing task drafts and agent plans will not be deleted/);
 assert.match(ui,/project\.history\.slice\(\)\.sort/);
 assert.match(html,/nothing is uploaded or executed/);
 assert.match(html,/Not connected/);
});

test("Level 11 navigation + theme preserve agent, studio, timeline and desktop permissions",()=>{
 assert.match(nav,/id: "projects", label: "Projects"/);
 assert.match(main,/projects: \{ eyebrow: "PROJECT WORKSPACE"/);
 assert.match(main,/mountProjectWorkspace\(\{/);
 assert.match(main,/projectUI\?\.refresh\(\)/);
 assert.match(main,/import "\.\/project-workspace\.css"/);
 assert.match(main,/Alt\+1…Alt\+9 and Alt\+0/);
 assert.match(css,/var\(--shuvi-accent\)/);
 assert.match(css,/@media\(max-width:850px\)/);
 for(const page of ["view-agents","view-studio","view-tasks","view-chat"])assert.ok(html.includes('id="'+page+'"'));
});
