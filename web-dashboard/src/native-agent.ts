/**
 * Only the packaged, trusted Tauri WebView gets native IPC. This module never
 * adds an HTTP execution endpoint or exposes desktop commands to Vercel.
 * A browser (including the Vercel deployment) has no native transport.
 */
type NativeInvoke = <T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
type Provider = {id:string;name:string;default_model:string;api_key_required:boolean;custom_base_url:boolean};
type NativeChatMessage = {role:"user"|"assistant";content:string};
type NativeChatResponse = {content:string;provider:string;model:string;tool_proposal:Record<string,unknown>|null};
type Pending = {id:string;kind:string;summary:string;detail:string;risk:string};
type ActionResult = {success:boolean;tool:string;stdout:string;stderr:string;exit_code:number|null};
type Runtime = {shuvi_memory_mb:number;managed_children_count:number};
type NativeInternals = {invoke:NativeInvoke};

declare global {
 interface Window { __TAURI_INTERNALS__?:NativeInternals }
}
export function isNativeShuvi():boolean {
 return typeof window.__TAURI_INTERNALS__?.invoke==="function";
}
export type NativeTransport = {
 kind:"native";
 connected():boolean;
 send(text:string,threadId:string,promptIndex?:number):Promise<{ok:boolean;error?:string;reply?:string}>;
 getReplies(threadId:string):string[];
};

function field<K extends keyof HTMLElementTagNameMap>(tag:K,text=""):HTMLElementTagNameMap[K]{
 const node=document.createElement(tag);
 if(text)node.textContent=text;
 return node;
}

