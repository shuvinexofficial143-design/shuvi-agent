import {
 readProjects,writeProjects,createProject,associateTask,addAsset,addNote,addWorkflow,withProjectEvent,
 PROJECTS_KEY,MAX_PROJECTS,MAX_ASSETS,MAX_NOTES,MAX_WORKFLOWS,type ProjectWorkspace
} from "./project-store";
import {readDelegations,WORKERS,type TaskDraftRef} from "./agent-planner";
import {readFlows} from "./visual-flow-store";

type ProjectActions={
 drafts():TaskDraftRef[];
 navigate(view:"tasks"|"agents"|"workflows"):void;
 openVisualBuilder(projectId:string):void;
 notify(message:string):void;
 activity(message:string):void;
};
export type ProjectUI={refresh():void};
const SELECTION_KEY="shuvi.web.project-selected.v1";
type Tab="tasks"|"assets"|"workflows"|"history";
const get=<T extends HTMLElement>(id:string):T=>{
 const v=document.getElementById(id);if(!v)throw Error("Missing project UI #"+id);return v as T;
};
function e<K extends keyof HTMLElementTagNameMap>(tag:K,cls="",content?:string):HTMLElementTagNameMap[K] {
 const node=document.createElement(tag);node.className=cls;
 if(content!==undefined)node.textContent=content;return node;
}
const date=(value:number):string=>new Date(value).toLocaleString();
function selectedFromStorage():string {
 try{return localStorage.getItem(SELECTION_KEY)??"";}catch{return "";}
}

