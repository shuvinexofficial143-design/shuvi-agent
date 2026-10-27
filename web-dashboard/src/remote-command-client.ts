/**
 * Browser-only remote *transport* opt-in. Access codes remain only in this
 * page's JS memory. This does not authorize Windows tools or run AI here.
 */
import {REMOTE_PROTOCOL} from "./remote-command-contract.mjs";

type Result<T>={ok:boolean;value?:T;error?:string};
type Status={ownerId:string;deviceId:string;lastSequence:number;
 agentConnected:boolean;lastAgentPollAt:number;
 tasks:Array<{taskId:string;status:string;expiresAt:number;
  delivery?:"expired_not_delivered"|"awaiting_agent"|"native_receipt_recorded";cancelRequested?:boolean;
  approvalId?:string;approvalExpiresAt?:number;
  approvalAction?:{id:string;tool:string;risk:string;summary:string;target:string}}>};
export type RemoteChatTransport={
 connected():boolean;
 send(text:string,threadId:string):Promise<{ok:boolean;error?:string}>;
};

function node<K extends keyof HTMLElementTagNameMap>(name:K, text=""):HTMLElementTagNameMap[K] {
 const element=document.createElement(name);
 element.textContent=text;return element;
}

export function mountRemoteCommandClient(onChange:()=>void):RemoteChatTransport {
 const chat=document.getElementById("chatWorkspaceLayout");
 if(!chat)throw Error("No Shuvi Chat workspace");
 const panel=node("section");
 panel.className="shuvi-remote-link";
 panel.setAttribute("aria-label","Secure Windows remote control connection");
 const bar=node("div");
 bar.className="shuvi-remote-link-toolbar";
 const title=node("strong","Windows Remote Control");
 const state=node("span","Disconnected · local drafts only");
 state.setAttribute("role","status");
 bar.append(title,state);
 const controls=node("div");
 controls.className="shuvi-remote-link-controls";
 const code=node("input") as HTMLInputElement;
 code.type="password";code.placeholder="Secure remote pairing code";
 code.autocomplete="off";code.maxLength=64;code.setAttribute("aria-label","Remote control access code");
 const connect=node("button","Connect") as HTMLButtonElement;
 connect.type="button";
 const disconnect=node("button","Disconnect") as HTMLButtonElement;
 disconnect.type="button";disconnect.disabled=true;
 const refresh=node("button","Refresh task status") as HTMLButtonElement;
 refresh.type="button";refresh.disabled=true;
 controls.append(code,connect,disconnect,refresh);
 const note=node("p","Use the same Chat below after authentication. Cloud delivery is not proof the Windows agent ran a command.");
 note.className="shuvi-remote-link-notice";
 const tasks=node("div");
 tasks.className="shuvi-remote-task-list";
 tasks.setAttribute("aria-live","polite");
 panel.append(bar,controls,note,tasks);
 chat.parentElement?.insertBefore(panel,chat);
 let key="";
 let identity:Status|null=null;
 let updating=false;
 let sending=false;
 // BUG-021: bounded, authenticated status polling; never model calls.
 // Faster while visible, slower in background, with failure backoff.
 const VISIBLE_POLL_MS=4500, HIDDEN_POLL_MS=20000, MAX_BACKOFF_MS=30000;
 let refreshTimer:ReturnType<typeof setTimeout>|null=null;
 let refreshFailures=0;
 let connectionEpoch=0;
 const outstanding=new Set<AbortController>();
 function stopRefresh(){
  if(refreshTimer!==null){window.clearTimeout(refreshTimer);refreshTimer=null;}
 }
 function scheduleRefresh(){
  stopRefresh();
  if(!key)return;
  const background=document.visibilityState==="hidden";
  const delay=background?HIDDEN_POLL_MS:
   Math.min(MAX_BACKOFF_MS,VISIBLE_POLL_MS*(2**Math.min(refreshFailures,3)));
  refreshTimer=window.setTimeout(()=>{
   refreshTimer=null;
   if(!key)return;
   void reload().finally(()=>{if(key)scheduleRefresh();});
  },delay);
 }

 function disconnectNow(){
  // Cancel timers and in-flight fetches BEFORE dropping session identity.
  // A late old connection reply cannot resurrect the status/approval UI.
  connectionEpoch++;stopRefresh();
  for(const controller of outstanding)controller.abort();
  outstanding.clear();refreshFailures=0;updating=false;
  key="";identity=null;code.value="";
  connect.disabled=false;disconnect.disabled=true;refresh.disabled=true;
  state.textContent="Disconnected · local drafts only";
  tasks.replaceChildren();onChange();
 }
 async function exchange(method:"GET"|"POST",body?:unknown):Promise<Result<Status>>{
  const ctrl=new AbortController();
  outstanding.add(ctrl);
  const timer=window.setTimeout(()=>ctrl.abort(),9000);
  try{
   const res=await fetch("/api/remote-command",{
    method,headers:{
      Authorization:"Bearer "+key,
      ...(method==="POST"?{"Content-Type":"application/json"}:{})
    },
    ...(method==="POST"?{body:JSON.stringify(body)}:{}),
    cache:"no-store",credentials:"omit",redirect:"error",signal:ctrl.signal
   });
   const data:unknown=await res.json();
   if(!data||typeof data!=="object")return {ok:false,error:"Malformed server response"};
   const reply=data as Result<Status>;
   if(res.status===401){disconnectNow();return {ok:false,error:"Invalid remote code"};}
   return {ok:res.ok&&reply.ok===true,value:reply.value,error:reply.error};
  }catch{return {ok:false,error:"Remote server unreachable or not configured"};}
  finally{window.clearTimeout(timer);outstanding.delete(ctrl);}
 }
 async function decide(task:{taskId:string;approvalId?:string;approvalAction?:{id:string}},choice:"approve"|"deny") {
  if(!identity||!task.approvalId||!task.approvalAction?.id)return;
  const decision={
   ownerId:identity.ownerId,deviceId:identity.deviceId,
   taskId:task.taskId,approvalId:task.approvalId,actionId:task.approvalAction.id,decision:choice
  };
  const answer=await exchange("POST",{operation:"decide",decision});
  if(!answer.ok)state.textContent="Approval rejected or expired; no Windows tool was authorized";
  else state.textContent=choice==="approve"
    ? "Approval queued for Windows agent; execution not yet confirmed"
    : "Denial queued for Windows agent";
  void reload();
 }
 async function cancel(taskId:string){
  const answer=await exchange("POST",{operation:"cancel",taskId});
  state.textContent=answer.ok
    ? "Cancellation requested; Windows stop not confirmed"
    : "Cancellation rejected or task already closed";
  void reload();
 }
 function showTasks(status:Status){
  tasks.replaceChildren();
  if(!Array.isArray(status.tasks)||!status.tasks.length) {
   tasks.append(node("small","No remote tasks yet."));return;
  }
  for(const t of status.tasks.slice(-8).reverse()){
   const item=node("div");
   item.className="shuvi-remote-task-item";
   const expiredUnadmitted=t.status==="received"&&
     (t.delivery==="expired_not_delivered"||
       (Number.isSafeInteger(t.expiresAt)&&t.expiresAt<=Date.now()));
   const displayed=expiredUnadmitted
     ?"Expired · no Windows agent admission confirmed"
     :String(t.status).slice(0,40);
   item.append(node("small",String(t.taskId).slice(0,8)+" · "+displayed+
      (t.cancelRequested?" · cancel requested":"")));
   const active=!expiredUnadmitted&&
     ["received","admitted","running","requires_approval"].includes(t.status);
   if(t.status==="requires_approval" && t.approvalId &&
      Number.isSafeInteger(t.approvalExpiresAt) &&
      t.approvalExpiresAt!>Date.now() && !t.cancelRequested){
     const a=t.approvalAction;
     const safe=(v:unknown,max:number)=>typeof v==="string"&&v.trim()===v&&
       v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(v);
     if(!a||!safe(a.id,96)||!safe(a.tool,70)||
       !["low","medium","high"].includes(a.risk)||
       !safe(a.summary,240)||!safe(a.target,320)){
       item.append(node("p","Exact Windows action disclosure unavailable. Approval disabled; deny on Windows."));
       tasks.append(item);continue;
     }
     // Render ONLY text nodes, never provider-supplied HTML.
     item.append(node("p","Tool: "+a.tool+" · Risk: "+a.risk));
     item.append(node("p","Target: "+a.target));
     item.append(node("p","Action: "+a.summary));
     item.append(node("small","Prepared action "+a.id.slice(0,8)));
     const approve=node("button","Approve once") as HTMLButtonElement;
     const deny=node("button","Deny") as HTMLButtonElement;
     approve.type=deny.type="button";
     approve.onclick=()=>{approve.disabled=deny.disabled=true;void decide(t,"approve");};
     deny.onclick=()=>{approve.disabled=deny.disabled=true;void decide(t,"deny");};
     item.append(approve,deny);
   }
   if(active && !t.cancelRequested){
     const stop=node("button","Request stop") as HTMLButtonElement;
     stop.type="button";stop.onclick=()=>{stop.disabled=true;void cancel(t.taskId);};
     item.append(stop);
   }
   tasks.append(item);
  }
 }
 async function reload(){
  if(!key||updating)return false;
  const epoch=connectionEpoch;
  updating=true;
  try {
   const info=await exchange("GET");
   if(epoch!==connectionEpoch||!key)return false;
   if(!info.ok||!info.value) {
    refreshFailures=Math.min(refreshFailures+1,4);
    state.textContent="Remote status unavailable — Windows execution not confirmed";
    return false;
   }
   const x=info.value;
   if(typeof x.ownerId!=="string"||typeof x.deviceId!=="string"||
      !Number.isSafeInteger(x.lastSequence)||!Array.isArray(x.tasks))return false;
   identity=x;
   refreshFailures=0;
   state.textContent=x.agentConnected
     ? "Windows Agent contacted relay recently · task execution requires audit"
     : "Cloud authenticated · Windows Agent offline or not polling";
   showTasks(x);
   return true;
  }finally{if(epoch===connectionEpoch)updating=false;}
 }
 document.addEventListener("visibilitychange",()=>{
  if(!key)return;
  stopRefresh();
  if(document.visibilityState==="visible"){
   void reload().finally(()=>{if(key)scheduleRefresh();});
  }else scheduleRefresh();
 });
 connect.addEventListener("click",async()=>{
  if(!/^[a-fA-F0-9]{64}$/.test(code.value)) {
   state.textContent="Enter your 64-character secure pairing code";
   return;
  }
  key=code.value;code.value="";connect.disabled=true;
  const ok=await reload();
  if(!ok){disconnectNow();state.textContent="Could not authenticate/configure remote relay";return;}
  disconnect.disabled=false;refresh.disabled=false;onChange();
  scheduleRefresh();
 });
 disconnect.addEventListener("click",disconnectNow);
 refresh.addEventListener("click",()=>{
  stopRefresh();
  void reload().finally(()=>{if(key)scheduleRefresh();});
 });
 return {
  connected:()=>Boolean(key&&identity),
  async send(text,threadId){
   if(!key||!identity)return {ok:false,error:"Remote control not authenticated"};
   if(sending)return {ok:false,error:"Already sending"};
   if(text.length>2500||!text.trim())return {ok:false,error:"Invalid command length"};
   if(!await reload())return {ok:false,error:"Could not verify current command sequence"};
   if(!identity)return {ok:false,error:"Not connected"};
   const snap=identity;
   const issuedAt=Date.now();
   // The Windows native master will interpret task/chat; the Vercel API
   // only queues an inert envelope and must never execute an app.
   const message={
    protocol:REMOTE_PROTOCOL,type:"user_message",
    ownerId:snap.ownerId,deviceId:snap.deviceId,
    threadId,messageId:crypto.randomUUID(),taskId:crypto.randomUUID(),
    sequence:snap.lastSequence+1,issuedAt,expiresAt:issuedAt+120000,
    mode:"task",text
   };
   sending=true;
   try {
    const outcome=await exchange("POST",{operation:"submit",message});
    if(!outcome.ok){state.textContent="Remote queue rejected: "+String(outcome.error||"unknown");return {ok:false,error:outcome.error||"Queue rejected"};}
    state.textContent="Command queued; Windows execution NOT yet confirmed";
    void reload();
    return {ok:true};
   }finally{sending=false;}
  }
 };
}