export function mountNativeAgent(onChange:()=>void):NativeTransport|null {
 if(!isNativeShuvi())return null;
 const invoke=window.__TAURI_INTERNALS__!.invoke;
 const chat=document.getElementById("chatWorkspaceLayout");
 if(!chat)throw Error("Native Shuvi dashboard requires its Chat workspace.");
 const panel=field("section");
 panel.className="shuvi-native-link";
 panel.setAttribute("aria-label","Installed Windows Shuvi Agent connection");
 const title=field("strong","Shuvi Windows Agent · Native");
 const status=field("p","Connecting to installed Shuvi.exe...");
 status.setAttribute("role","status");
 const controls=field("div");controls.className="shuvi-native-controls";
 const provider=field("select");
 provider.setAttribute("aria-label","Local AI provider");
 const model=field("input");
 model.placeholder="Exact provider model ID";
 model.autocomplete="off";
 model.maxLength=128;
 model.setAttribute("aria-label","Model for Windows Shuvi");
 const key=field("input");
 key.type="password";
 key.placeholder="API key (saved only in Windows Credential Manager)";
 key.autocomplete="off";
 key.setAttribute("aria-label","Save provider API key securely");
 const save=field("button","Save AI settings");
 save.type="button";
 controls.append(provider,model,key,save);
 const notes=field("p","Windows commands use native Tauri IPC. Every proposed tool action requires your explicit approval. No automatic paid retry.");
 notes.className="shuvi-native-note";
 const approval=field("div");approval.className="shuvi-native-approval";approval.hidden=true;
 const pendingText=field("p");
 const approve=field("button","Allow once");approve.type="button";
 const deny=field("button","Deny");deny.type="button";
 approval.append(pendingText,approve,deny);
 const mobile=field("div");mobile.className="shuvi-native-mobile";
 const mobileTitle=field("strong","Mobile → Windows Agent pairing");
 const mobileCode=field("input");mobileCode.type="password";
 mobileCode.maxLength=64;mobileCode.autocomplete="off";
 mobileCode.placeholder="Private 64-character Windows agent code";
 mobileCode.setAttribute("aria-label","Windows agent remote pairing code");
 const mobileConnect=field("button","Pair Windows agent");mobileConnect.type="button";
 const mobileDisconnect=field("button","Disconnect mobile agent");mobileDisconnect.type="button";
 const mobileStatus=field("p","Checking optional mobile agent pairing…");
 mobileStatus.setAttribute("role","status");
 mobile.append(mobileTitle,mobileCode,mobileConnect,mobileDisconnect,mobileStatus);
 panel.append(title,status,controls,notes,approval,mobile);
 chat.parentElement?.insertBefore(panel,chat);
 let providers:Provider[]=[];
 let ready=false;
 let sending=false;
 let pending:{action:Pending;threadId:string;promptIndex:number}|null=null;
 const histories=new Map<string,NativeChatMessage[]>();
 const replies=new Map<string,string[]>();
 function updateReply(threadId:string,index:number,value:string){
  const records=replies.get(threadId)||[];
  records[index]=value.slice(0,14000);
  replies.set(threadId,records);
  onChange();
 }
 function activeProvider():Provider|undefined{return providers.find(p=>p.id===provider.value);}
 function selectionValid():boolean {
  return ready && !!activeProvider() && model.value.trim().length>0 &&
   model.value.length<=128 && !/[\r\n]/.test(model.value);
 }
 function refreshState(text?:string){
  if(text)status.textContent=text;
  save.disabled=!ready||sending;
  approve.disabled=sending;
  deny.disabled=sending;
  onChange();
 }
 function clearPending(){
  pending=null;
  approval.hidden=true;
  pendingText.textContent="";
  approve.disabled=deny.disabled=false;
 }
 try{
  const saved=window.localStorage.getItem("shuvi.native.provider");
  if(saved)provider.dataset.previous=saved;
  const previousModel=window.localStorage.getItem("shuvi.native.model");
  if(previousModel)model.value=previousModel;
 }catch{ /* Native settings remain available for this session. */ }
 provider.addEventListener("change",()=>{
  model.value="";
  key.value="";
 });
 save.addEventListener("click",async()=>{
  const p=activeProvider();
  if(!p||!model.value.trim()){
   refreshState("Select a provider and its exact model ID.");
   return;
  }
  const m=model.value.trim();
  if(m.length>128 || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(m)){
   refreshState("The model ID contains unsupported characters.");
   return;
  }
  const apiKey=key.value.trim();
  key.value="";
  save.disabled=true;
  try{
   if(apiKey)await invoke<void>("save_api_key",{provider:p.id,apiKey});
   try{
    window.localStorage.setItem("shuvi.native.provider",p.id);
    window.localStorage.setItem("shuvi.native.model",m);
   }catch{ /* No secret is stored in browser preferences. */ }
   refreshState(p.name+" / "+m+" configured. Keys are held only in Windows Credential Manager.");
  }catch(error){
   refreshState("Could not save provider key: "+String(error));
  }
 });
 async function load(){
  try{
   // This is a real native Tauri invocation, not a web/mock readiness badge.
   const [runtime,list]=await Promise.all([
    invoke<Runtime>("runtime_status"),
    invoke<Provider[]>("list_providers")
   ]);
   if(!Array.isArray(list)||!list.length)throw Error("Native provider registry unavailable.");
   providers=list;
   for(const p of list){const option=field("option",p.name);option.value=p.id;provider.append(option);}
   if(providers.some(p=>p.id===provider.dataset.previous))provider.value=provider.dataset.previous!;
   ready=true;
   refreshState("Connected to installed Shuvi.exe · "+runtime.shuvi_memory_mb.toFixed(0)+" MB RAM · native approval required");
   for(const [id,text] of [
    ["sidebarRuntimeState","Windows Agent connected"],
    ["dashboardRuntimeBadge","Native connected"],
    ["dashboardRuntimeState","Installed Shuvi.exe · Native IPC"],
    ["dashboardRuntimePermission","Approval required for every tool"],
    ["bridgeConnectionDetail","The Windows Dashboard is running inside installed Shuvi.exe. Native IPC is available. Browser/mobile remote pairing is separate."],
    ["bridgeConnectionState","Native IPC connected"],
    ["webRuntimeTopbar"," Windows Agent connected"]
   ] as const){const el=document.getElementById(id);if(el)el.textContent=text;}
   const input=document.getElementById("bridgePairingCode") as HTMLInputElement|null;
   const pair=document.getElementById("bridgeConnect") as HTMLButtonElement|null;
   const disconnect=document.getElementById("bridgeDisconnect") as HTMLButtonElement|null;
   if(input)input.disabled=true;
   if(pair){pair.disabled=true;pair.textContent="Connected via native IPC";}
   if(disconnect)disconnect.disabled=true;
  }catch(error){
   ready=false;
   refreshState("Native runtime not connected: "+String(error));
  }
 }
 async function decide(allowed:boolean){
  const current=pending;
  if(!current||sending)return;
  sending=true;
  approve.disabled=deny.disabled=true;
  try {
   if(!allowed){
    await invoke<void>("deny_action",{actionId:current.action.id});
    updateReply(current.threadId,current.promptIndex,
      (replies.get(current.threadId)?.[current.promptIndex]||"")+"\n\nWindows tool denied by you. No action executed.");
    refreshState("Action denied. Native approval journal updated.");
   }else{
    refreshState("Executing only the approved native action "+current.action.id.slice(0,8)+"…");
    const result=await invoke<ActionResult>("execute_action",{actionId:current.action.id});
    // Native Result is not self-attested success: require the exact audited action receipt.
    const receipts=await invoke<Array<{event:string;action_id:string|null;success:boolean;tool:string}>>("audit_log",{limit:200});
    const matched=receipts.find(r=>r.action_id===current.action.id &&
       r.tool===result.tool && r.event==="executed" && r.success===true);
    const label=result.success && matched
      ? "Native action completed with matching audit."
      : "Action outcome not independently verified. Inspect the native audit before retrying.";
    const output=[result.stdout,result.stderr].filter(Boolean).join("\n").slice(0,7000);
    updateReply(current.threadId,current.promptIndex,
      (replies.get(current.threadId)?.[current.promptIndex]||"")+
      "\n\n"+label+(output?"\n"+output:""));
    refreshState(label);
   }
  }catch(error){
   updateReply(current.threadId,current.promptIndex,
    (replies.get(current.threadId)?.[current.promptIndex]||"")+
    "\n\nNative action outcome unknown: "+String(error)+". Do not retry blindly.");
   refreshState("Native action outcome unknown. Check Activity/Audit.");
  }finally{
   sending=false;
   clearPending();
   refreshState();
  }
 }
 approve.addEventListener("click",()=>{void decide(true);});
 deny.addEventListener("click",()=>{void decide(false);});
 async function refreshMobile(){
  try{
   const state=await invoke<{enabled:boolean}>("remote_agent_status");
   mobileStatus.textContent=state.enabled
    ? "Windows outbound agent is paired on this PC. Cloud command delivery still requires separate server pairing and live verification."
    : "Not paired. No remote command polling.";
  }catch{mobileStatus.textContent="Mobile pairing status unavailable in this Windows build.";}
 }
 mobileConnect.addEventListener("click",async()=>{
  const code=mobileCode.value.trim();
  mobileCode.value="";
  if(!/^[a-fA-F0-9]{64}$/.test(code)){
   mobileStatus.textContent="Enter the dedicated 64-character Windows agent code.";
   return;
  }
  mobileConnect.disabled=true;
  try{
   await invoke<void>("remote_agent_pair",{accessCode:code});
   await refreshMobile();
  }catch{
   mobileStatus.textContent="Pairing failed. Verify server configuration and your dedicated Windows agent code.";
  }finally{mobileConnect.disabled=false;}
 });
 mobileDisconnect.addEventListener("click",async()=>{
  mobileDisconnect.disabled=true;
  try{
   await invoke<void>("remote_agent_disconnect");
   await refreshMobile();
  }catch{mobileStatus.textContent="Disconnect outcome unknown. Verify in Windows Credential Manager.";}
  finally{mobileDisconnect.disabled=false;}
 });
 void load();
 void refreshMobile();
 return {
  kind:"native",
  connected:()=>ready,
  getReplies:(threadId:string)=>replies.get(threadId)||[],
  async send(text,threadId,promptIndex=0){
   if(!selectionValid())return {ok:false,error:"First configure a valid AI Provider and Model in Windows Shuvi."};
   if(pending)return {ok:false,error:"First approve or deny the existing Windows action."};
   if(sending)return {ok:false,error:"A native request is already running."};
   if(!text.trim()||text.length>2500)return {ok:false,error:"Invalid command length."};
   const p=activeProvider()!;
   const m=model.value.trim();
   const prev=histories.get(threadId)||[];
   // Keep paid-request context bounded and avoid forwarding any credential.
   const messages:NativeChatMessage[]=[...prev.slice(-20),{role:"user",content:text}];
   sending=true;
   refreshState("Sending one AI request to "+p.name+" / "+m+"…");
   try{
    const response=await invoke<NativeChatResponse>("chat",{
      input:{provider:p.id,model:m,base_url:null,messages,orchestration_context:null}
    });
    if(!response||typeof response.content!=="string")throw Error("Invalid native AI response.");
    const reply=response.content.slice(0,12000);
    histories.set(threadId,[...messages,{role:"assistant",content:reply}].slice(-22));
    updateReply(threadId,promptIndex,reply);
    if(response.tool_proposal){
     const proposed=await invoke<Pending>("prepare_tool",{
      proposal:response.tool_proposal,provider:p.id,model:m,baseUrl:null
     });
     if(!proposed||typeof proposed.id!=="string")throw Error("Tool preparation did not return a valid native action.");
     pending={action:proposed,threadId,promptIndex};
     pendingText.textContent="Permission required: "+proposed.summary+
       "\nRisk: "+proposed.risk+"\n"+proposed.detail;
     approval.hidden=false;
     refreshState("Waiting for your explicit Allow once / Deny decision. No tool executed.");
    }else{
     refreshState("Native AI replied. No Windows tool action was requested.");
    }
    return {ok:true,reply};
   }catch(error){
    refreshState("Native AI request failed or outcome unknown. Never retry blindly.");
    return {ok:false,error:String(error)};
   }finally{
    sending=false;
    refreshState();
   }
  }
 };
}
