import { safeEqual, httpJson, parseObjectBody, generateOnlineReply, chunks, onlineConfigured } from "../server/online-core.mjs";
import { redisConfigured, takeUpdateOnce, getTelegramHistory, saveTelegramHistory, clearTelegramHistory } from "../server/redis-history.mjs";
import {useDailyChatQuota} from "../server/chat-quota.mjs";
import {persistTelegramInbound} from "../server/telegram-inbox-store.mjs";

export function telegramConfigured(env=process.env) {
  const token=env.TELEGRAM_BOT_TOKEN||"";
  const secret=env.TELEGRAM_WEBHOOK_SECRET||"";
  const owner=env.TELEGRAM_OWNER_CHAT_ID||"";
  return /^[0-9]{5,20}:[A-Za-z0-9_-]{25,}$/.test(token) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(secret) &&
    /^[1-9][0-9]{3,18}$/.test(owner) && (!onlineConfigured(env) || redisConfigured(env));
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
  // Connection-only Telegram tests need no database; AI mode requires Redis dedupe.
  const once=dependencies.once||(redisConfigured(env)?((id)=>takeUpdateOnce(id,env)):(async()=>true));
  const load=dependencies.load||((id)=>getTelegramHistory(id,env));
  const save=dependencies.save||((id,h)=>saveTelegramHistory(id,h,env));
  const clear=dependencies.clear||((id)=>clearTelegramHistory(id,env));
  const quota=dependencies.quota||(()=>useDailyChatQuota(env));
  const reply=dependencies.reply||((opts)=>generateOnlineReply({...opts,env}));
  if(!await once(update.update_id))return {duplicate:true};
  const {chatId,text}=incoming;
  const command=text.split(/\s/)[0].toLowerCase().split("@")[0];
  if(command==="/start" || command==="/help") {
    await send(chatId,"नमस्ते! Shuvi Telegram कनेक्शन चालू है। ✅\n\n/status — Telegram स्थिति\n/reset — पिछली AI बातचीत साफ करें\n\n"+(onlineConfigured(env)
      ? "सामान्य AI बातचीत उपलब्ध है। Windows कंट्रोल अभी अलग है।"
      : "AI API अभी बंद है। इसलिए Telegram का परीक्षण बिना किसी Paid AI Call के हो रहा है।"));
    return {command};
  }
  if(command==="/status") {
    await send(chatId,"Telegram Bot: कनेक्टेड ✅\nAI मॉडल: "+(onlineConfigured(env)?"चालू ✅":"सुरक्षित रूप से बंद ⏸️")+
      "\nWindows / Premiere / Blender: अभी कनेक्ट नहीं हैं।\nAI कॉल तभी होंगे जब सर्वर पर अलग से अनुमति दी जाएगी।");
    return {command};
  }
  if(command==="/reset") {
    if(redisConfigured(env)) await clear(chatId);
    await send(chatId,redisConfigured(env)?"इस Telegram बातचीत की याद साफ कर दी है। अब नया विषय शुरू कर सकते हैं।":"अभी AI बंद है; कोई Cloud Memory या Paid Model चालू नहीं है।");
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
  // Connection-only mode must never consume any AI credits or quota.
  if (!onlineConfigured(env)) {
    await send(chatId,"Telegram से आपका संदेश मिल गया। ✅ अभी AI मॉडल बंद है ताकि टेस्ट के दौरान कोई API खर्च न हो। Chat शुरू करने के लिए बाद में server-side SHUVI_AI_CALLS_ENABLED=true सेट करेंगे।");
    return {aiPaused:true};
  }
  const budget=await quota();
  if(!budget.allowed){await send(chatId,"आज की Shuvi Online चैट सीमा पूरी हो गई है। अगला दिन शुरू होने पर फिर बात कर सकते हैं। कोई नया AI खर्च नहीं हुआ है।");return {limited:true};}
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
    // Save the inbound Telegram event BEFORE any AI reply or command handling.
    // An AI error must not hide a successfully delivered Telegram message.
    const incoming=telegramInput(update);
    if(incoming && redisConfigured())await persistTelegramInbound(update,incoming);
    const outcome=await runTelegramUpdate(update);
    return httpJson(res,200,{ok:true,ignored:!!outcome.ignored});
  } catch {
    // Redis/transport failed: allow Telegram to retry, not silently acknowledge lost work.
    return httpJson(res,503,{error:"Temporary delivery failure"});
  }
}
