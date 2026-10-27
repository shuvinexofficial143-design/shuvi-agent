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

  // BUG-023: these relay components exist in source, but a cloud
  // preflight can only check server-only CONFIGURATION SHAPE, never prove
  // authentication, installed Windows connectivity or action E2E.
  const validId=s=>typeof s==="string"&&/^[A-Za-z0-9_-]{16,96}$/.test(s);
  const validHash=s=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
  const remoteAuth=validId(env.SHUVI_REMOTE_OWNER_ID)&&validId(env.SHUVI_REMOTE_DEVICE_ID)&&
    validHash(env.SHUVI_REMOTE_OWNER_KEY_SHA256)&&validHash(env.SHUVI_REMOTE_AGENT_KEY_SHA256);
  let remoteStorage=false;
  try{
    const u=new URL(env.SHUVI_REMOTE_DB_URL||"");
    remoteStorage=u.protocol==="https:"&&u.hostname.endsWith(".supabase.co")&&
      u.username===""&&u.password===""&&u.port===""&&u.search===""&&
      u.hash===""&&u.pathname==="/"&&
      typeof env.SHUVI_REMOTE_DB_SERVICE_KEY==="string"&&env.SHUVI_REMOTE_DB_SERVICE_KEY.length>=24;
  }catch{}
  const remoteConfigured=remoteAuth&&remoteStorage;
  const remoteStatus=remoteConfigured?"configured_unverified":"source_implemented_configuration_unverified";
  const features=[
    {id:"dashboard",name:"Web dashboard",status:"source_ready",next:"Open the production website and test on desktop/mobile."},
    {id:"drafts",name:"Local Chat and task drafts",status:"source_ready",next:"Browser-only storage; cross-device sync is not implemented."},
    {id:"cloud_chat",name:"Online AI conversation",status:chatConfigReady?"configured_unverified":"blocked",
      next:chatConfigReady?"Send one authorized chat message and verify a real provider reply.":
        "Requires an enabled model, server-only API key, owner access key and persistent chat quota storage."},
    {id:"master",name:"Native Master and specialist execution",status:"source_implemented_configuration_unverified",
      next:"Native Windows dispatcher exists in source. Cloud preflight cannot prove installed host access, approvals or owner Windows E2E."},
    {id:"cloud_queue",name:"Persistent cross-device task queue",status:remoteStatus,
      next:remoteConfigured?"Remote store/auth configuration shape present; independently test an authenticated durable CAS transaction.":
        "Relay and durable CAS exist in source; server-only owner/device hashes and permitted Supabase storage are not all configured."},
    {id:"native_bridge",name:"Authenticated cloud-to-Windows outbound relay",status:remoteStatus,
      next:remoteConfigured?"Remote relay configuration appears present; Windows agent pairing, live poll and owner mobile approval remain UNVERIFIED.":
        "Source implemented. Configure authenticated remote relay plus durable storage, then verify device pairing and native audit."},
    {id:"adobe_blender",name:"Premiere/Blender real operations",status:"live_test_pending",
      next:"Only test after the Windows host is online and a native integration is paired."}
  ];
  return {
    mode:"read_only_preflight",
    noProviderRequestsMade:true,
    readyForDirectRemoteExecution:false,
    cloudAIConfigurationReady:chatConfigReady,
    remoteRelayConfigurationPresent:remoteConfigured,
    remoteAgentLiveVerified:false,
    remoteOwnerApprovalLiveVerified:false,
    missingRemoteSettings:[
      ...(!remoteAuth?["SHUVI_REMOTE_OWNER_ID / SHUVI_REMOTE_DEVICE_ID / SHUVI_REMOTE_OWNER_KEY_SHA256 / SHUVI_REMOTE_AGENT_KEY_SHA256"]:[]),
      ...(!remoteStorage?["SHUVI_REMOTE_DB_URL / SHUVI_REMOTE_DB_SERVICE_KEY"]:[])
    ],
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
