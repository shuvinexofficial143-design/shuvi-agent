import {safeEqual,httpJson} from "../server/online-core.mjs";
/** Owner can discover the private chat ID before activating a Telegram webhook. */
export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  const auth=req.headers?.authorization;
  const key=typeof auth==="string" && auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!safeEqual(key,process.env.SHUVI_OWNER_ACCESS_KEY))return httpJson(res,401,{error:"Invalid owner key"});
  if(!/^[0-9]{5,20}:[A-Za-z0-9_-]{25,}$/.test(process.env.TELEGRAM_BOT_TOKEN||""))
    return httpJson(res,503,{error:"Set TELEGRAM_BOT_TOKEN on Vercel first"});
  try {
    const r=await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/getUpdates",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({timeout:0,limit:20,allowed_updates:["message"]}),
      redirect:"error",signal:AbortSignal.timeout(7000)
    });
    if(!r.ok)return httpJson(res,409,{error:"Discovery unavailable. Stop native polling; delete any previous cloud webhook before discovery."});
    const body=await r.json();
    if(!body?.ok || !Array.isArray(body.result))return httpJson(res,502,{error:"Telegram discovery failed"});
    const candidates=body.result.filter(u=>
      u?.message?.chat?.type==="private" && Number.isSafeInteger(u?.message?.chat?.id) &&
      u.message.chat.id>0 && u.message.from?.id===u.message.chat.id &&
      /^\/start(?:@\w+)?(?:\s|$)/i.test(u.message.text||""));
    if(candidates.length===0)return httpJson(res,404,{error:"No private /start found. Send /start to your bot, then retry."});
    // Deliberately do not auto-trust this ID: owner must copy it into Vercel env.
    const last=candidates.at(-1);
    return httpJson(res,200,{chatId:String(last.message.chat.id),note:"Verify this is YOUR Telegram chat before setting the owner allowlist. Never grant a foreign chat ID."});
  } catch {return httpJson(res,503,{error:"Could not reach Telegram discovery API"});}
}
