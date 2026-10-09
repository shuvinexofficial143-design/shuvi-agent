import {safeEqual,httpJson} from "../server/online-core.mjs";
import {telegramConfigured} from "./telegram.js";

export function safeWebhookUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==="https:" && u.username==="" && u.password==="" &&
      u.hostname==="shuvi-control-center.vercel.app" &&
      u.pathname==="/api/telegram" && !u.search && !u.hash;
  }catch{return false;}
}

export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  const authorization=req.headers?.authorization;
  const key=typeof authorization==="string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if(!safeEqual(key,process.env.SHUVI_OWNER_ACCESS_KEY))return httpJson(res,401,{error:"Invalid owner access key"});
  if(!telegramConfigured())return httpJson(res,503,{error:"Telegram owner, bot token or webhook secret missing (Redis needed only for paid AI mode)"});
  const endpoint="https://shuvi-control-center.vercel.app/api/telegram";
  if(!safeWebhookUrl(endpoint))return httpJson(res,500,{error:"Invalid webhook configuration"});
  try {
    // CAUTION: Telegram webhook and native getUpdates are mutually exclusive.
    // Only activate after owner deliberately switches to cloud Telegram mode.
    const response=await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/setWebhook",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        url:endpoint,
        secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates:["message"],
        drop_pending_updates:true,
        max_connections:1
      }),redirect:"error",signal:AbortSignal.timeout(9000)
    });
    if(!response.ok)return httpJson(res,502,{error:"Telegram refused webhook activation"});
    const data=await response.json();
    if(!data?.ok)return httpJson(res,502,{error:"Telegram refused webhook activation"});
    return httpJson(res,200,{ok:true,mode:"cloud_webhook",webhook:"/api/telegram",nativePolling:"must_remain_disabled"});
  } catch {return httpJson(res,502,{error:"Could not contact Telegram setup API"});}
}
