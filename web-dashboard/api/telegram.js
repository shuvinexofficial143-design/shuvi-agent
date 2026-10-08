import { safeEqual, httpJson, parseObjectBody, generateOnlineReply, chunks, onlineConfigured } from "../server/online-core.mjs";
import { redisConfigured, takeUpdateOnce, getTelegramHistory, saveTelegramHistory, clearTelegramHistory } from "../server/redis-history.mjs";

export function telegramConfigured(env=process.env) {
  const token=env.TELEGRAM_BOT_TOKEN||"";
  const secret=env.TELEGRAM_WEBHOOK_SECRET||"";
  const owner=env.TELEGRAM_OWNER_CHAT_ID||"";
  return /^[0-9]{5,20}:[A-Za-z0-9_-]{25,}$/.test(token) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(secret) &&
    /^[1-9][0-9]{3,18}$/.test(owner) && onlineConfigured(env) && redisConfigured(env);
}

export function telegramInput(update,env=process.env) {
  const message=update?.message;
  if (!message || message.chat?.type!=="private" || message.chat?.id==null) return null;
  const owner=Number(env.TELEGRAM_OWNER_CHAT_ID);
  if (!Number.isSafeInteger(owner) || message.chat.id!==owner || message.from?.id!==owner) return null;
  if(typeof message.text!=="string" || !message.text.trim() || message.text.length>4000) return null;
  return {chatId:owner,text:message.text.trim()};
}

export async function sendTelegram(chatId,text,env=process.env,fetcher=fetch) {
  for(const part of chunks(text)) {
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
    try {
      const response=await fetcher("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({chat_id:chatId,text:part,disable_web_page_preview:true}),
        redirect:"error",signal:ctl.signal
      });
      if(!response.ok)throw new Error("Telegram delivery failed");
      const result=await response.json();
      if(!result?.ok)throw new Error("Telegram delivery failed");
    } finally {clearTimeout(timer);}
  }
}

export async function runTelegramUpdate(update,env=process.env,dependencies={}) {
  const incoming=telegramInput(update,env);
  if(!incoming)return {ignored:true};
  const send=dependencies.send||((chatId,text)=>sendTelegram(chatId,text,env));
  const once=dependencies.once||((id)=>takeUpdateOnce(id,env));
  const load=dependencies.load||((id)=>getTelegramHistory(id,env));
  const save=dependencies.save||((id,h)=>saveTelegramHistory(id,h,env));
  const clear=dependencies.clear||((id)=>clearTelegramHistory(id,env));
  const reply=dependencies.reply||((opts)=>generateOnlineReply({...opts,env}));
  if(!await once(update.update_id))return {duplicate:true};
  const {chatId,text}=incoming;
  const command=text.split(/\s/)[0].toLowerCase().split("@")[0];
  if(command==="/start" || command==="/help") {
    await send(chatId,"नमस्ते! मैं Shuvi Online हूँ। 😊\n\nPC बंद हो तब भी आप मुझसे सामान्य बातचीत, आइडिया, स्क्रिप्ट, कोडिंग सलाह और प्रोजेक्ट प्लानिंग कर सकते हैं।\n\n/status — ऑनलाइन स्थिति\n/reset — इस Bot की बातचीत की याद मिटाएँ\n\nWindows कंट्रोल फिलहाल ऑनलाइन Bot से जुड़ा नहीं है।");
    return {command};
  }
  if(command==="/status") {
    await send(chatId,"Shuvi Online AI: उपलब्ध ✅\nWindows / Premiere / Blender: Cloud Chat से कनेक्ट नहीं है।\nइस Bot से अभी केवल सामान्य चैट और प्लानिंग होगी।");
    return {command};
  }
  if(command==="/reset") {
    await clear(chatId);
    await send(chatId,"इस Telegram बातचीत की याद साफ कर दी है। अब नया विषय शुरू कर सकते हैं।");
    return {command};
  }
  if(["/approve","/deny","/cancel","/resume","/run","/task","/pair","/desktop"].includes(command)) {
    await send(chatId,"यह Windows/Shuvi Desktop Command है। Cloud Chat इसे स्वीकार या निष्पादित नहीं करता। Windows Control के लिए अलग सुरक्षित Native Relay और आपकी अनुमति जरूरी है।");
    return {blocked:true};
  }
  if(command.startsWith("/")) {
    await send(chatId,"यह Cloud Chat Command उपलब्ध नहीं है। सामान्य संदेश भेजें या /help लिखें।");
    return {blocked:true};
  }
  const history=await load(chatId);
  try {
    const answer=await reply({prompt:text,history});
    await send(chatId,answer);
    await save(chatId,[...history,{role:"user",content:text},{role:"assistant",content:answer}]);
    return {replied:true};
  } catch {
    await send(chatId,"अभी AI जवाब नहीं दे पा रहा है। कुछ देर बाद फिर पूछें। कोई Windows कार्य शुरू नहीं हुआ है।");
    return {error:true};
  }
}

export default async function handler(req,res) {
  if(req.method!=="POST")return httpJson(res,405,{error:"Method not allowed"});
  if(!telegramConfigured())return httpJson(res,503,{error:"Online Telegram chat not configured"});
  const secret=req.headers?.["x-telegram-bot-api-secret-token"];
  if(!safeEqual(secret,process.env.TELEGRAM_WEBHOOK_SECRET))return httpJson(res,403,{error:"Forbidden"});
  let update;
  try {update=parseObjectBody(req);}catch{return httpJson(res,400,{error:"Invalid update"});}
  if(!Number.isSafeInteger(update.update_id) || update.update_id<0)return httpJson(res,400,{error:"Invalid update ID"});
  try {
    const outcome=await runTelegramUpdate(update);
    return httpJson(res,200,{ok:true,ignored:!!outcome.ignored});
  } catch {
    // Redis/transport failed: allow Telegram to retry, not silently acknowledge lost work.
    return httpJson(res,503,{error:"Temporary delivery failure"});
  }
}
