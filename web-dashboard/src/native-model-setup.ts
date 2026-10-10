/**
 * Windows-only model setup. API keys never enter localStorage or Vercel;
 * only a non-secret provider, endpoint and explicitly chosen model IDs persist.
 * Public xKiro /v1/models is retrieved through the trusted native Rust layer.
 */
import {NATIVE_MODEL_ROLES,validModelId,safeNativeEndpoint} from "./native-model-routing.mjs";
import {mountNativeBudgetSetup} from "./native-budget-setup";
export type NativeInvoke = <T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
export type ProviderInfo = {id:string;name:string;default_model:string;api_key_required:boolean;custom_base_url:boolean};
export type ModelTeamConfig = {provider:string;base_url:string;roles:Record<string,string>};
export type ModelTeamHandle = {current():ModelTeamConfig|null};
type CatalogItem={id:string;display_name:string;access_tier:string;pricing?:{input?:number;output?:number};tools?:boolean};
const STORAGE="shuvi.native.model.team.v1";
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text=""):HTMLElementTagNameMap[K]=>{
 const n=document.createElement(tag);if(text)n.textContent=text;return n;
};
function load():ModelTeamConfig|null{
 try{
  const text=window.localStorage.getItem(STORAGE);
  if(!text||text.length>16000)return null;
  const parsed=JSON.parse(text) as ModelTeamConfig;
  if(!parsed||typeof parsed.provider!=="string"||typeof parsed.base_url!=="string"||
    !parsed.roles||typeof parsed.roles!=="object"||Array.isArray(parsed.roles))return null;
  const roles:Record<string,string>={};
  for(const [id] of NATIVE_MODEL_ROLES){
   const value=parsed.roles[id];
   if(validModelId(value))roles[id]=value;
  }
  return {provider:parsed.provider,base_url:parsed.base_url.slice(0,1024),roles};
 }catch{return null;}
}
function normalizeUrl(provider:string,value:string):string|null {
 if(provider==="xkiro")return value.trim()==="https://api.xkiro.com/v1"?"":null;
 if(provider==="custom"){
  const result=safeNativeEndpoint("custom",value);
  return result||null;
 }
 if(provider==="ollama"){
  const result=safeNativeEndpoint("ollama",value);
  return result||null;
 }
 return value.trim()===""?"":null;
}
function modelLabel(m:CatalogItem):string{
 const tier=["free","paid","premium"].includes(m.access_tier)?m.access_tier:"price unknown";
 const price=m.pricing&&typeof m.pricing.input==="number"&&typeof m.pricing.output==="number"
  ?" · $"+m.pricing.input+"/$"+m.pricing.output+" per 1M tokens":"";
 return (m.display_name||m.id)+" — "+m.id+" ["+tier+"]"+price;
}
export function mountNativeModelSetup(invoke:NativeInvoke,providers:ProviderInfo[]):ModelTeamHandle {
 const settings=document.querySelector("#view-settings .settings-grid");
 if(!settings)throw Error("Shuvi Settings page is unavailable");
 const previous=load();
 const card=make("article");card.id="shuvi-native-model-setup";card.className="panel shuvi-native-model-setup";
 const heading=make("div");heading.className="settings-heading";
 const title=make("h3","AI Provider & Model Team · Windows");
 const desc=make("p","Configure once. Your selected model handles each task; Shuvi never switches to a different billed model silently.");
 heading.append(title,desc);
 const grid=make("div");grid.className="shuvi-native-form-grid";
 const providerLabel=make("label","Provider");
 const providerSelect=make("select");providerSelect.setAttribute("aria-label","AI Provider for installed Shuvi");
 for(const p of providers){const op=make("option",p.name);op.value=p.id;providerSelect.append(op);}
 providerLabel.append(providerSelect);
 const urlLabel=make("label","API URL");
 const url=make("input");url.id="shuvi-native-api-url";url.maxLength=1024;url.autocomplete="off";
 url.setAttribute("aria-label","Provider API URL");
 urlLabel.append(url);
 const keyLabel=make("label","API Key");
 const key=make("input");key.type="password";key.id="shuvi-native-api-key";key.autocomplete="off";key.maxLength=16384;
 key.placeholder="Paste API key here — never in Chat";
 keyLabel.append(key);
 grid.append(providerLabel,urlLabel,keyLabel);
 const fetchRow=make("div");fetchRow.className="shuvi-native-model-actions";
 const reload=make("button","Load xKiro models");reload.type="button";
 const save=make("button","Save provider & model assignments");save.type="button";
 fetchRow.append(reload,save);
 const catalogStatus=make("p","Models not loaded yet.");catalogStatus.setAttribute("role","status");
 const saveStatus=make("p","Select a Chat model before sending a message.");saveStatus.setAttribute("role","status");
 const subtitle=make("h4","Assign one AI model per task");
 const models=make("div");models.className="shuvi-native-role-grid";
 const help=make("p","Select exact models for Chat, Master, Blender, Adobe and other jobs. If a task has no assigned model, Shuvi will ask you to configure it instead of charging a different model.");
 help.className="shuvi-native-help";
 card.append(heading,grid,fetchRow,catalogStatus,subtitle,help,models,saveStatus);
 settings.insertBefore(card,settings.firstChild);
 let catalog:CatalogItem[]=[];
 let loaded=false;
 let current:ModelTeamConfig|null=previous&&providers.some(p=>p.id===previous.provider)?previous:null;
 const selections=new Map<string,HTMLSelectElement|HTMLInputElement>();
 if(current)providerSelect.value=current.provider;
 function refreshEndpoint(){
  const p=providerSelect.value;
  url.disabled=p!=="custom"&&p!=="ollama";
  url.value=p==="xkiro"?"https://api.xkiro.com/v1"
   :p==="ollama"?(current?.provider===p?current.base_url:"http://127.0.0.1:11434/v1/chat/completions")
   :p==="custom"?(current?.provider===p?current.base_url:""):"";
  keyLabel.hidden=p==="ollama";
  reload.disabled=p!=="xkiro";
 }
 function renderRoles(){
  const selectedValues=new Map<string,string>();
  for(const [role,field] of selections)selectedValues.set(role,field.value);
  selections.clear();models.replaceChildren();
  const xkiroList=providerSelect.value==="xkiro"&&loaded&&catalog.length>0;
  for(const [id,label] of NATIVE_MODEL_ROLES){
   const wrap=make("label");wrap.className="shuvi-native-role";
   const caption=make("span",label);
   let field:HTMLInputElement|HTMLSelectElement;
   if(xkiroList){
    const select=make("select");
    const blank=make("option","— Model not assigned —");blank.value="";select.append(blank);
    for(const m of catalog){const o=make("option",modelLabel(m));o.value=m.id;select.append(o);}
    field=select;
   }else{
    const inp=make("input");inp.type="text";inp.maxLength=128;inp.autocomplete="off";
    inp.placeholder=id==="chat"?"Exact chat model ID":"Exact model ID (optional)";
    field=inp;
   }
   field.setAttribute("aria-label",label+" model");
   const selected=selectedValues.get(id)??(current?.provider===providerSelect.value?current.roles[id]:"")??"";
   if(selected && (!xkiroList||catalog.some(m=>m.id===selected)))field.value=selected;
   wrap.append(caption,field);models.append(wrap);selections.set(id,field);
  }
 }
 async function loadModels(){
  if(providerSelect.value!=="xkiro")return;
  reload.disabled=true;
  catalogStatus.textContent="Fetching live chat model catalog from xKiro (no AI generation request)…";
  try{
   const chosenProvider=providerSelect.value;
   const response=await invoke<CatalogItem[]>("list_xkiro_models");
   if(providerSelect.value!==chosenProvider)return;
   if(!Array.isArray(response)||!response.length)throw Error("Empty provider catalog");
   catalog=response.filter(m=>m&&validModelId(m.id)&&typeof m.display_name==="string")
      .slice(0,300);
   if(!catalog.length)throw Error("No valid chat model IDs returned");
   loaded=true;
   catalogStatus.textContent=catalog.length+" live xKiro chat models loaded. Free/Paid tags reflect public catalog, not your account's available credits.";
  }catch{
   loaded=false;catalog=[];
   catalogStatus.textContent="xKiro catalog unavailable. You may type an exact model ID manually, but it has not been verified against the live catalog.";
  }finally{reload.disabled=providerSelect.value!=="xkiro";renderRoles();}
 }
 providerSelect.addEventListener("change",()=>{
  current=null;loaded=false;catalog=[];
  refreshEndpoint();renderRoles();
  catalogStatus.textContent=providerSelect.value==="xkiro"?"Click Load xKiro models.":"Enter exact model IDs for this provider.";
  saveStatus.textContent="Provider changed. Save this provider and its model assignments before chatting.";
  if(providerSelect.value==="xkiro")void loadModels();
 });
 reload.addEventListener("click",()=>{void loadModels();});
 save.addEventListener("click",async()=>{
  const p=providers.find(x=>x.id===providerSelect.value);
  if(!p)return;
  const endpoint=normalizeUrl(p.id,url.value);
  if(endpoint===null){saveStatus.textContent="Invalid URL. xKiro uses its official fixed HTTPS URL; custom providers require HTTPS.";return;}
  const roles:Record<string,string>={};
  for(const [id,field] of selections){
   const value=field.value.trim();
   if(!value)continue;
   if(!validModelId(value)){
    saveStatus.textContent="Invalid exact model ID for "+id;return;
   }
   if(p.id==="xkiro"&&loaded&&!catalog.some(m=>m.id===value)){
    saveStatus.textContent="Model "+value+" is absent from the live xKiro chat catalog.";return;
   }
   roles[id]=value;
  }
  if(!roles.chat){saveStatus.textContent="First select Normal Chat model. No model has been saved.";return;}
  // Only the Windows OS keyring receives this secret.
  const secret=key.value.trim();key.value="";
  save.disabled=true;
  try{
   if(secret)await invoke<void>("save_api_key",{provider:p.id,apiKey:secret});
   if(p.api_key_required){
    const exists=await invoke<boolean>("api_key_status",{provider:p.id});
    if(!exists){saveStatus.textContent="First enter and save a valid API Key in Windows Settings.";return;}
   }
   const config={provider:p.id,base_url:endpoint,roles};
   window.localStorage.setItem(STORAGE,JSON.stringify(config));
   current=config;
   saveStatus.textContent="Saved "+Object.keys(roles).length+" task models for "+p.name+". Only non-secret choices are stored locally. Go to Chat.";
  }catch{saveStatus.textContent="Could not save settings securely. No new model assignments activated.";}
  finally{save.disabled=false;}
 });
 refreshEndpoint();
 renderRoles();
 if(providerSelect.value==="xkiro")void loadModels();
 if(current)saveStatus.textContent="Saved settings loaded. You can go straight to Chat.";
 mountNativeBudgetSetup(invoke,card,()=>({provider:providerSelect.value,current,selected:Object.fromEntries(Array.from(selections,([role,field])=>[role,field.value.trim()]))}));
 return {current:()=>current};
}
