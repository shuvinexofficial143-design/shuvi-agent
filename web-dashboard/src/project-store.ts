/** Shuvi Level 11 browser-only project metadata; never touches host files. */
export const PROJECTS_KEY="shuvi.web.projects.v1";
export const MAX_PROJECTS=12;
export const MAX_ASSETS=40;
export const MAX_NOTES=40;
export const MAX_ASSOCIATIONS=40;
export type AssetKind="Reference"|"Video"|"Audio"|"Image"|"3D Model"|"Document"|"Other";
export type ProjectAsset={id:string;label:string;kind:AssetKind;reference:string;createdAt:number};
export type ProjectNote={id:string;text:string;createdAt:number};
export type ProjectWorkspace={
 id:string;name:string;description:string;createdAt:number;updatedAt:number;
 taskIds:string[];assets:ProjectAsset[];notes:ProjectNote[];
};
const idPattern=/^[a-zA-Z0-9_-]{1,80}$/;
const safeId=(x:unknown):x is string=>typeof x==="string"&&idPattern.test(x);
const safeTime=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const text=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
const safeArray=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const kinds:AssetKind[]=["Reference","Video","Audio","Image","3D Model","Document","Other"];
const unique=<T>(values:T[],key:(v:T)=>string,max:number):T[]=>{
 const seen=new Set<string>();const result:T[]=[];
 for(const value of values){const id=key(value);if(seen.has(id))continue;seen.add(id);result.push(value);if(result.length>=max)break;}
 return result;
};
export function normalizeProject(value:unknown):ProjectWorkspace|null {
 if(!value||typeof value!=="object")return null;
 const v=value as Record<string,unknown>;
 if(!safeId(v.id)||!safeTime(v.createdAt)||!safeTime(v.updatedAt))return null;
 const name=text(v.name,80);if(!name)return null;
 const assets=unique(safeArray(v.assets).map(x=>{
  if(!x||typeof x!=="object")return null;
  const a=x as Record<string,unknown>;
  if(!safeId(a.id)||!safeTime(a.createdAt))return null;
  const label=text(a.label,100);if(!label)return null;
  const kind=kinds.includes(a.kind as AssetKind)?a.kind as AssetKind:"Other";
  // Metadata-only user-entered label/reference. No network fetch, file read or upload.
  return {id:a.id,label,kind,reference:text(a.reference,220),createdAt:a.createdAt};
 }).filter((a):a is ProjectAsset=>a!==null),a=>a.id,MAX_ASSETS);
 const notes=unique(safeArray(v.notes).map(x=>{
  if(!x||typeof x!=="object")return null;
  const n=x as Record<string,unknown>;
  if(!safeId(n.id)||!safeTime(n.createdAt))return null;
  const body=text(n.text,550);return body?{id:n.id,text:body,createdAt:n.createdAt}:null;
 }).filter((n):n is ProjectNote=>n!==null),n=>n.id,MAX_NOTES);
 return {
  id:v.id,name,description:text(v.description,300),
  createdAt:v.createdAt,updatedAt:v.updatedAt,
  taskIds:unique(safeArray(v.taskIds).filter(safeId),x=>x,MAX_ASSOCIATIONS),
  assets,notes
 };
}
export function normalizeProjects(input:unknown):ProjectWorkspace[] {
 return unique(safeArray(input).map(normalizeProject).filter((p):p is ProjectWorkspace=>p!==null),p=>p.id,MAX_PROJECTS)
  .sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function readProjects():ProjectWorkspace[]{
 try{return normalizeProjects(JSON.parse(localStorage.getItem(PROJECTS_KEY)??"[]"));}
 catch{return [];}
}
export function writeProjects(projects:ProjectWorkspace[]):boolean{
 try{localStorage.setItem(PROJECTS_KEY,JSON.stringify(normalizeProjects(projects)));return true;}
 catch{return false;}
}
export function createProject(name:string,description:string):ProjectWorkspace|null {
 const label=text(name,80);if(!label)return null;
 const now=Date.now();return {
  id:crypto.randomUUID(),name:label,description:text(description,300),
  createdAt:now,updatedAt:now,taskIds:[],assets:[],notes:[]
 };
}
export function associateTask(project:ProjectWorkspace,taskId:string,enabled:boolean):ProjectWorkspace {
 if(!safeId(taskId))return project;
 const taskIds=enabled?unique([...project.taskIds,taskId],x=>x,MAX_ASSOCIATIONS)
  :project.taskIds.filter(id=>id!==taskId);
 if(taskIds.length===project.taskIds.length&&taskIds.every((id,i)=>id===project.taskIds[i]))return project;
 return {...project,taskIds,updatedAt:Date.now()};
}
export function addAsset(project:ProjectWorkspace,label:string,kind:string,reference:string):ProjectWorkspace|null{
 if(project.assets.length>=MAX_ASSETS)return null;
 const name=text(label,100);if(!name)return null;
 const asset:ProjectAsset={
  id:crypto.randomUUID(),label:name,kind:kinds.includes(kind as AssetKind)?kind as AssetKind:"Other",
  reference:text(reference,220),createdAt:Date.now()
 };
 return {...project,assets:[asset,...project.assets],updatedAt:Date.now()};
}
export function addNote(project:ProjectWorkspace,body:string):ProjectWorkspace|null{
 if(project.notes.length>=MAX_NOTES)return null;
 const safe=text(body,550);if(!safe)return null;
 return {...project,notes:[{id:crypto.randomUUID(),text:safe,createdAt:Date.now()},...project.notes],updatedAt:Date.now()};
}
export const ASSET_KINDS=kinds;
