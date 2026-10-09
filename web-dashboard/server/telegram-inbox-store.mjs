import {redisCommand,redisConfigured} from "./redis-history.mjs";

/** Store ONLY the verified owner's message. Never persist group/unknown sender text. */
export function inboxEvent(update,incoming) {
  if(!incoming || !Number.isSafeInteger(update?.update_id) || update.update_id<0)return null;
  const id=update?.message?.message_id;
  const date=update?.message?.date;
  return {
    updateId:update.update_id,
    messageId:Number.isSafeInteger(id)?id:null,
    receivedAt:new Date().toISOString(),
    sentAt:Number.isSafeInteger(date)&&date>0?new Date(date*1000).toISOString():null,
    text:incoming.text.slice(0,1200),
    source:"telegram",
    state:"received_by_cloud",
    aiStatus:"not_verified"
  };
}

const STORE_SCRIPT=[
  "local id=KEYS[1]",
  "local inbox=KEYS[2]",
  "if redis.call('SET', id, '1', 'EX', 86400, 'NX') == false then return 0 end",
  "redis.call('LPUSH', inbox, ARGV[1])",
  "redis.call('LTRIM', inbox, 0, 49)",
  "redis.call('EXPIRE', inbox, 86400)",
  "return 1"
].join("\n");

/** Atomic update-id dedupe and inbox insert: serverless worker can restart safely. */
export async function persistTelegramInbound(update,incoming,env=process.env,fetcher=fetch) {
  if(!redisConfigured(env))throw new Error("Telegram dashboard inbox storage is not configured");
  const event=inboxEvent(update,incoming);
  if(!event) return {stored:false};
  const id="shuvi:tg:inbox:update:"+event.updateId;
  const list="shuvi:tg:inbox:owner:"+env.TELEGRAM_OWNER_CHAT_ID;
  const result=await redisCommand(["EVAL",STORE_SCRIPT,"2",id,list,JSON.stringify(event)],env,fetcher);
  if(result!==1 && result!==0)throw new Error("Inbox persistence failed");
  return {stored:result===1};
}

export async function getTelegramInbox(env=process.env,fetcher=fetch) {
  if(!redisConfigured(env))throw new Error("Telegram dashboard inbox storage is not configured");
  const owner=env.TELEGRAM_OWNER_CHAT_ID;
  if(!/^[1-9][0-9]{3,18}$/.test(String(owner||"")))throw new Error("Owner chat not configured");
  const result=await redisCommand(["LRANGE","shuvi:tg:inbox:owner:"+owner,"0","49"],env,fetcher);
  if(!Array.isArray(result))throw new Error("Inbox data unavailable");
  return result.map(s=>{try{return JSON.parse(s);}catch{return null;}})
    .filter(x=>x && Number.isSafeInteger(x.updateId) && typeof x.text==="string")
    .map(x=>({updateId:x.updateId,messageId:x.messageId,text:x.text.slice(0,1200),
      receivedAt:x.receivedAt,source:"telegram",state:"received_by_cloud",aiStatus:"not_verified"}));
}
