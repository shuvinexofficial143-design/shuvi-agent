/**
 * Shuvi test-readiness contract. Configuration presence != successful live test.
 * This module deliberately DOES NOT make provider calls or connect to Windows.
 */
export function evaluateReadiness(env={}) {
  const provider=env.SHUVI_CHAT_PROVIDER==="xkiro"?"xkiro":
    (!env.SHUVI_CHAT_PROVIDER||env.SHUVI_CHAT_PROVIDER==="openrouter")?"openrouter":"unsupported";
  const keyPresent=provider==="xkiro"
    ?typeof env.XKIRO_API_KEY==="string"&&env.XKIRO_API_KEY.length>0
    :provider==="openrouter"
      ?typeof env.OPENROUTER_API_KEY==="string"&&env.OPENROUTER_API_KEY.length>0
      :false;
  const modelPresent=provider==="xkiro"
    ?typeof env.XKIRO_CHAT_MODEL==="string" && env.XKIRO_CHAT_MODEL.trim().length>0
    :typeof env.SHUVI_CHAT_MODEL==="string" && env.SHUVI_CHAT_MODEL.trim().length>0;
  const owner=typeof env.SHUVI_OWNER_ACCESS_KEY==="string"&&env.SHUVI_OWNER_ACCESS_KEY.length>=32;
  let redisUrl=false;
  try{redisUrl=new URL(env.UPSTASH_REDIS_REST_URL||"").protocol==="https:";}catch{}
  const memory=redisUrl&&typeof env.UPSTASH_REDIS_REST_TOKEN==="string"&&
    env.UPSTASH_REDIS_REST_TOKEN.length>0;
  const enabled=env.SHUVI_AI_CALLS_ENABLED==="true";
  const chatConfigReady=enabled && keyPresent && modelPresent && owner && memory && provider!=="unsupported";

  const features=[
    {id:"dashboard",name:"Web dashboard",status:"source_ready",next:"Open the production website and test on desktop/mobile."},
    {id:"drafts",name:"Local Chat and task drafts",status:"source_ready",next:"Browser-only storage; cross-device sync is not implemented."},
    {id:"cloud_chat",name:"Online AI conversation",status:chatConfigReady?"configured_unverified":"blocked",
      next:chatConfigReady?"Send one authorized chat message and verify a real provider reply.":
        "Requires an enabled model, server-only API key, owner access key and persistent chat quota storage."},
    {id:"master",name:"Master and specialist execution",status:"not_implemented",
      next:"11 roles are a dry-run planner; a real dispatcher/worker queue is still needed."},
    {id:"cloud_queue",name:"Persistent cross-device task queue",status:"not_implemented",
      next:"Requires an authenticated persistent store and message/task APIs."},
    {id:"native_bridge",name:"Vercel to Windows control",status:"not_implemented",
      next:"An authenticated Windows outbound relay, approvals and live acceptance tests are required."},
    {id:"adobe_blender",name:"Premiere/Blender real operations",status:"live_test_pending",
      next:"Only test after the Windows host is online and a native integration is paired."}
  ];
  return {
    mode:"read_only_preflight",
    noProviderRequestsMade:true,
    readyForDirectRemoteExecution:false,
    cloudAIConfigurationReady:chatConfigReady,
    cloudAIReplyVerified:false,
    websiteDeploymentVerifiedByThisCheck:false,
    computerConnected:false,
    modelProvider:provider,
    missingCloudSettings:[
      ...(!enabled?["SHUVI_AI_CALLS_ENABLED"]:[]),
      ...(!keyPresent?[provider==="xkiro"?"XKIRO_API_KEY":"OPENROUTER_API_KEY"]:[]),
      ...(!modelPresent?[provider==="xkiro"?"XKIRO_CHAT_MODEL":"SHUVI_CHAT_MODEL"]:[]),
      ...(!owner?["SHUVI_OWNER_ACCESS_KEY"]:[]),
      ...(!memory?["UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN"]:[])
    ],
    features
  };
}
