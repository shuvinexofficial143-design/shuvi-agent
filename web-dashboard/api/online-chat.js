import { safeEqual, httpJson, parseObjectBody, cleanHistory, generateOnlineReply, onlineConfigured } from "../server/online-core.mjs";
import { useDailyChatQuota } from "../server/chat-quota.mjs";
import {redisConfigured} from "../server/redis-history.mjs";
import {conversationalRoute} from "../server/cloud-chat-router.mjs";

export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  if(!onlineConfigured() || !redisConfigured() || !process.env.SHUVI_OWNER_ACCESS_KEY || process.env.SHUVI_OWNER_ACCESS_KEY.length<32)
    return httpJson(res,503,{error:"Online AI not configured"});
  const authorization=req.headers?.authorization;
  const secret=typeof authorization==="string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if(!safeEqual(secret,process.env.SHUVI_OWNER_ACCESS_KEY))return httpJson(res,401,{error:"Invalid owner access key"});
  let body;
  try {body=parseObjectBody(req,35000);}catch{return httpJson(res,400,{error:"Invalid message"});}
  if(typeof body.message!=="string" || !body.message.trim() || body.message.length>4000) return httpJson(res,400,{error:"Message required (up to 4000 characters)"});
  try {
    const quota=await useDailyChatQuota();
    if(!quota.allowed)return httpJson(res,429,{error:"Daily online AI chat limit reached. No paid model call was made."});
    const route=conversationalRoute(body.message);
    const answer=await generateOnlineReply({prompt:body.message,history:cleanHistory(body.history),roleInstruction:route.instruction});
    return httpJson(res,200,{reply:answer,mode:"cloud_chat_only",computerConnected:false,
      role:route.roleId,tier:route.tier,workersActive:0,selectionSource:route.selectionSource});
  }catch{return httpJson(res,503,{error:"AI is temporarily unavailable. Try again later."});}
}
