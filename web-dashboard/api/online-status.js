import {httpJson,onlineConfigured,aiCallsEnabled} from "../server/online-core.mjs";
import {redisConfigured} from "../server/redis-history.mjs";

export default function handler(req,res) {
  if(req.method!=="GET")return httpJson(res,405,{error:"Method not allowed"});
  return httpJson(res,200,{
    onlineAI:onlineConfigured() && redisConfigured() && !!process.env.SHUVI_OWNER_ACCESS_KEY && process.env.SHUVI_OWNER_ACCESS_KEY.length>=32,
    aiCallsEnabled:aiCallsEnabled(),
    memoryReady:redisConfigured(),
    nativeConnected:false,
    mode:"cloud_chat_only",
    note:"Online AI is configured separately from browser-local chat and Windows runtime. AI requests are disabled unless SHUVI_AI_CALLS_ENABLED=true."
  });
}
