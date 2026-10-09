import {safeEqual,httpJson} from "../server/online-core.mjs";
import {redisConfigured} from "../server/redis-history.mjs";
import {getTelegramInbox} from "../server/telegram-inbox-store.mjs";

/** Owner-only, read-only, no-store inbox used by the public Vercel dashboard. */
export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  const auth=req.headers?.authorization;
  const provided=typeof auth==="string" && auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!safeEqual(provided,process.env.SHUVI_OWNER_ACCESS_KEY))
    return httpJson(res,401,{error:"Private dashboard access key required"});
  if(!redisConfigured() || !process.env.TELEGRAM_OWNER_CHAT_ID)
    return httpJson(res,503,{error:"Inbox storage / owner chat ID not configured"});
  try {
    const messages=await getTelegramInbox();
    return httpJson(res,200,{
      connected:messages.length>0,
      state:messages.length?"messages_received":"waiting_for_first_message",
      messages,
      aiConnected:false,
      note:"Only authorized Telegram messages received by the cloud webhook are displayed. This does not prove AI or Windows execution."
    });
  } catch {
    return httpJson(res,503,{error:"Telegram inbox unavailable. Check Redis connection."});
  }
}
