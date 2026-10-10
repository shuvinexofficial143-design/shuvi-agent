/**
 * Only the packaged, trusted Tauri WebView gets native IPC. This module never
 * adds an HTTP execution endpoint or exposes desktop commands to Vercel.
 * A browser (including the Vercel deployment) has no native transport.
 */
import {mountNativeModelSetup, type ModelTeamHandle, type NativeInvoke} from "./native-model-setup";
import {chooseNativeRoute} from "./native-model-routing.mjs";
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
 const title=field("strong","Shuvi Agent");
 const showDetails=field("button","Agent details");
 showDetails.type="button";
 showDetails.addEventListener("click",()=>{
  const expanded=panel.classList.toggle("shuvi-native-expanded");
  showDetails.textContent=expanded?"Hide agent details":"Agent details";
 });
 const status=field("p","Connecting to installed Shuvi.exe...");
 status.setAttribute("role","status");
 const openSettings=field("button","Configure AI in Settings");openSettings.type="button";
 openSettings.addEventListener("click",()=>{
  document.querySelector<HTMLButtonElement>('[data-view-jump="settings"]')?.click();
 });
 const notes=field("p","Windows commands use native Tauri IPC. Every proposed tool action requires your explicit approval. No automatic paid retry.");
 notes.className="shuvi-native-note";
 const approval=field("div");approval.className="shuvi-native-approval";approval.hidden=true;
 approval.setAttribute("role","region");
 approval.setAttribute("aria-label","Windows action needs your approval");
 const actionFeedback=field("div");
 actionFeedback.className="shuvi-native-action-feedback";
 actionFeedback.setAttribute("role","status");
 actionFeedback.hidden=true;
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
 panel.append(title,status,showDetails,openSettings,notes);
 chat.parentElement?.insertBefore(panel,chat);
 // A confirmation above the entire chat falls out of view while reading the
 // latest reply. Keep all pending native approvals adjacent to the composer.
 const chatForm=document.getElementById("chatForm");
 const composerParent=chatForm?.parentElement;
 if(composerParent){
  composerParent.insertBefore(actionFeedback,chatForm);
  composerParent.insertBefore(approval,chatForm);
 }else{
  // Defensive fallback for an incomplete preview; never lose an approval UI.
  panel.append(actionFeedback,approval);
 }
 let team:ModelTeamHandle|null=null;
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
 function refreshState(text?:string){
  if(text)status.textContent=text;
  approve.disabled=sending;
  deny.disabled=sending;
  onChange();
 }
 function showActionFeedback(message:string){
  actionFeedback.textContent=message;
  actionFeedback.hidden=false;
 }
 function clearPending(){
  pending=null;
  approval.hidden=true;
  pendingText.textContent="";
  approve.disabled=deny.disabled=false;
 }
 async function load(){
  try{
   // This is a real native Tauri invocation, not a web/mock readiness badge.
   const [runtime,list]=await Promise.all([
    invoke<Runtime>("runtime_status"),
    invoke<Provider[]>("list_providers")
   ]);
   if(!Array.isArray(list)||!list.length)throw Error("Native provider registry unavailable.");
   team=mountNativeModelSetup(invoke,list);
   document.getElementById("shuvi-native-model-setup")?.append(mobile);
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
    showActionFeedback("Windows action denied by you. Nothing was executed.");
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
    showActionFeedback(label+(output?" "+output:""));
    refreshState(label);
   }
  }catch(error){
   updateReply(current.threadId,current.promptIndex,
    (replies.get(current.threadId)?.[current.promptIndex]||"")+
    "\n\nNative action outcome unknown: "+String(error)+". Do not retry blindly.");
   showActionFeedback("Native action outcome unknown. Review Activity/Audit before retrying.");
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
  canClearChats:()=>!pending&&!sending,
  clearChat:(threadId:string)=>{histories.delete(threadId);replies.delete(threadId);},
  clearAllChats:()=>{histories.clear();replies.clear();},
  async send(text,threadId,promptIndex=0){
   if(!ready)return {ok:false,error:"Windows Shuvi is not connected yet."};
   const route=chooseNativeRoute(text,team?.current());
   if(!route.ok)return {ok:false,error:route.error};
   if(pending)return {ok:false,error:"First approve or deny the existing Windows action."};
   if(sending)return {ok:false,error:"A native request is already running."};
   if(!text.trim()||text.length>2500)return {ok:false,error:"Invalid command length."};
   const prev=histories.get(threadId)||[];
   // Keep paid-request context bounded and avoid forwarding any credential.
   const messages:NativeChatMessage[]=[...prev.slice(-20),{role:"user",content:text}];
   sending=true;
   refreshState("Sending "+(route.role==="chat"?"chat":"Windows task for Master/selected specialist")+
    " to "+route.provider+" / "+route.model+"…");
   try{
    const response=await invoke<NativeChatResponse>("chat",{
      input:{provider:route.provider,model:route.model,base_url:route.base_url||null,messages,orchestration_context:null}
    });
    if(!response||typeof response.content!=="string")throw Error("Invalid native AI response.");
    const reply=response.content.slice(0,12000);
    histories.set(threadId,[...messages,{role:"assistant",content:reply}].slice(-22));
    updateReply(threadId,promptIndex,reply);
    if(response.tool_proposal){
     actionFeedback.hidden=true;
     try{
      const proposed=await invoke<Pending>("prepare_tool",{
       proposal:response.tool_proposal,provider:route.provider,model:route.model,baseUrl:route.base_url||null
      });
      if(!proposed||typeof proposed.id!=="string")throw Error("Tool preparation did not return a valid native action.");
      pending={action:proposed,threadId,promptIndex};
      pendingText.textContent="Permission required: "+proposed.summary+
        "\nRisk: "+proposed.risk+"\n"+proposed.detail;
      approval.hidden=false;
      showActionFeedback("Windows action prepared. Read the approval below and select Allow once or Deny. Nothing runs before approval.");
      refreshState("Waiting for your explicit Allow once / Deny decision. No tool executed.");
      approval.scrollIntoView?.({block:"nearest",behavior:"smooth"});
     }catch(error){
      showActionFeedback("AI replied but Windows could not prepare its action: "+String(error)+
       ". Nothing executed. Check the action details; do not resend this paid request blindly.");
      // The paid model response already arrived. A separate Windows prepare failure
      // cannot turn that successful AI response into an unsent draft/retry.
      const notice="Windows tool preparation failed or its outcome is unknown. No execute command was sent. Do not resend this paid AI message just to retry the tool.";
      const acknowledgedReply=reply+"\n\n"+notice;
      updateReply(threadId,promptIndex,acknowledgedReply);
      refreshState("AI replied; Windows tool preparation needs attention. No action executed by Shuvi.");
      return {ok:true,reply:acknowledgedReply};
     }
    }else{
     if(route.role!=="chat"){
      const likeToolJson=/["']tool["']\s*:/.test(reply);
      showActionFeedback(likeToolJson
       ? "The AI wrote tool-like JSON, but it was not recognized as a valid native action. No Windows action was prepared or executed. No automatic retry."
       : "AI replied without requesting a Windows action. No application opened or message sent. No automatic retry.");
      refreshState("AI replied without an executable Windows tool. No action performed.");
     }else{
      actionFeedback.hidden=true;
      refreshState("Native AI replied. No Windows tool action was requested.");
     }
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
