import {
 FLOW_KEY,MAX_FLOWS,MAX_NODES,TEMPLATES,NODE_KINDS,
 readFlows,writeFlows,makeFlow,addNode,moveNode,removeNode,updateNode,normalizeFlow,exportFlow,
 type FlowPlan,type FlowNode,type FlowKind
} from "./visual-flow-store";
import {readProjects} from "./project-store";

type Actions={
 saveTaskDraft(title:string,workspace:string):void;
 notify(message:string):void;
 activity(message:string):void;
 onChange():void;
};
export type WorkflowBuilder={refresh():void;selectProject(id:string):void};
const KEY="shuvi.web.selected-visual-flow.v1";
const one=<T extends HTMLElement>(id:string):T=>{
 const result=document.getElementById(id);if(!result)throw Error("Missing flow element #"+id);
 return result as T;
};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls="",text?:string):HTMLElementTagNameMap[K]=>{
 const elem=document.createElement(tag);elem.className=cls;if(text!==undefined)elem.textContent=text;return elem;
};
const date=(value:number)=>new Date(value).toLocaleDateString();
function restoredSelection():string{try{return localStorage.getItem(KEY)??"";}catch{return "";}}
function rememberSelection(id:string):void{try{localStorage.setItem(KEY,id);}catch{ /* ephemeral selection */ }}

