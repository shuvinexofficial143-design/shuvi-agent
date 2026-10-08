import { cleanHistory } from "./online-core.mjs";

export function redisConfigured(env=process.env) {
  try {
    const url=new URL(env.UPSTASH_REDIS_REST_URL||"");
    return url.protocol==="https:" && Boolean(env.UPSTASH_REDIS_REST_TOKEN);
  } catch {return false;}
}

export async function redisCommand(args,env=process.env,fetcher=fetch) {
  if(!redisConfigured(env))throw new Error("Memory store not configured");
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),4000);
  try {
    const response=await fetcher(env.UPSTASH_REDIS_REST_URL,{
      method:"POST",headers:{"Authorization":"Bearer "+env.UPSTASH_REDIS_REST_TOKEN,"Content-Type":"application/json"},
      body:JSON.stringify(args),redirect:"error",signal:controller.signal
    });
    if(!response.ok)throw new Error("Memory store unavailable");
    const data=await response.json();
    if(data.error)throw new Error("Memory store unavailable");
    return data.result;
  } finally {clearTimeout(timer);}
}

function chatKey(ownerId) {return "shuvi:online:telegram:history:"+ownerId;}
export async function takeUpdateOnce(updateId,env=process.env,fetcher=fetch) {
  if(!Number.isSafeInteger(updateId)||updateId<0)throw new Error("Invalid Telegram update ID");
  const result=await redisCommand(["SET","shuvi:online:telegram:update:"+updateId,"1","EX","86400","NX"],env,fetcher);
  return result==="OK";
}
export async function getTelegramHistory(ownerId,env=process.env,fetcher=fetch) {
  const value=await redisCommand(["GET",chatKey(ownerId)],env,fetcher);
  if(!value)return [];
  try{return cleanHistory(JSON.parse(value));}catch{return [];}
}
export async function saveTelegramHistory(ownerId,history,env=process.env,fetcher=fetch) {
  return redisCommand(["SET",chatKey(ownerId),JSON.stringify(cleanHistory(history)),"EX","604800"],env,fetcher);
}
export async function clearTelegramHistory(ownerId,env=process.env,fetcher=fetch) {
  return redisCommand(["DEL",chatKey(ownerId)],env,fetcher);
}
