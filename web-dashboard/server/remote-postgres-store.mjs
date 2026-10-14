/**
 * Durable CAS journal for dedicated Supabase PostgREST project.
 * NOT activated without server-only environment configuration.
 * No service key enters browser, native device, URL or telemetry.
 */
const SCOPE=/^[A-Za-z0-9_-]{16,96}:[A-Za-z0-9_-]{16,96}$/;
const timeout=6000;
function config(env) {
  const raw=env.SHUVI_REMOTE_DB_URL;
  const key=env.SHUVI_REMOTE_DB_SERVICE_KEY;
  if(typeof raw!=="string"||typeof key!=="string"||key.length<24)throw Error("remote_storage_unconfigured");
  let u;
  try{u=new URL(raw);}catch{throw Error("remote_storage_unconfigured");}
  // No private host/IP, no user-info, custom port or query SSRF destinations.
  if(u.protocol!=="https:"||!u.hostname.endsWith(".supabase.co")||u.username||
     u.password||u.port||u.search||u.hash||u.pathname!=="/")
     throw Error("invalid_remote_storage_origin");
  return {origin:u.origin,key};
}
async function request(settings,path,{method="GET",body,fetcher=fetch}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetcher(settings.origin+path,{
      method,redirect:"error",signal:controller.signal,
      headers:{
        apikey:settings.key,
        Authorization:"Bearer "+settings.key,
        Accept:"application/json",
        "Content-Type":"application/json",
        ...(method==="GET"?{}:{Prefer:"return=representation"})
      },
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    if(!response.ok)throw Error("remote_storage_unavailable");
    return await response.json();
  } catch {throw Error("remote_storage_unavailable");}
  finally {clearTimeout(timer);}
}
export function createRemotePostgresStore({env=process.env,fetcher=fetch}={}) {
  const settings=config(env);
  async function transact(scope,fn) {
    if(typeof scope!=="string"||!SCOPE.test(scope))throw Error("invalid_remote_scope");
    // A CAS rejection is a concurrent writer, not a failed command. Re-evaluate
    // fn against the latest snapshot; fn MUST remain deterministic and side-effect-free.
    for(let attempt=0;attempt<6;attempt++){
      const path="/rest/v1/shuvi_remote_journals?scope=eq."+encodeURIComponent(scope)+"&select=revision,state";
      const rows=await request(settings,path,{fetcher});
      if(!Array.isArray(rows)||rows.length>1)throw Error("invalid_remote_journal_response");
      const revision=rows.length?Number(rows[0].revision):0;
      if(!Number.isSafeInteger(revision)||revision<0)throw Error("invalid_remote_journal_revision");
      const previous=rows.length?rows[0].state:null;
      const {next,result}=fn(previous);
      const updated=await request(settings,"/rest/v1/rpc/shuvi_remote_cas",{
        method:"POST",fetcher,
        body:{p_scope:scope,p_expected:revision,p_state:next}
      });
      if(updated===true)return result;
      if(updated!==false)throw Error("invalid_remote_cas_response");
    }
    throw Error("remote_journal_contention");
  }
  return Object.freeze({transact});
}