export function mountWorkflowBuilder(actions:Actions):WorkflowBuilder {
 let selectedId=restoredSelection();
 let selectedNodeId="";
 const list=one<HTMLElement>("flowSavedList");
 const templates=one<HTMLElement>("flowTemplateList");
 const canvas=one<HTMLElement>("flowNodeCanvas");
 const projectPicker=one<HTMLSelectElement>("flowProject");
 const settings=one<HTMLFormElement>("flowSettingsForm");
 const stepForm=one<HTMLFormElement>("flowStepForm");

 function active():FlowPlan|null{return readFlows().find(f=>f.id===selectedId)??null;}
 function select(id:string):void {
  selectedId=id;selectedNodeId="";rememberSelection(id);refresh();
 }
 function persist(next:FlowPlan,action:string):boolean {
  const flows=readFlows();
  if(!flows.some(f=>f.id===next.id))return false;
  const normalized=normalizeFlow(next);
  if(!normalized){actions.notify("Invalid workflow details; changes were not saved.");return false;}
  if(!writeFlows([normalized,...flows.filter(f=>f.id!==next.id)])){
   actions.notify("Browser storage unavailable. Workflow changes were not saved.");return false;
  }
  actions.activity("Workflow: "+normalized.title+" · "+action);
  actions.onChange();refresh();return true;
 }
 function renderTemplates():void {
  templates.replaceChildren();
  for(const template of TEMPLATES){
   const button=node("button","flow-template-card");button.type="button";
   button.dataset.templateId=template.id;
   button.append(node("strong","",template.label),node("small","",template.description),node("span","",template.app+" · "+template.nodes.length+" steps"));
   button.addEventListener("click",()=>{
    const current=readFlows();
    if(current.length>=MAX_FLOWS){actions.notify("Maximum 24 saved workflows per browser. Delete one first.");return;}
    const plan=makeFlow(template.id,projectPicker.value||"");
    if(!writeFlows([plan,...current])){actions.notify("Browser storage unavailable. Workflow was not created.");return;}
    actions.activity("Created visual workflow: "+plan.title);
    actions.onChange();select(plan.id);
    actions.notify("Visual workflow created. All steps are planning only.");
   });
   templates.append(button);
  }
 }
 function renderSaved(flows:FlowPlan[]):void {
  list.replaceChildren();
  one<HTMLElement>("flowTotalCount").textContent=String(flows.length);
  if(!flows.length){list.append(node("p","flow-blank","No workflows saved yet."));return;}
  for(const plan of flows){
   const button=node("button","flow-saved-item");button.type="button";
   button.dataset.flowId=plan.id;
   button.setAttribute("aria-pressed",String(plan.id===selectedId));
   if(plan.id===selectedId)button.classList.add("active");
   const copy=node("span","flow-saved-copy");
   copy.append(node("strong","",plan.title),node("small","",plan.nodes.length+" steps · Updated "+date(plan.updatedAt)));
   button.append(node("span","flow-saved-glyph","◇"),copy);
   button.addEventListener("click",()=>select(plan.id));
   list.append(button);
  }
 }
 function renderProjects(plan:FlowPlan):void {
  projectPicker.replaceChildren();
  const option=node("option","","No project linked");option.value="";projectPicker.append(option);
  const projects=readProjects();
  for(const project of projects){
   const opt=node("option","",project.name);opt.value=project.id;projectPicker.append(opt);
  }
  if(plan.projectId&&!projects.some(p=>p.id===plan.projectId)){
   const missing=node("option","","Project removed (reassign to continue)");
   missing.value=plan.projectId;projectPicker.append(missing);
  }
  projectPicker.value=plan.projectId;
  one<HTMLElement>("flowLinkedProjectCount").textContent=projects.find(p=>p.id===plan.projectId)?.name??(plan.projectId?"Missing project":"Unassigned");
 }
 function updateInspector(plan:FlowPlan):void {
  let activeNode=plan.nodes.find(n=>n.id===selectedNodeId);
  if(!activeNode){activeNode=plan.nodes[0];selectedNodeId=activeNode.id;}
  one<HTMLInputElement>("flowNodeTitle").value=activeNode.title;
  one<HTMLSelectElement>("flowNodeKind").value=activeNode.kind;
  one<HTMLTextAreaElement>("flowNodeDetails").value=activeNode.details;
  const index=plan.nodes.findIndex(n=>n.id===selectedNodeId);
  one<HTMLButtonElement>("flowMoveUp").disabled=index===0;
  one<HTMLButtonElement>("flowMoveDown").disabled=index===plan.nodes.length-1;
  one<HTMLButtonElement>("flowRemoveStep").disabled=plan.nodes.length<=1;
  one<HTMLButtonElement>("flowAddStep").disabled=plan.nodes.length>=MAX_NODES;
 }
 function renderCanvas(plan:FlowPlan):void{
  canvas.replaceChildren();
  const width=String(plan.nodes.length).padStart(2,"0");
  one<HTMLElement>("flowCanvasTitle").textContent=plan.title;
  one<HTMLElement>("flowStepCount").textContent=String(plan.nodes.length);
  plan.nodes.forEach((step,index)=>{
   const card=node("button","flow-step-card");
   card.type="button";
   card.dataset.nodeId=step.id;
   card.setAttribute("aria-pressed",String(step.id===selectedNodeId));
   if(step.id===selectedNodeId)card.classList.add("active");
   const number=node("span","flow-step-number",String(index+1).padStart(2,"0"));
   const copy=node("span","flow-step-copy");
   copy.append(node("small","",step.kind.toUpperCase()),node("strong","",step.title));
   if(step.details)copy.append(node("span","",step.details));
   const state=node("span","flow-step-state","DRAFT");
   card.append(number,copy,state);
   card.addEventListener("click",()=>{selectedNodeId=step.id;refresh();});
   canvas.append(card);
   if(index<plan.nodes.length-1){
    const edge=node("div","flow-node-edge");
    edge.setAttribute("aria-hidden","true");
    edge.append(node("span","","↓"));
    canvas.append(edge);
   }
  });
  const finish=node("div","flow-terminal-node","END · Plan saved, not run");
  canvas.append(finish);
 }
 function refresh():void{
  const flows=readFlows();
  let plan=flows.find(f=>f.id===selectedId)??null;
  if(!plan&&flows.length){plan=flows[0];selectedId=plan.id;rememberSelection(selectedId);selectedNodeId="";}
  renderSaved(flows);
  const exists=Boolean(plan);
  one<HTMLElement>("flowEmptyState").hidden=exists;
  one<HTMLElement>("flowCanvasWorkspace").hidden=!exists;
  one<HTMLElement>("flowInspectorEmpty").hidden=exists;
  one<HTMLElement>("flowInspectorWorkspace").hidden=!exists;
  if(!plan){
   one<HTMLElement>("flowStepCount").textContent="0";
   one<HTMLElement>("flowLinkedProjectCount").textContent="—";
   return;
  }
  one<HTMLInputElement>("flowName").value=plan.title;
  renderProjects(plan);
  if(!plan.nodes.some(n=>n.id===selectedNodeId))selectedNodeId=plan.nodes[0].id;
  renderCanvas(plan);updateInspector(plan);
 }
 settings.addEventListener("submit",event=>{
  event.preventDefault();const plan=active();if(!plan)return;
  const title=one<HTMLInputElement>("flowName").value.trim().slice(0,100);
  if(!title)return;
  const projectId=projectPicker.value;
  if(projectId&&!readProjects().some(p=>p.id===projectId)){
   actions.notify("Selected project no longer exists. Select another or Unassigned.");return;
  }
  const next={...plan,title,projectId,updatedAt:Date.now()};
  if(persist(next,"Updated workflow settings"))actions.notify("Workflow metadata saved.");
 });
 stepForm.addEventListener("submit",event=>{
  event.preventDefault();const plan=active();if(!plan)return;
  const current=plan.nodes.find(n=>n.id===selectedNodeId);if(!current)return;
  const title=one<HTMLInputElement>("flowNodeTitle").value.trim().slice(0,100);
  if(!title)return;
  const kind=one<HTMLSelectElement>("flowNodeKind").value as FlowKind;
  if(!NODE_KINDS.includes(kind))return;
  const details=one<HTMLTextAreaElement>("flowNodeDetails").value.trim().slice(0,400);
  if(persist(updateNode(plan,{...current,title,kind,details}),"Edited step: "+title)){
   actions.notify("Step changes saved as a browser plan.");
  }
 });
 one<HTMLButtonElement>("flowAddStep").addEventListener("click",()=>{
  const plan=active();if(!plan||plan.nodes.length>=MAX_NODES)return;
  const next=addNode(plan);
  selectedNodeId=next.nodes.at(-1)!.id;
  if(persist(next,"Added planning step"))actions.notify("New step added. Select it to edit.");
 });
 function move(delta:-1|1):void {
  const plan=active();if(!plan)return;
  const next=moveNode(plan,selectedNodeId,delta);
  if(next!==plan)persist(next,"Reordered planned steps");
 }
 one<HTMLButtonElement>("flowMoveUp").addEventListener("click",()=>move(-1));
 one<HTMLButtonElement>("flowMoveDown").addEventListener("click",()=>move(1));
 one<HTMLButtonElement>("flowRemoveStep").addEventListener("click",()=>{
  const plan=active();if(!plan||plan.nodes.length<=1)return;
  const item=plan.nodes.find(n=>n.id===selectedNodeId);
  if(item&&!window.confirm("Remove step '"+item.title+"' from this browser workflow?"))return;
  const next=removeNode(plan,selectedNodeId);
  selectedNodeId=next.nodes[0].id;
  persist(next,"Removed step: "+(item?.title??""));
 });
 one<HTMLButtonElement>("flowDelete").addEventListener("click",()=>{
  const plan=active();if(!plan)return;
  if(!window.confirm("Delete the saved visual workflow '"+plan.title+"'? Project data and existing task drafts will remain."))return;
  if(!writeFlows(readFlows().filter(f=>f.id!==plan.id))){
   actions.notify("Browser storage unavailable. Workflow not deleted.");return;
  }
  actions.activity("Deleted browser visual workflow: "+plan.title);
  actions.onChange();selectedId="";selectedNodeId="";refresh();
  actions.notify("Workflow deleted. Existing project notes and task drafts were preserved.");
 });
 one<HTMLButtonElement>("flowSaveTask").addEventListener("click",()=>{
  const plan=active();if(!plan)return;
  const first=TEMPLATES.find(t=>t.id===plan.templateId);
  actions.saveTaskDraft(plan.title,first?.app??"General");
  actions.notify("A task draft was saved. The workflow was NOT executed.");
 });
 one<HTMLButtonElement>("flowExport").addEventListener("click",()=>{
  const plan=active();if(!plan)return;
  const payload=exportFlow(plan);
  const url=URL.createObjectURL(new Blob([payload],{type:"application/json"}));
  const link=node("a");link.href=url;
  link.download="shuvi-flow-"+plan.id.slice(0,12)+".json";
  document.body.append(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  actions.notify("Browser workflow JSON exported. No native code or files included.");
 });
 renderTemplates();refresh();
 return {
  refresh,
  selectProject(projectId:string){
   const found=readFlows().find(f=>f.projectId===projectId);
   if(found)select(found.id);
   else{
    const plans=readFlows();
    if(plans.length>=MAX_FLOWS){actions.notify("Workflow limit reached. Delete an older plan first.");return;}
    const next=makeFlow("blank",projectId);
    if(!writeFlows([next,...plans])){actions.notify("Browser storage unavailable.");return;}
    actions.activity("Created project-linked workflow draft");
    actions.onChange();select(next.id);
   }
  }
 };
}
