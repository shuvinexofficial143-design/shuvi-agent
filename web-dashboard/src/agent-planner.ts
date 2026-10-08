/**
 * Browser-only Master Agent planning data. These entries MUST NOT be confused
 * with executable tasks, worker processes, runtime approvals or job receipts.
 */
export const WORKERS = [
  {id:"blender",name:"Blender Worker",app:"Blender",category:"3D & modeling",glyph:"Bl",resource:"Desktop 3D / shared UI",
    description:"Plans scene, object, material and animation tasks for the separate Blender agent."},
  {id:"premiere",name:"Premiere Worker",app:"Premiere Pro",category:"Video editing",glyph:"Pr",resource:"Premiere project + shared UI",
    description:"Plans clip edits, captions, sequences, B-roll and export workflows."},
  {id:"after-effects",name:"Motion Worker",app:"After Effects",category:"Animation & VFX",glyph:"Ae",resource:"AE project + shared UI",
    description:"Plans compositions, animations, overlays and shot-level VFX tasks."},
  {id:"coding",name:"Coding Worker",app:"Coding Workspace",category:"Development",glyph:"⌘",resource:"Repository/workspace lock",
    description:"Plans repository implementation, checks, tests and code review."},
  {id:"browser",name:"Browser Worker",app:"Browser & Windows",category:"Browser automation",glyph:"◎",resource:"Shared desktop input",
    description:"Plans bounded web research and permission-gated browser interaction."},
  {id:"photoshop",name:"Design Worker",app:"Photoshop",category:"Graphic design",glyph:"Ps",resource:"Photoshop document + shared UI",
    description:"Plans layers, masks, text and visual asset preparation."}
] as const;
export type WorkerId = typeof WORKERS[number]["id"];
export interface TaskDraftRef {id:string;title:string;type:string;createdAt:number;priority?:string}
export interface DelegationPlan {
  id:string;
  draftId:string;
  workerId:WorkerId;
  instructions:string;
  createdAt:number;
}
export interface DelegationView {plan:DelegationPlan;draft:TaskDraftRef|null;worker:typeof WORKERS[number]}
const KEY="shuvi.web.master-delegation.v1";
const MAX=30;
const ids = new Set<string>(WORKERS.map(w=>w.id));
const validId=(value:unknown):value is string=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validTime=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>0;
export function validatePlan(value:unknown):DelegationPlan|null {
  if(!value||typeof value!=="object")return null;
  const v=value as Record<string,unknown>;
  if(!validId(v.id)||!validId(v.draftId)||!ids.has(v.workerId as string)||
    !validTime(v.createdAt)||typeof v.instructions!=="string")return null;
  return {id:v.id,draftId:v.draftId,workerId:v.workerId as WorkerId,
    instructions:v.instructions.trim().slice(0,240),createdAt:v.createdAt};
}
export function normalizePlans(input:unknown):DelegationPlan[] {
  if(!Array.isArray(input))return [];
  const idsSeen=new Set<string>();
  const plans:DelegationPlan[]=[];
  for(const candidate of input){
    const plan=validatePlan(candidate);
    if(!plan||idsSeen.has(plan.id))continue;
    idsSeen.add(plan.id);
    plans.push(plan);
    if(plans.length>=MAX)break;
  }
  return plans.sort((a,b)=>b.createdAt-a.createdAt);
}
export function readDelegations():DelegationPlan[] {
  try{return normalizePlans(JSON.parse(localStorage.getItem(KEY)??"[]"));}
  catch{return [];}
}
export function writeDelegations(value:DelegationPlan[]):boolean {
  try{localStorage.setItem(KEY,JSON.stringify(normalizePlans(value)));return true;}
  catch{return false;}
}
export function delegationViews(plans:DelegationPlan[],drafts:TaskDraftRef[]):DelegationView[] {
  const draftIndex=new Map(drafts.map(d=>[d.id,d]));
  return normalizePlans(plans).map(plan=>({
    plan,
    draft:draftIndex.get(plan.draftId)??null,
    worker:WORKERS.find(w=>w.id===plan.workerId)!
  }));
}
export function createDelegation(draft:TaskDraftRef,workerId:string,instructions:string):DelegationPlan|null {
  if(!validId(draft.id)||!ids.has(workerId)||!draft.title.trim())return null;
  return {
    id:"plan-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9),
    draftId:draft.id,workerId:workerId as WorkerId,
    instructions:instructions.trim().slice(0,240),createdAt:Date.now()
  };
}
export const DELEGATION_STORAGE_KEY=KEY;
