/**
 * Browser's normal Shuvi conversation surface.
 * Vercel owner access key lives in this tab's JS memory only, never localStorage.
 * Chat text is stored in this browser only; the backend does NOT touch native tools.
 */
const CHAT_KEY="shuvi.web.online-chat.v1";
type Entry={role:"user"|"assistant";content:string};
function element<K extends keyof HTMLElementTagNameMap>(tag:K,klass="",text=""):HTMLElementTagNameMap[K] {
  const e=document.createElement(tag);if(klass)e.className=klass;if(text)e.textContent=text;return e;
}
function load():Entry[] {
  try {
    const parsed:unknown=JSON.parse(localStorage.getItem(CHAT_KEY)||"[]");
    if(!Array.isArray(parsed))return [];
    return parsed.filter((v):v is Entry=>!!v&&typeof v==="object" &&
      (v.role==="user"||v.role==="assistant")&&typeof v.content==="string")
      .slice(-24).map(v=>({role:v.role,content:v.content.slice(0,4000)}));
  }catch{return [];}
}
export function mountOnlineChat():void {
  const view=document.getElementById("view-chat");
  const drafts=document.getElementById("chatWorkspaceLayout");
  const header=view?.querySelector(".multi-chat-heading");
  if(!view||!drafts||!header) return;
  const tabs=element("div","shuvi-online-tabs");
  const onlineButton=element("button","secondary-button","✦ Online AI Chat");
  const draftsButton=element("button","secondary-button","Local Drafts");
  onlineButton.type=draftsButton.type="button";
  tabs.append(onlineButton,draftsButton);
  header.insertAdjacentElement("afterend",tabs);
  const panel=element("section","shuvi-online-panel");
  panel.id="shuviOnlineChat";
  panel.hidden=true;
  const top=element("div","shuvi-online-head");
  const title=element("div");
  title.append(element("span","section-kicker","SHUVI ONLINE · CLOUD CONVERSATION"),
    element("h3","","Chat normally with Shuvi"),
    element("p","","Ideas, learning, scripts and planning — no Windows PC required. Cloud Chat cannot control local applications."));
  const newButton=element("button","secondary-button","＋ New conversation");
  newButton.type="button";
  top.append(title,newButton);
  const access=element("div","shuvi-online-access");
  const accessInput=element("input") as HTMLInputElement;
  accessInput.type="password";accessInput.autocomplete="off";accessInput.placeholder="Enter private online access key";
  accessInput.maxLength=180;accessInput.setAttribute("aria-label","Shuvi private online chat access key");
  const connect=element("button","primary-button","Unlock chat");connect.type="button";
  const status=element("span","shuvi-online-status","Cloud connection not configured");
  status.setAttribute("role","status");
  access.append(accessInput,connect,status);
  const stream=element("div","shuvi-online-messages");
  stream.setAttribute("role","log");stream.setAttribute("aria-live","polite");
  const form=element("form","shuvi-online-composer");
  const input=element("textarea") as HTMLTextAreaElement;
  input.rows=3;input.maxLength=4000;
  input.placeholder="Shuvi से कुछ भी पूछिए… प्लानिंग, बातचीत, स्क्रिप्ट या सीखना";
  input.setAttribute("aria-label","Chat with Shuvi Online");
  const footer=element("div","shuvi-online-footer");
  const tip=element("small","","Online text AI · Local PC disconnected · Ctrl+Enter to send");
  const send=element("button","primary-button","Send ↗");send.type="submit";
  footer.append(tip,send);form.append(input,footer);
  panel.append(top,access,stream,form);
  tabs.insertAdjacentElement("afterend",panel);
  let messages=load();
  let accessKey="";
  let busy=false;
  const error=element("p","shuvi-online-error");
  error.setAttribute("role","alert");form.insertAdjacentElement("afterend",error);

  function draw(){
    stream.replaceChildren();
    if(!messages.length) {
      const welcome=element("div","shuvi-online-welcome");
      welcome.append(element("strong","","नमस्ते! मैं Shuvi Online हूँ।"),
        element("p","","सामान्य बातचीत करें, कोई आइडिया सोचें या प्रोजेक्ट प्लान करें। यहाँ से कंप्यूटर पर कोई कार्य नहीं चलेगा।"));
      stream.append(welcome);
    }
    for(const m of messages){
      const bubble=element("div","shuvi-online-bubble "+(m.role==="user"?"from-user":"from-assistant"));
      bubble.append(element("small","",m.role==="user"?"आप":"✦ Shuvi"),element("p","",m.content));
      stream.append(bubble);
    }
    stream.scrollTop=stream.scrollHeight;
  }
  function setOnline(active:boolean){
    panel.hidden=!active;
    drafts.hidden=active;
    const alert=document.getElementById("chatStorageNotice");
    if(alert)alert.hidden=active;
    onlineButton.setAttribute("aria-pressed",String(active));
    draftsButton.setAttribute("aria-pressed",String(!active));
    onlineButton.classList.toggle("active",active);
    draftsButton.classList.toggle("active",!active);
    if(active)draw();
  }
  onlineButton.addEventListener("click",()=>setOnline(true));
  draftsButton.addEventListener("click",()=>setOnline(false));
  connect.addEventListener("click",()=>{
    const value=accessInput.value.trim();
    if(value.length<32){status.textContent="Enter the 32+ character private key configured on Vercel.";return;}
    accessKey=value;
    accessInput.value="";
    status.textContent="Key held only in this tab. Send a message to verify.";
    input.focus();
  });
  newButton.addEventListener("click",()=>{
    if(messages.length && !window.confirm("Start a new online conversation? This clears saved chat text on this browser."))return;
    messages=[];try{localStorage.removeItem(CHAT_KEY);}catch{}
    draw();error.textContent="";input.focus();
  });
  input.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)&&!event.isComposing){
      event.preventDefault();form.requestSubmit();
    }
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(busy||!text)return;
    if(!accessKey){error.textContent="पहले Vercel में सेट की गई Private Online Access Key डालकर Unlock करें।";accessInput.focus();return;}
    busy=true;send.disabled=true;error.textContent="";
    const previous=messages.slice(-16);
    messages=[...messages,{role:"user",content:text}].slice(-24);
    input.value="";draw();status.textContent="Shuvi is thinking…";
    try{
      const response=await fetch("/api/online-chat",{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+accessKey},
        credentials:"omit",cache:"no-store",
        body:JSON.stringify({message:text,history:previous}),
        signal:AbortSignal.timeout(28000)
      });
      const data:unknown=await response.json();
      const result=data as {reply?:unknown;error?:unknown;role?:unknown;tier?:unknown};
      if(!response.ok || typeof result.reply!=="string")throw new Error(
        response.status===401?"Wrong access key. Check your Vercel secret.":"Online AI is not configured or temporarily unavailable.");
      messages=[...messages,{role:"assistant",content:result.reply.slice(0,9000)}].slice(-24);
      try{localStorage.setItem(CHAT_KEY,JSON.stringify(messages));}catch{}
      draw();
      const role=typeof result.role==="string" && /^[a-z_]{1,24}$/.test(result.role)?result.role:"assistant";
      const tier=typeof result.tier==="string" && /^(fast|balanced|heavy)$/.test(result.tier)?result.tier:"balanced";
      status.textContent=`Shuvi ${role} · ${tier} response · Windows not connected`;
    }catch(err){
      error.textContent=err instanceof Error?err.message:"Shuvi Online could not reply.";
      status.textContent="Connection not confirmed";
      try{localStorage.setItem(CHAT_KEY,JSON.stringify(messages));}catch{}
    }finally{busy=false;send.disabled=false;input.focus();}
  });
  void fetch("/api/online-status",{cache:"no-store"}).then(async response=>{
    const data=await response.json() as {onlineAI?:boolean};
    status.textContent=data.onlineAI?"Online AI configured · unlock to chat":"Online AI needs private Vercel credentials";
  }).catch(()=>{status.textContent="Cloud readiness could not be checked";});
  draw();setOnline(false);
}
