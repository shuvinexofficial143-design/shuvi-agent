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
  guide.textContent="First connect Telegram for free using /start and /status with SHUVI_AI_CALLS_ENABLED=false. Later set XKIRO_API_KEY, SHUVI_CHAT_PROVIDER=xkiro, XKIRO_CHAT_MODEL=deepseek/deepseek-v4-flash and Upstash Redis server-side in Vercel. Use Check xKiro Free Tokens below to verify the real account allowance and free model tier. Only after this confirmation, explicitly enable SHUVI_AI_CALLS_ENABLED=true for ordinary chat. Do not buy a 5-hour paid xKiro plan for these tests.";
  const link=document.createElement("a");
  link.href="https://vercel.com/avanti-verse/shuvi-control-center/settings/environment-variables";
  link.textContent="Open Vercel Environment Settings ↗";link.target="_blank";link.rel="noopener noreferrer";
  const form=document.createElement("div");form.className="shuvi-cloud-form";
  const key=document.createElement("input");
  key.type="password";key.maxLength=180;key.autocomplete="off";
  key.placeholder="Private 32+ character owner access key";
  key.setAttribute("aria-label","Private cloud owner key");
  const checkFree=document.createElement("button");
  checkFree.type="button";checkFree.className="secondary-button";checkFree.textContent="Check xKiro Free Tokens";
  const discover=document.createElement("button");
  discover.type="button";discover.className="secondary-button";discover.textContent="Find my Chat ID";
  const activate=document.createElement("button");
  activate.type="button";activate.className="primary-button";activate.textContent="Activate Cloud Telegram";
  form.append(key,discover,checkFree,activate);
  const feedback=document.createElement("p");
  feedback.className="shuvi-cloud-feedback";feedback.setAttribute("role","status");
  feedback.textContent="Checking cloud configuration…";
  const boundary=document.createElement("p");
  boundary.textContent="Safety: Do not paste your Telegram Bot Token or xKiro/OpenRouter API key here or into ChatGPT. This access key stays in the field only. Cloud webhook and native Telegram polling cannot run simultaneously for one bot.";
  section.append(title,info,link,guide,form,feedback,boundary);
  panel.querySelector(".shuvi-telegram-flow")?.insertAdjacentElement("beforebegin",section);

  async function submit(path:string):Promise<{ok?:boolean;chatId?:string;model?:string;catalogFreeAndZeroCost?:boolean;freeAllowanceAvailable?:boolean;freeRemaining?:number|null}|null>{
    const access=key.value.trim();
    if(access.length<32){feedback.textContent="Enter the Vercel private owner key (32+ characters).";return null;}
    discover.disabled=true;activate.disabled=true;feedback.textContent="Connecting securely…";
    try{
      const response=await fetch(path,{
        method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},
        credentials:"omit",cache:"no-store",body:"{}",signal:AbortSignal.timeout(15000)
      });
      const body=await response.json() as {ok?:boolean;chatId?:string;error?:string;model?:string;catalogFreeAndZeroCost?:boolean;freeAllowanceAvailable?:boolean;freeRemaining?:number|null};
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
  checkFree.addEventListener("click",async()=>{
    const result=await submit("/api/xkiro-free-status") as {model?:string;catalogFreeAndZeroCost?:boolean;freeAllowanceAvailable?:boolean;freeRemaining?:number|null}|null;
    if(!result)return;
    feedback.textContent=result.catalogFreeAndZeroCost && result.freeAllowanceAvailable
      ? "Free model verified: "+result.model+" · Remaining free tokens: "+(result.freeRemaining??"uncapped")+" · No paid fallback."
      : "Free model or allowance NOT verified: leave AI switched OFF.";
  });
  activate.addEventListener("click",async()=>{
    if(!window.confirm("Switch this bot to cloud webhook mode? Native Shuvi Telegram polling must remain OFF. Cloud chat cannot approve or run Windows actions."))return;
    const result=await submit("/api/telegram-setup");
    if(result?.ok){key.value="";feedback.textContent="Webhook activated. Test a message in Telegram. Live delivery still needs verification.";}
  });
  void fetch("/api/online-status",{cache:"no-store"}).then(async r=>{
    const s=await r.json() as {telegramReady?:boolean;onlineAI?:boolean;aiCallsEnabled?:boolean};
    feedback.textContent=s.telegramReady && !s.aiCallsEnabled
      ? "Telegram connection test ready · Paid AI OFF · Safe to test /start and /status."
      :s.telegramReady
        ? "Telegram configured · AI switch is ON. Avoid messages until approved test time."
        : "Telegram setup needs bot, owner Chat ID and webhook secret. Redis and paid AI are NOT required for connection tests.";
  }).catch(()=>{feedback.textContent="Could not check cloud readiness. Verify Vercel setup.";});
}
