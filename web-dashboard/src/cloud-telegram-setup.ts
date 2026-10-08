/** Cloud-only Telegram setup. Never collect bot/provider API keys in the browser. */
export function mountCloudTelegramSetup():void {
  const panel=document.getElementById("telegramWebSetup");
  if(!panel)return;
  const section=document.createElement("section");
  section.className="shuvi-cloud-setup";
  section.setAttribute("aria-label","Telegram Cloud Chat setup");
  const title=document.createElement("h4");
  title.textContent="Shuvi Online · Telegram while PC is OFF";
  const info=document.createElement("p");
  info.textContent="Online AI handles normal chat and planning. Windows controls and approvals are not connected. The bot token and AI key stay only in Vercel Environment Variables.";
  const guide=document.createElement("p");
  guide.textContent="Step 1: Configure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SHUVI_OWNER_ACCESS_KEY, OPENROUTER_API_KEY, SHUVI_CHAT_MODEL, UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel; redeploy. Step 2: Send /start to your bot, discover your private Chat ID here, add it as TELEGRAM_OWNER_CHAT_ID in Vercel, and redeploy. Step 3: Activate webhook and test /start.";
  const link=document.createElement("a");
  link.href="https://vercel.com/avanti-verse/shuvi-control-center/settings/environment-variables";
  link.textContent="Open Vercel Environment Settings ↗";link.target="_blank";link.rel="noopener noreferrer";
  const form=document.createElement("div");form.className="shuvi-cloud-form";
  const key=document.createElement("input");
  key.type="password";key.maxLength=180;key.autocomplete="off";
  key.placeholder="Private 32+ character owner access key";
  key.setAttribute("aria-label","Private cloud owner key");
  const discover=document.createElement("button");
  discover.type="button";discover.className="secondary-button";discover.textContent="Find my Chat ID";
  const activate=document.createElement("button");
  activate.type="button";activate.className="primary-button";activate.textContent="Activate Cloud Telegram";
  form.append(key,discover,activate);
  const feedback=document.createElement("p");
  feedback.className="shuvi-cloud-feedback";feedback.setAttribute("role","status");
  feedback.textContent="Checking cloud configuration…";
  const boundary=document.createElement("p");
  boundary.textContent="Safety: Do not paste your Telegram Bot Token or OpenRouter key here or into ChatGPT. This access key stays in the field only. Cloud webhook and native Telegram polling cannot run simultaneously for one bot.";
  section.append(title,info,link,guide,form,feedback,boundary);
  panel.querySelector(".shuvi-telegram-flow")?.insertAdjacentElement("beforebegin",section);

  async function submit(path:string):Promise<{ok?:boolean;chatId?:string}|null>{
    const access=key.value.trim();
    if(access.length<32){feedback.textContent="Enter the Vercel private owner key (32+ characters).";return null;}
    discover.disabled=true;activate.disabled=true;feedback.textContent="Connecting securely…";
    try{
      const response=await fetch(path,{
        method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},
        credentials:"omit",cache:"no-store",body:"{}",signal:AbortSignal.timeout(15000)
      });
      const body=await response.json() as {ok?:boolean;chatId?:string;error?:string};
      if(!response.ok)throw new Error(body.error||"Cloud setup unavailable");
      return body;
    }catch(err){feedback.textContent=err instanceof Error?err.message:"Setup unavailable";return null;}
    finally{discover.disabled=false;activate.disabled=false;}
  }
  discover.addEventListener("click",async()=>{
    const result=await submit("/api/telegram-discover");
    if(result?.chatId)feedback.textContent="Candidate private Chat ID: "+result.chatId+
      ". Verify it is YOUR Telegram account, then set TELEGRAM_OWNER_CHAT_ID in Vercel and redeploy.";
  });
  activate.addEventListener("click",async()=>{
    if(!window.confirm("Switch this bot to cloud webhook mode? Native Shuvi Telegram polling must remain OFF. Cloud chat cannot approve or run Windows actions."))return;
    const result=await submit("/api/telegram-setup");
    if(result?.ok){key.value="";feedback.textContent="Webhook activated. Test a message in Telegram. Live delivery still needs verification.";}
  });
  void fetch("/api/online-status",{cache:"no-store"}).then(async r=>{
    const s=await r.json() as {telegramReady?:boolean;onlineAI?:boolean};
    feedback.textContent=s.telegramReady?"Cloud settings ready; enter owner key and activate webhook."
      :s.onlineAI?"Online AI ready; Telegram credentials/owner ID/Redis still needed."
      :"Online AI not configured in Vercel yet.";
  }).catch(()=>{feedback.textContent="Could not check cloud readiness. Verify Vercel setup.";});
}