export function mountProjectWorkspace(actions:ProjectActions):ProjectUI {
 let selectedId=selectedFromStorage();
 let currentTab:Tab="tasks";
 const projectsList=get<HTMLElement>("projectList");
 const details=get<HTMLElement>("projectDetail");
 const empty=get<HTMLElement>("projectEmpty");
 const createForm=get<HTMLFormElement>("projectCreateForm");
 const assetForm=get<HTMLFormElement>("projectAssetForm");
 const noteForm=get<HTMLFormElement>("projectNoteForm");
 const workflowForm=get<HTMLFormElement>("projectWorkflowForm");
 const workflowList=get<HTMLElement>("projectWorkflowList");
 const checklist=get<HTMLElement>("projectTaskChecklist");
 const delegationList=get<HTMLElement>("projectDelegations");
 const assetList=get<HTMLElement>("projectAssetList");
 const noteList=get<HTMLElement>("projectNoteList");
 const historyList=get<HTMLElement>("projectHistoryList");

 function current():ProjectWorkspace|null {
  return readProjects().find(p=>p.id===selectedId)??null;
 }
 function setSelected(id:string):void {
  selectedId=id;
  try{localStorage.setItem(SELECTION_KEY,id);}catch{ /* browser session works without persistence */ }
  refresh();
 }
 function commit(project:ProjectWorkspace,kind:string,description:string):boolean {
  const projects=readProjects();
  if(!projects.some(p=>p.id===project.id))return false;
  const next=withProjectEvent(project,kind,description);
  if(!writeProjects([next,...projects.filter(p=>p.id!==project.id)])){
   actions.notify("Browser storage unavailable. Project change was not saved.");
   return false;
  }
  actions.activity("Project: "+next.name+" · "+description);
  refresh();
  return true;
 }
 function renderList(projects:ProjectWorkspace[]):void {
  projectsList.replaceChildren();
  get<HTMLElement>("projectSidebarCount").textContent=String(projects.length);
  get<HTMLElement>("projectTotalCount").textContent=String(projects.length);
  const validTasks=new Set(actions.drafts().map(t=>t.id));
  get<HTMLElement>("projectTaskTotal").textContent=String(projects.reduce((sum,p)=>sum+p.taskIds.filter(id=>validTasks.has(id)).length,0));
  get<HTMLElement>("projectAssetTotal").textContent=String(projects.reduce((sum,p)=>sum+p.assets.length,0));
  if(!projects.length){
   projectsList.append(e("p","project-no-projects","No projects yet. Create your first workspace."));
   return;
  }
  for(const project of projects){
   const button=e("button","project-select");
   button.type="button";button.dataset.projectId=project.id;
   if(project.id===selectedId)button.classList.add("active");
   button.setAttribute("aria-pressed",String(project.id===selectedId));
   const mark=e("span","project-select-mark",project.name.slice(0,1).toLocaleUpperCase());
   const content=e("span","project-select-copy");
   content.append(e("strong","",project.name),e("small","",project.taskIds.length+" linked task IDs · "+project.assets.length+" references"));
   button.append(mark,content);
   button.addEventListener("click",()=>setSelected(project.id));
   projectsList.append(button);
  }
 }
 function setTab(tab:Tab):void{
  currentTab=tab;
  for(const b of document.querySelectorAll<HTMLButtonElement>("[data-project-tab]")){
   const active=b.dataset.projectTab===tab;
   b.classList.toggle("active",active);
   b.setAttribute("aria-selected",String(active));
  }
  for(const name of ["tasks","assets","workflows","history"] as Tab[]){
   get<HTMLElement>("projectTab"+name[0].toUpperCase()+name.slice(1)).hidden=name!==tab;
  }
 }
 function renderTaskLinks(project:ProjectWorkspace):void{
  const drafts=actions.drafts();
  const draftIndex=new Map(drafts.map(t=>[t.id,t]));
  checklist.replaceChildren();
  if(!drafts.length)checklist.append(e("div","project-placeholder","No task drafts saved in this browser. Create a draft in Tasks, then return here."));
  for(const task of drafts){
   const label=e("label","project-task-item");
   const checkbox=e("input") as HTMLInputElement;checkbox.type="checkbox";
   checkbox.checked=project.taskIds.includes(task.id);
   const text=e("span","project-task-name");
   text.append(e("strong","",task.title),e("small","",task.type+" · "+(task.priority??"Normal")+" priority"));
   label.append(checkbox,text);
   checkbox.addEventListener("change",()=>{
    const revised=associateTask(project,task.id,checkbox.checked);
    if(!commit(revised,"Task", (checkbox.checked?"Linked":"Unlinked")+" draft: "+task.title))checkbox.checked=!checkbox.checked;
   });
   checklist.append(label);
  }
  for(const taskId of project.taskIds.filter(x=>!draftIndex.has(x))){
   const orphan=e("div","project-orphan");
   orphan.append(e("span","","A previously linked task was removed from browser drafts."));
   const remove=e("button","project-inline-button","Unlink");
   remove.type="button";
   remove.addEventListener("click",()=>commit(associateTask(project,taskId,false),"Task","Removed missing draft association"));
   orphan.append(remove);
   checklist.append(orphan);
  }
  delegationList.replaceChildren();
  const matching=readDelegations().filter(plan=>project.taskIds.includes(plan.draftId));
  get<HTMLElement>("projectAgentCount").textContent=String(matching.length);
  if(!matching.length){delegationList.append(e("div","project-placeholder","No worker plans match linked task drafts. Link a draft and plan its worker under Agents."));return;}
  for(const plan of matching){
   const worker=WORKERS.find(w=>w.id===plan.workerId);
   const draft=draftIndex.get(plan.draftId);
   const row=e("div","project-agent-item");
   row.append(e("span","project-agent-icon",worker?.glyph??"✧"));
   const info=e("span","project-agent-copy");
   info.append(e("strong","",worker?.name??"Unknown worker"),e("small","",(draft?.title??"Deleted task draft")+" · PLANNED only"));
   row.append(info);
   delegationList.append(row);
  }
 }
 function renderAssets(project:ProjectWorkspace):void{
  assetList.replaceChildren();noteList.replaceChildren();
  get<HTMLElement>("projectFileCount").textContent=String(project.assets.length);
  if(!project.assets.length)assetList.append(e("div","project-placeholder","No asset references yet. Nothing has been uploaded or read from disk."));
  for(const asset of project.assets){
   const card=e("article","project-asset-item");
   const heading=e("span","project-asset-copy");
   heading.append(e("strong","",asset.label),e("small","",asset.kind+" · "+(asset.reference||"No filename/reference saved")));
   const remove=e("button","project-inline-button","Remove");
   remove.type="button";remove.setAttribute("aria-label","Remove asset reference "+asset.label);
   remove.addEventListener("click",()=>{
    commit({...project,assets:project.assets.filter(a=>a.id!==asset.id)},"Asset","Removed reference: "+asset.label);
   });
   card.append(e("span","project-asset-icon","▧"),heading,remove);assetList.append(card);
  }
  if(!project.notes.length)noteList.append(e("div","project-placeholder","No project notes saved."));
  for(const note of project.notes){
   const card=e("article","project-note-item");
   const body=e("div","");
   body.append(e("p","",note.text),e("small","",date(note.createdAt)));
   const remove=e("button","project-inline-button","Remove");
   remove.type="button";remove.setAttribute("aria-label","Remove project note");
   remove.addEventListener("click",()=>{
    commit({...project,notes:project.notes.filter(n=>n.id!==note.id)},"Note","Removed a project note");
   });
   card.append(body,remove);noteList.append(card);
  }
 }
 function renderWorkflows(project:ProjectWorkspace):void{
  workflowList.replaceChildren();
  const linkedVisual=readFlows().filter(flow=>flow.projectId===project.id);
  get<HTMLElement>("projectWorkflowCount").textContent=String(project.workflows.length+linkedVisual.length);
  const visualList=get<HTMLElement>("projectVisualFlows");
  visualList.replaceChildren();
  if(!linkedVisual.length)visualList.append(e("div","project-placeholder","No visual workflows linked yet. Open Visual Builder to create a connected step sequence."));
  for(const flow of linkedVisual){
   const row=e("button","project-select");
   row.type="button";
   const title=e("span","project-select-copy");
   title.append(e("strong","",flow.title),e("small","",flow.nodes.length+" visual steps · Browser plan"));
   row.append(e("span","project-select-mark","◇"),title);
   row.addEventListener("click",()=>actions.openVisualBuilder(project.id));
   visualList.append(row);
  }
  if(!project.workflows.length)workflowList.append(e("div","project-placeholder","No workflow plans yet. Save a plan for Blender, Adobe or Coding."));
  for(const workflow of project.workflows){
   const card=e("article","project-workflow-item");
   const body=e("div","project-workflow-copy");
   body.append(e("strong","",workflow.title),e("small","",workflow.app+" · Planned · "+date(workflow.createdAt)));
   if(workflow.steps)body.append(e("p","",workflow.steps));
   const remove=e("button","project-inline-button","Remove");
   remove.type="button";remove.setAttribute("aria-label","Remove workflow plan "+workflow.title);
   remove.addEventListener("click",()=>commit(
    {...project,workflows:project.workflows.filter(w=>w.id!==workflow.id)},
    "Workflow","Removed workflow plan: "+workflow.title
   ));
   card.append(e("span","project-asset-icon","◇"),body,remove);
   workflowList.append(card);
  }
 }
 function renderHistory(project:ProjectWorkspace):void{
  historyList.replaceChildren();
  const entries=project.history.slice().sort((a,b)=>b.createdAt-a.createdAt);
  if(!entries.length)historyList.append(e("div","project-placeholder","No project updates recorded yet. Project history begins with your first saved change."));
  for(const entry of entries){
   const item=e("div","project-history-item");
   const glyph=e("span","project-history-icon","◈");
   const detail=e("div","");
   detail.append(e("strong","",entry.detail),e("small","",entry.kind+" · "+date(entry.createdAt)));
   item.append(glyph,detail);
   historyList.append(item);
  }
 }
 function refresh():void{
  const projects=readProjects();
  let project=projects.find(p=>p.id===selectedId)??null;
  if(!project && projects.length){
   project=projects[0];
   selectedId=project.id;
   try{localStorage.setItem(SELECTION_KEY,selectedId);}catch{ /* fallback to in-memory selection */ }
  }
  renderList(projects);
  empty.hidden=Boolean(project);
  details.hidden=!project;
  if(!project)return;
  get<HTMLElement>("projectActiveTitle").textContent=project.name;
  get<HTMLElement>("projectActiveDescription").textContent=project.description||"No description added yet.";
  get<HTMLElement>("projectLinkedCount").textContent=String(project.taskIds.filter(id=>actions.drafts().some(t=>t.id===id)).length);
  renderTaskLinks(project);renderAssets(project);renderWorkflows(project);renderHistory(project);
  setTab(currentTab);
 }
 createForm.addEventListener("submit",event=>{
  event.preventDefault();
  const name=get<HTMLInputElement>("projectCreateName").value.trim();
  const description=get<HTMLTextAreaElement>("projectCreateDescription").value;
  const project=createProject(name,description);
  if(!project)return;
  const projects=readProjects();
  if(projects.length>=MAX_PROJECTS){actions.notify("Maximum 12 projects per browser workspace. Remove one to continue.");return;}
  const saved=withProjectEvent(project,"Project","Created project: "+project.name);
  if(!writeProjects([saved,...projects])){actions.notify("Browser storage unavailable; project not created.");return;}
  createForm.reset();setSelected(project.id);actions.activity("Created browser project: "+project.name);
  actions.notify("Project saved in this browser. No local files were accessed.");
 });
 assetForm.addEventListener("submit",event=>{
  event.preventDefault();const project=current();if(!project)return;
  if(project.assets.length>=MAX_ASSETS){actions.notify("This project supports up to 40 asset references.");return;}
  const name=get<HTMLInputElement>("projectAssetName").value;
  const kind=get<HTMLSelectElement>("projectAssetType").value;
  const reference=get<HTMLInputElement>("projectAssetRef").value;
  const updated=addAsset(project,name,kind,reference);if(!updated)return;
  if(commit(updated,"Asset","Saved asset reference: "+name.trim().slice(0,100))){assetForm.reset();actions.notify("Asset metadata saved. No file was uploaded.");}
 });
 workflowForm.addEventListener("submit",event=>{
  event.preventDefault();const project=current();if(!project)return;
  if(project.workflows.length>=MAX_WORKFLOWS){actions.notify("This project supports at most 24 workflow plans.");return;}
  const title=get<HTMLInputElement>("projectWorkflowTitle").value;
  const app=get<HTMLSelectElement>("projectWorkflowApp").value;
  const steps=get<HTMLTextAreaElement>("projectWorkflowSteps").value;
  const next=addWorkflow(project,title,app,steps);if(!next)return;
  if(commit(next,"Workflow","Saved workflow plan: "+title.trim().slice(0,100))){
   workflowForm.reset();
   actions.notify("Workflow plan saved. No software was opened.");
  }
 });
 noteForm.addEventListener("submit",event=>{
  event.preventDefault();const project=current();if(!project)return;
  if(project.notes.length>=MAX_NOTES){actions.notify("Project note limit reached (40).");return;}
  const note=get<HTMLTextAreaElement>("projectNoteText").value;
  const updated=addNote(project,note);if(!updated)return;
  if(commit(updated,"Note","Saved a project note")){noteForm.reset();actions.notify("Project note saved locally.");}
 });
 get<HTMLButtonElement>("projectExport").addEventListener("click",()=>{
  const project=current();if(!project)return;
  // Export contains only browser-entered project metadata. No real files or API keys.
  const snapshot=JSON.stringify({
   schema:"shuvi-browser-project-v1",exportedAt:new Date().toISOString(),
   origin:"Local browser planning metadata; no native file contents or execution history",
   project
  },null,2);
  const url=URL.createObjectURL(new Blob([snapshot],{type:"application/json"}));
  const a=e("a","");
  a.href=url;
  a.download="shuvi-project-"+project.id.slice(0,12)+".json";
  document.body.append(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  actions.notify("Project metadata exported as JSON. No local files were included.");
 });
 get<HTMLButtonElement>("projectDelete").addEventListener("click",()=>{
  const project=current();if(!project)return;
  if(!window.confirm("Delete project '"+project.name+"' and its saved notes and asset references? Existing task drafts and agent plans will not be deleted."))return;
  const remaining=readProjects().filter(p=>p.id!==project.id);
  if(!writeProjects(remaining)){actions.notify("Could not remove project from browser storage.");return;}
  selectedId=remaining[0]?.id??"";setSelected(selectedId);
  actions.activity("Deleted browser project: "+project.name);
  actions.notify("Project removed. Shared drafts and worker plans are untouched.");
 });
 get<HTMLButtonElement>("projectOpenTasks").addEventListener("click",()=>actions.navigate("tasks"));
 get<HTMLButtonElement>("projectOpenAgents").addEventListener("click",()=>actions.navigate("agents"));
 get<HTMLButtonElement>("projectOpenVisual").addEventListener("click",()=>{const project=current();if(project)actions.openVisualBuilder(project.id);});
 for(const tab of document.querySelectorAll<HTMLButtonElement>("[data-project-tab]")){
  tab.addEventListener("click",()=>{
   const target=tab.dataset.projectTab;
   if(target==="tasks"||target==="assets"||target==="workflows"||target==="history")setTab(target);
  });
 }
 refresh();
 return {refresh};
}
