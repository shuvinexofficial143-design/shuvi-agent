import {redisCommand,redisConfigured} from "./redis-history.mjs";

/** Approximate daily cap for AI requests; fail closed when Redis unavailable. */
export async function useDailyChatQuota(env=process.env,fetcher=fetch) {
  if(!redisConfigured(env))throw new Error("Chat quota store not configured");
  const raw=Number(env.SHUVI_DAILY_MESSAGE_LIMIT||"100");
  const limit=Number.isSafeInteger(raw)&&raw>=1&&raw<=5000?raw:100;
  const today=new Date().toISOString().slice(0,10);
  const key="shuvi:online:quota:"+today;
  const count=Number(await redisCommand(["INCR",key],env,fetcher));
  if(!Number.isSafeInteger(count)||count<1)throw new Error("Invalid quota response");
  if(count===1)await redisCommand(["EXPIRE",key,"172800"],env,fetcher);
  return {allowed:count<=limit,count,limit,reset:"UTC midnight"};
}
