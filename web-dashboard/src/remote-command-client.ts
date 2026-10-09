/**
 * Browser-only remote *transport* opt-in. Access codes remain only in this
 * page's JS memory. This does not authorize Windows tools or run AI here.
 */
import {REMOTE_PROTOCOL} from "./remote-command-contract.mjs";

type Result<T>={ok:boolean;value?:T;error?:string};
type Status={ownerId:string;deviceId:string;lastSequence:number;
 tasks:Array<{taskId:string;status:string;cancelRequested?:boolean}>};
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

 function disconnectNow(){
  key="";identity=null;code.value="";
  connect.disabled=false;disconnect.disabled=true;refresh.disabled=true;
  state.textContent="Disconnected · local drafts only";
  tasks.replaceChildren();onChange();
 }
 async function exchange(method:"GET"|"POST",body?:unknown):Promise<Result<Status>>{
  const ctrl=new AbortController();
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
  finally{window.clearTimeout(timer);}
 }
 function showTasks(status:Status){
  tasks.replaceChildren();
  if(!Array.isArray(status.tasks)||!status.tasks.length) {
   tasks.append(node("small","No remote tasks yet."));return;
  }
  for(const t of status.tasks.slice(-8).reverse()){
   const item=node("p",String(t.taskId).slice(0,8)+" · "+String(t.status).slice(0,40)+
      (t.cancelRequested?" · cancel requested":""));
   tasks.append(item);
  }
 }
 async function reload(){
  if(!key||updating)return false;
  updating=true;
  try {
   const info=await exchange("GET");
   if(!info.ok||!info.value) {
    state.textContent="Remote status unavailable — Windows execution not confirmed";
    return false;
   }
   const x=info.value;
   if(typeof x.ownerId!=="string"||typeof x.deviceId!=="string"||
      !Number.isSafeInteger(x.lastSequence)||!Array.isArray(x.tasks))return false;
   identity=x;
   state.textContent="Cloud authenticated · Windows agent connection unverified";
   showTasks(x);
   return true;
  }finally{updating=false;}
 }
 connect.addEventListener("click",async()=>{
  if(!/^[a-fA-F0-9]{64}$/.test(code.value)) {
   state.textContent="Enter your 64-character secure pairing code";
   return;
  }
  key=code.value;code.value="";connect.disabled=true;
  const ok=await reload();
  if(!ok){disconnectNow();state.textContent="Could not authenticate/configure remote relay";return;}
  disconnect.disabled=false;refresh.disabled=false;onChange();
 });
 disconnect.addEventListener("click",disconnectNow);
 refresh.addEventListener("click",()=>{void reload();});
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
