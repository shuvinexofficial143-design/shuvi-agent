import {safeEqual,httpJson} from "../server/online-core.mjs";
import {DEFAULT_XKIRO_FREE_MODEL,confirmedFreeCatalogModel,xkiroConfigured,hasFreeDailyAllowance} from "../server/xkiro-free.mjs";

/** Read-only free-token status. Requires the private Shuvi owner access key. */
export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  const auth=req.headers?.authorization;
  const key=typeof auth==="string"&&auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!safeEqual(key,process.env.SHUVI_OWNER_ACCESS_KEY))return httpJson(res,401,{error:"Invalid owner access key"});
  if(process.env.SHUVI_CHAT_PROVIDER!=="xkiro" || !xkiroConfigured())
    return httpJson(res,503,{error:"xKiro server-side key/provider not configured"});
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
  try {
    const [models,usage]=await Promise.all([
      fetch("https://api.xkiro.com/v1/models",{redirect:"error",signal:ctrl.signal}),
      fetch("https://api.xkiro.com/v1/usage",{
        method:"GET",headers:{"Authorization":"Bearer "+process.env.XKIRO_API_KEY},
        redirect:"error",signal:ctrl.signal
      })
    ]);
    if(!models.ok||!usage.ok)return httpJson(res,502,{error:"Could not verify xKiro free status"});
    const [catalog,stats]=await Promise.all([models.json(),usage.json()]);
    const model=process.env.XKIRO_CHAT_MODEL||DEFAULT_XKIRO_FREE_MODEL;
    const allowed=confirmedFreeCatalogModel(catalog,model);
    const budget=hasFreeDailyAllowance(stats);
    const quota=stats?.free_tokens||{};
    return httpJson(res,200,{
      model,
      catalogFreeAndZeroCost:allowed,
      freeAllowanceAvailable:budget,
      freeUsedToday:Number.isSafeInteger(quota.used_today)?quota.used_today:null,
      freeLimitPerDay:Number.isSafeInteger(quota.limit_per_day)?quota.limit_per_day:null,
      freeRemaining:Number.isSafeInteger(quota.remaining)?quota.remaining:null,
      aiEnabled:process.env.SHUVI_AI_CALLS_ENABLED==="true",
      noPaidFallback:true,
      warning:"Read-only xKiro API checks. Paid fallback disabled. This does not activate paid plan windows."
    });
  }catch{return httpJson(res,503,{error:"xKiro free balance check unavailable; inference stays blocked"});}
  finally{clearTimeout(timer);}
}
