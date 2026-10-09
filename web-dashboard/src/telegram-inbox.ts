/**
 * Private Telegram inbox mirror on the live Shuvi Dashboard.
 * Authenticated read-only polling, no AI calls, no Windows action, no secret storage.
 */
export function mountTelegramDashboardInbox():void {
  const dashboard=document.getElementById("view-dashboard");
  const anchor=dashboard?.querySelector(".dashboard-run-summary");
  if(!dashboard||!anchor)return;
  const panel=document.createElement("section");
  panel.id="telegramDashboardInbox";
  panel.className="shuvi-inbox-panel";
  panel.setAttribute("aria-label","Live Telegram messages");
  const head=document.createElement("div");head.className="shuvi-inbox-head";
  const title=document.createElement("div");
  const tag=document.createElement("span");tag.className="section-kicker";
  tag.textContent="TELEGRAM / LIVE CONNECTION TEST";
  const h=document.createElement("h3");h.textContent="Telegram Messages";
  const desc=document.createElement("p");
  desc.textContent="Incoming Telegram messages appear here after the webhook and private inbox are connected. An unavailable AI model does not hide incoming messages.";
  title.append(tag,h,desc);
  const state=document.createElement("strong");state.className="shuvi-inbox-badge";
  state.id="telegramInboxStatus";state.textContent="Not connected";
  head.append(title,state);

  const form=document.createElement("div");form.className="shuvi-inbox-connect";
  const access=document.createElement("input");
  access.type="password";access.autocomplete="off";access.maxLength=180;
  access.placeholder="Your private Shuvi owner access key (not Bot Token)";
  access.setAttribute("aria-label","Private inbox access key");
  const button=document.createElement("button");button.type="button";
  button.className="primary-button";button.textContent="Connect inbox";
  const refresh=document.createElement("button");refresh.type="button";
  refresh.className="secondary-button";refresh.textContent="Refresh messages";
  form.append(access,button,refresh);
  const feedback=document.createElement("p");feedback.id="telegramInboxFeedback";
  feedback.className="shuvi-inbox-feedback";feedback.setAttribute("role","status");
  feedback.textContent="Waiting for private inbox setup. No AI API is needed.";
  const list=document.createElement("div");list.className="shuvi-inbox-list";list.id="telegramInboxMessages";
  const empty=document.createElement("p");empty.className="shuvi-inbox-empty";
  empty.textContent="No Telegram messages have been received in this inbox yet.";
  list.append(empty);
  panel.append(head,form,feedback,list);
  anchor.insertAdjacentElement("beforebegin",panel);

  let ownerKey=""; // in page memory only, never persisted
  let pending=false;
  let lastMessageId=-1;
  function renderRows(rows:Array<{updateId:number;text:string;receivedAt:string;state:string}>){
    list.replaceChildren();
    if(!rows.length){
      const e=document.createElement("p");e.className="shuvi-inbox-empty";
      e.textContent="Webhook is ready for messages. Send a short message to your Telegram bot and press Refresh.";
      list.append(e);
      return;
    }
    for(const row of rows){
      const item=document.createElement("article");item.className="shuvi-inbox-message";
      const heading=document.createElement("div");heading.className="shuvi-inbox-message-head";
      const name=document.createElement("strong");name.textContent="Telegram → Shuvi";
      const date=document.createElement("time");
      const parsed=Date.parse(row.receivedAt);
      date.textContent=Number.isNaN(parsed)?"Received":new Date(parsed).toLocaleString("hi-IN");
      heading.append(name,date);
      const body=document.createElement("p");body.textContent=row.text;
      const stateLabel=document.createElement("small");
      stateLabel.textContent="Received by cloud · AI/PC execution not verified";
      item.append(heading,body,stateLabel);list.append(item);
    }
  }

  async function poll():Promise<void>{
    if(!ownerKey||pending||document.visibilityState==="hidden")return;
    pending=true;
    try{
      const res=await fetch("/api/telegram-inbox",{
        method:"POST",headers:{"Authorization":"Bearer "+ownerKey,"Content-Type":"application/json"},
        body:"{}",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(10000)
      });
      const data=await res.json() as {error?:string;messages?:Array<{updateId:number;text:string;receivedAt:string;state:string}>};
      if(!res.ok || !Array.isArray(data.messages))throw new Error(data.error||"Inbox is unavailable");
      const rows=data.messages;
      renderRows(rows);
      if(rows.length){
        const current=Math.max(...rows.map(m=>m.updateId));
        lastMessageId=current;
        state.textContent="Message received";
        feedback.textContent=rows.length+" Telegram message(s) received by Shuvi Cloud. AI remains independent.";
      } else {
        state.textContent="Waiting for Telegram";
        feedback.textContent="Inbox authenticated. Waiting for the first incoming message. Check webhook setup if none appears.";
      }
    } catch(err){
      state.textContent="Inbox unavailable";
      feedback.textContent=err instanceof Error?err.message:"Inbox request failed";
      if(/access key|401|unauthoriz/i.test(feedback.textContent))ownerKey="";
    } finally{pending=false;}
  }
  button.addEventListener("click",()=>{
    const provided=access.value.trim();
    if(provided.length<32){feedback.textContent="Enter your private 32+ character owner access key. Never paste the Telegram Bot Token here.";return;}
    ownerKey=provided;
    access.value="";
    void poll();
  });
  refresh.addEventListener("click",()=>void poll());
  // Polls only while the dashboard is open; no model requests or desktop commands.
  window.setInterval(()=>{if(!dashboard.classList.contains("hidden"))void poll();},7000);
}
