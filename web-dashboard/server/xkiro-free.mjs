/**
 * xKiro no-paid-fallback adapter for Shuvi's text-only cloud chat.
 * All checks fail closed BEFORE any POST /chat/completions.
 * Never infer a tier from a model name or an advertised context size.
 */
const ORIGIN="https://api.xkiro.com";
export const DEFAULT_XKIRO_FREE_MODEL="deepseek/deepseek-v4-flash";

function allowModelName(model) {
  return typeof model==="string" &&
    /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i.test(model) && model.length<=160;
}
function freePrice(value) {
  return (typeof value==="number" || (typeof value==="string" && value.trim()!=="")) &&
    Number.isFinite(Number(value)) && Number(value)===0;
}

export function confirmedFreeCatalogModel(catalog,model) {
  if(!allowModelName(model)||!Array.isArray(catalog?.data))return false;
  const hit=catalog.data.find(x=>x?.id===model);
  return !!hit && hit.access_tier==="free" &&
    (hit.modality===undefined || hit.modality==="chat") &&
    freePrice(hit?.pricing?.input) && freePrice(hit?.pricing?.output);
}

export function hasFreeDailyAllowance(usage) {
  if(!usage || typeof usage!=="object" || !usage.free_tokens)return false;
  const {remaining,limit_per_day}=usage.free_tokens;
  if(remaining===null) return limit_per_day===null;
  return Number.isSafeInteger(remaining) && remaining>0;
}

export function xkiroConfigured(env=process.env) {
  return typeof env.XKIRO_API_KEY==="string" && env.XKIRO_API_KEY.length>=10 &&
    allowModelName(env.XKIRO_CHAT_MODEL||DEFAULT_XKIRO_FREE_MODEL);
}

export async function callXkiroFree({env=process.env,messages,fetcher=fetch}) {
  if(env.SHUVI_AI_CALLS_ENABLED!=="true")throw new Error("AI calls disabled");
  if(!xkiroConfigured(env))throw new Error("xKiro free-model setup incomplete");
  const model=env.XKIRO_CHAT_MODEL||DEFAULT_XKIRO_FREE_MODEL;
  const key=env.XKIRO_API_KEY;
  // Catalog is public; usage is read-only and unmetered. Both are prerequisites.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const [catalogResponse,usageResponse]=await Promise.all([
      fetcher(ORIGIN+"/v1/models",{method:"GET",redirect:"error",signal:controller.signal}),
      fetcher(ORIGIN+"/v1/usage",{
        method:"GET",
        headers:{"Authorization":"Bearer "+key},
        redirect:"error",signal:controller.signal
      })
    ]);
    if(!catalogResponse.ok || !usageResponse.ok)throw new Error("Cannot verify free-only model eligibility");
    const [catalog,usage]=await Promise.all([catalogResponse.json(),usageResponse.json()]);
    if(!confirmedFreeCatalogModel(catalog,model))throw new Error("Requested xKiro model is not confirmed free; paid fallback is prohibited");
    if(!hasFreeDailyAllowance(usage))throw new Error("Free token allowance exhausted or unknown; paid fallback is prohibited");
  } finally {clearTimeout(timer);}
  const controller2=new AbortController(),timer2=setTimeout(()=>controller2.abort(),20000);
  try {
    const response=await fetcher(ORIGIN+"/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+key,
        "X-Title":"Shuvi Free Chat"
      },
      body:JSON.stringify({
        model,
        messages,
        max_tokens:650,
        stream:false,
        temperature:0.6
      }),
      redirect:"error",signal:controller2.signal
    });
    if(!response.ok)throw new Error("xKiro free chat unavailable (no paid fallback)");
    const output=await response.json();
    if(output?.model && output.model!==model)throw new Error("Unexpected model response");
    if(output?.choices?.[0]?.message?.tool_calls?.length)throw new Error("Unexpected tool call");
    const answer=output?.choices?.[0]?.message?.content;
    if(typeof answer!=="string" || !answer.trim())throw new Error("Free model returned no text");
    return answer.trim().slice(0,9000);
  } finally {clearTimeout(timer2);}
}
