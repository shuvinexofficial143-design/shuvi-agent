/**
 * Level 12 browser-only visual workflow drafts.
 * Execution status is never inferred from locally saved nodes.
 */
export const FLOW_KEY="shuvi.web.visual-flows.v1";
export const MAX_FLOWS=24;
export const MAX_NODES=12;
export type FlowKind="Start"|"Action"|"Review"|"Approval"|"Export";
export type FlowNode={id:string;kind:FlowKind;title:string;details:string};
export type FlowPlan={
 id:string;title:string;projectId:string;templateId:string;
 createdAt:number;updatedAt:number;nodes:FlowNode[];
};
export type FlowTemplate={id:string;label:string;description:string;app:string;nodes:ReadonlyArray<Pick<FlowNode,"kind"|"title"|"details">>};
export const TEMPLATES:FlowTemplate[]=[
 {id:"blender",label:"Blender scene pipeline",app:"Blender",description:"Blockout → materials → verification → export",nodes:[
  {kind:"Start",title:"Confirm reference & scope",details:"Use supplied reference, target software and expected scene proportions"},
  {kind:"Action",title:"Block out corridor geometry",details:"Plan paths, walls, steps, pillars and layout in Blender"},
  {kind:"Action",title:"Plan materials and lighting",details:"Specify surfaces, environment and key lighting without changing the host"},
  {kind:"Review",title:"Inspect scene proportions",details:"Compare intended geometry against reference and note discrepancies"},
  {kind:"Approval",title:"Request user approval",details:"Any future file mutation must pass Shuvi's native permission gate"},
  {kind:"Export",title:"Plan final scene handoff",details:"Choose intended .blend output and verify only after native execution"}
 ]},
 {id:"premiere",label:"Premiere editing pipeline",app:"Premiere Pro",description:"Ingest → rough cut → captions → review",nodes:[
  {kind:"Start",title:"Review footage and brief",details:"Clarify footage, resolution and edit direction"},
  {kind:"Action",title:"Plan timeline rough cut",details:"Arrange best shots, remove pauses and decide pacing"},
  {kind:"Action",title:"Plan captions and B-roll",details:"Design readable captions and suitable background cutaways"},
  {kind:"Review",title:"Review creative edit",details:"Check pacing, color and audio before final export"},
  {kind:"Approval",title:"Request export approval",details:"User must approve output and native actions"},
  {kind:"Export",title:"Plan video export",details:"Specify expected codec, location and completion evidence"}
 ]},
 {id:"motion",label:"After Effects graphics",app:"After Effects",description:"Brief → composition → graphics → review",nodes:[
  {kind:"Start",title:"Read graphics brief",details:"Choose composition dimensions and duration"},
  {kind:"Action",title:"Plan compositions and layers",details:"Describe layout, animation layers and timing"},
  {kind:"Action",title:"Plan motion and depth",details:"Create captions, masks, foreground and background depth ideas"},
  {kind:"Review",title:"Inspect motion preview",details:"Verify timing and visual quality before export"},
  {kind:"Export",title:"Prepare render plan",details:"Target render queue only after local approval"}
 ]},
 {id:"coding",label:"Coding & verification",app:"Coding Workspace",description:"Scope → changes → tests → review",nodes:[
  {kind:"Start",title:"Inspect task requirements",details:"Confirm repository, branch, tests and safety limits"},
  {kind:"Action",title:"Plan implementation",details:"Define bounded source changes and dependencies"},
  {kind:"Review",title:"Run planned verification",details:"Describe tests and expected outcomes; no command is executed here"},
  {kind:"Approval",title:"Review before commit",details:"Keep protected files and external changes approval-first"},
  {kind:"Export",title:"Prepare handoff",details:"Summarize proposed changes and verification evidence"}
 ]},
 {id:"blank",label:"Blank workflow",app:"General",description:"Create your own step-by-step process",nodes:[
  {kind:"Start",title:"Define goal",details:"Describe the input and intended outcome"}
 ]}
];
const validId=(v:unknown):v is string=>typeof v==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const validTime=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const str=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
const kinds:FlowKind[]=["Start","Action","Review","Approval","Export"];
const defaultKind=(k:unknown):FlowKind=>kinds.includes(k as FlowKind)?k as FlowKind:"Action";
export const NODE_KINDS=kinds;
export function normalizeFlowNode(value:unknown):FlowNode|null {
 if(!value||typeof value!=="object")return null;
 const n=value as Record<string,unknown>;
 if(!validId(n.id))return null;
 const title=str(n.title,100);if(!title)return null;
 return {id:n.id,kind:defaultKind(n.kind),title,details:str(n.details,400)};
}
export function normalizeFlow(value:unknown):FlowPlan|null {
 if(!value||typeof value!=="object")return null;
 const v=value as Record<string,unknown>;
 if(!validId(v.id)||!validTime(v.createdAt)||!validTime(v.updatedAt))return null;
 const title=str(v.title,100);if(!title)return null;
 const used=new Set<string>();
 const nodes:FlowNode[]=[];
 for(const raw of Array.isArray(v.nodes)?v.nodes:[]){
  const node=normalizeFlowNode(raw);
  if(!node||used.has(node.id))continue;
  used.add(node.id);nodes.push(node);
  if(nodes.length>=MAX_NODES)break;
 }
 if(!nodes.length)return null;
 return {id:v.id,title,projectId:validId(v.projectId)?v.projectId:"",
  templateId:str(v.templateId,40),createdAt:v.createdAt,updatedAt:v.updatedAt,nodes};
}
export function normalizeFlows(value:unknown):FlowPlan[] {
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();const result:FlowPlan[]=[];
 for(const raw of value){
  const plan=normalizeFlow(raw);
  if(!plan||seen.has(plan.id))continue;
  seen.add(plan.id);result.push(plan);
  if(result.length>=MAX_FLOWS)break;
 }
 return result.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function readFlows():FlowPlan[] {
 try{return normalizeFlows(JSON.parse(localStorage.getItem(FLOW_KEY)??"[]"));}
 catch{return [];}
}
export function writeFlows(flows:FlowPlan[]):boolean {
 try{localStorage.setItem(FLOW_KEY,JSON.stringify(normalizeFlows(flows)));return true;}
 catch{return false;}
}
export function makeFlow(templateId:string,projectId=""):FlowPlan {
 const template=TEMPLATES.find(t=>t.id===templateId)??TEMPLATES.at(-1)!;
 const now=Date.now();
 return {id:crypto.randomUUID(),title:template.id==="blank"?"Untitled Workflow":template.label,
  templateId:template.id,projectId:validId(projectId)?projectId:"",
  createdAt:now,updatedAt:now,
  nodes:template.nodes.slice(0,MAX_NODES).map(n=>({id:crypto.randomUUID(),...n}))};
}
export function createNode(kind:FlowKind="Action"):FlowNode {
 return {id:crypto.randomUUID(),kind:defaultKind(kind),title:"New "+kind+" step",details:""};
}
export function updateNode(flow:FlowPlan,node:FlowNode):FlowPlan {
 const safe=normalizeFlowNode(node);if(!safe||!flow.nodes.some(n=>n.id===safe.id))return flow;
 return {...flow,updatedAt:Date.now(),nodes:flow.nodes.map(n=>n.id===safe.id?safe:n)};
}
export function moveNode(flow:FlowPlan,nodeId:string,delta:-1|1):FlowPlan {
 const position=flow.nodes.findIndex(n=>n.id===nodeId);
 const nextPosition=position+delta;
 if(position<0||nextPosition<0||nextPosition>=flow.nodes.length)return flow;
 const copy=[...flow.nodes];
 [copy[position],copy[nextPosition]]=[copy[nextPosition],copy[position]];
 return {...flow,updatedAt:Date.now(),nodes:copy};
}
export function addNode(flow:FlowPlan,kind:FlowKind="Action"):FlowPlan {
 if(flow.nodes.length>=MAX_NODES)return flow;
 return {...flow,updatedAt:Date.now(),nodes:[...flow.nodes,createNode(kind)]};
}
export function removeNode(flow:FlowPlan,nodeId:string):FlowPlan {
 if(flow.nodes.length<=1||!flow.nodes.some(n=>n.id===nodeId))return flow;
 return {...flow,updatedAt:Date.now(),nodes:flow.nodes.filter(n=>n.id!==nodeId)};
}
export function exportFlow(flow:FlowPlan):string {
 return JSON.stringify({schema:"shuvi-web-visual-workflow-v1",origin:"browser planning only; no native task actions or receipts",
  exportedAt:new Date().toISOString(),workflow:normalizeFlow(flow)},null,2);
}
