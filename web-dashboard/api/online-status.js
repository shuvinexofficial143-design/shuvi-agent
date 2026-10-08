import {httpJson,onlineConfigured} from "../server/online-core.mjs";
import {redisConfigured} from "../server/redis-history.mjs";
import {telegramConfigured} from "./telegram.js";

export default function handler(req,res) {
  if(req.method!=="GET")return httpJson(res,405,{error:"Method not allowed"});
  return httpJson(res,200,{
    onlineAI:onlineConfigured() && redisConfigured() && !!process.env.SHUVI_OWNER_ACCESS_KEY && process.env.SHUVI_OWNER_ACCESS_KEY.length>=32,
    telegramReady:telegramConfigured(),
    memoryReady:redisConfigured(),
    nativeConnected:false,
    mode:"cloud_chat_only",
    note:"Readiness is configuration only; Telegram webhook delivery needs a separate live test."
  });
}
