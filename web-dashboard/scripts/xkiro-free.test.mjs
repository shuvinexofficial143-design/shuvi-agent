import test from "node:test";
import assert from "node:assert/strict";
import { callXkiroFree, confirmedFreeCatalogModel, hasFreeDailyAllowance, DEFAULT_XKIRO_FREE_MODEL } from "../server/xkiro-free.mjs";
import { generateOnlineReply, onlineConfigured } from "../server/online-core.mjs";

const model=DEFAULT_XKIRO_FREE_MODEL;
const env={
  SHUVI_AI_CALLS_ENABLED:"true",
  SHUVI_CHAT_PROVIDER:"xkiro",
  XKIRO_CHAT_MODEL:model,
  XKIRO_API_KEY:"private_test_key_0123456789"
};
const free={id:model,access_tier:"free",modality:"chat",pricing:{input:0,output:"0"}};
const paid={id:model,access_tier:"paid",modality:"chat",pricing:{input:0.01,output:0.01}};

test("xKiro free chat requires explicit enabled switch and exact provider",()=>{
  assert.equal(onlineConfigured(env),true);
  assert.equal(onlineConfigured({...env,SHUVI_AI_CALLS_ENABLED:"false"}),false);
  assert.equal(onlineConfigured({...env,SHUVI_CHAT_PROVIDER:"openrouter"}),false);
  assert.equal(onlineConfigured({...env,XKIRO_API_KEY:""}),false);
  assert.equal(onlineConfigured({...env,XKIRO_CHAT_MODEL:"sol"}),false);
});

test("Only catalog-verified free and zero-price model is allowed",()=>{
  assert.equal(confirmedFreeCatalogModel({data:[free]},model),true);
  assert.equal(confirmedFreeCatalogModel({data:[paid]},model),false);
  assert.equal(confirmedFreeCatalogModel({data:[{...free,access_tier:"premium"}]},model),false);
  assert.equal(confirmedFreeCatalogModel({data:[{...free,pricing:{input:0,output:"0.00001"}}]},model),false);
  assert.equal(confirmedFreeCatalogModel({data:[{...free,pricing:null}]},model),false);
  assert.equal(confirmedFreeCatalogModel({data:[free]},"other/model"),false);
});

test("Usage must report free allowance remaining; never fall back to wallet",()=>{
  assert.equal(hasFreeDailyAllowance({free_tokens:{remaining:100,limit_per_day:500000}}),true);
  assert.equal(hasFreeDailyAllowance({free_tokens:{remaining:0,limit_per_day:500000}}),false);
  assert.equal(hasFreeDailyAllowance({free_tokens:{remaining:null,limit_per_day:null}}),true);
  assert.equal(hasFreeDailyAllowance({wallet:{balance_usd:"500"}}),false);
});

function mocks({catalog={data:[free]},usage={free_tokens:{remaining:1200,limit_per_day:8000000}}}={}) {
  const requests=[];
  const fetcher=async(url,opts)=>{
    requests.push({url,opts});
    if(url.endsWith("/models"))return {ok:true,json:async()=>catalog};
    if(url.endsWith("/usage"))return {ok:true,json:async()=>usage};
    if(url.endsWith("/chat/completions"))return {ok:true,json:async()=>({
      model,choices:[{message:{role:"assistant",content:"नमस्ते, मैं Shuvi हूँ!"}}]
    })};
    throw Error("unexpected network request: "+url);
  };
  return {requests,fetcher};
}

test("Verified free xKiro request uses only free model and no tool execution",async()=>{
  const mocked=mocks();
  const reply=await generateOnlineReply({prompt:"सामान्य बातचीत करें",env,fetcher:mocked.fetcher});
  assert.match(reply,/Shuvi/);
  assert.equal(mocked.requests.length,3);
  const payload=JSON.parse(mocked.requests.at(-1).opts.body);
  assert.equal(payload.model,model);
  assert.equal(payload.messages[0].role,"system");
  assert.equal("tools" in payload,false);
  assert.ok(mocked.requests[1].opts.headers.Authorization.startsWith("Bearer "));
});

test("Paid or unknown models and exhausted quota result in ZERO inference requests",async()=>{
  for(const state of [
    {catalog:{data:[paid]}},
    {catalog:{data:[{...free,pricing:{input:0,output:0.01}}]}},
    {usage:{free_tokens:{remaining:0,limit_per_day:8000000}}},
    {usage:{}}
  ]){
    const mocked=mocks(state);
    await assert.rejects(
      callXkiroFree({env,messages:[{role:"user",content:"hello"}],fetcher:mocked.fetcher})
    );
    assert.equal(mocked.requests.some(r=>r.url.endsWith("/chat/completions")),false);
  }
});

test("AI off never sends any GET or POST to xKiro",async()=>{
  let called=0;
  await assert.rejects(generateOnlineReply({
    prompt:"hello",env:{...env,SHUVI_AI_CALLS_ENABLED:"false"},
    fetcher:async()=>{called++;throw Error("Should never hit xKiro");}
  }));
  assert.equal(called,0);
});
