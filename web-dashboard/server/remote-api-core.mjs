import {createHash,timingSafeEqual} from "node:crypto";
import {createRemoteCoordinator} from "./remote-coordinator.mjs";
import {createRemotePostgresStore} from "./remote-postgres-store.mjs";

const validId=s=>typeof s==="string"&&/^[A-Za-z0-9_-]{16,96}$/.test(s);
const hashHex=s=>createHash("sha256").update(s,"utf8").digest("hex");
const cap=(s,max)=>typeof s==="string"&&s.length<=max;
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"
};
function result(res,status,data) {
  res.statusCode=status;
  for(const [key,val] of Object.entries(headers))res.setHeader(key,val);
  res.end(JSON.stringify(data));
}
function authorizer(env) {
  const ownerId=env.SHUVI_REMOTE_OWNER_ID,deviceId=env.SHUVI_REMOTE_DEVICE_ID;
  const ownerHash=env.SHUVI_REMOTE_OWNER_KEY_SHA256,deviceHash=env.SHUVI_REMOTE_AGENT_KEY_SHA256;
  if(!validId(ownerId)||!validId(deviceId)||
     !/^[a-f0-9]{64}$/.test(ownerHash||"")||!/^[a-f0-9]{64}$/.test(deviceHash||""))
     throw Error("remote_auth_unconfigured");
  return {ownerId,deviceId,ownerHash,deviceHash};
}
function authenticate(req,settings,kind) {
  const auth=req.headers?.authorization;
  if(!cap(auth,180)||!auth?.startsWith("Bearer "))return false;
  const secret=auth.slice(7);
  // A weak user-generated password is not acceptable. Use 32 random bytes hex.
  if(!/^[a-fA-F0-9]{64}$/.test(secret))return false;
  const supplied=Buffer.from(hashHex(secret),"hex");
  const expected=Buffer.from(kind==="agent"?settings.deviceHash:settings.ownerHash,"hex");
  return timingSafeEqual(supplied,expected);
}
async function jsonBody(req) {
  // Vercel may populate req.body; fail on oversized/truncated data.
  if(req.headers?.["content-type"]?.split(";")[0]?.trim().toLowerCase()!=="application/json")
    throw Error("unsupported_content_type");
  const length=Number(req.headers?.["content-length"]||0);
  if(!Number.isSafeInteger(length)||length>9000)throw Error("invalid_body");
  if(req.body!==undefined) {
    const s=typeof req.body==="string"?req.body:JSON.stringify(req.body);
    if(s.length>9000)throw Error("invalid_body");
    return JSON.parse(s);
  }
  let data="";
  for await(const chunk of req) {
    data+=String(chunk);
    if(data.length>9000)throw Error("invalid_body");
  }
  return JSON.parse(data);
}
const allowedHostMethods={user:new Set(["GET","POST"]),agent:new Set(["GET","POST"])};
/**
 * Only inject store/env from the Vercel server. Verified principals are
 * created in this closure and recorded in a WeakSet. User data cannot mint them.
 */
export function createRemoteApi({env=process.env,store,clock=()=>Date.now()}={}) {
  const settings=authorizer(env);
  const durable=store??createRemotePostgresStore({env});
  const trusted=new WeakSet();
  const coord=createRemoteCoordinator({store:durable,clock,verifyActor:a=>trusted.has(a)});
  function actor(kind) {
    const a=Object.freeze({kind,ownerId:settings.ownerId,deviceId:settings.deviceId});
    trusted.add(a);return a;
  }
  return async function handler(kind,req,res) {
    if(kind!=="user"&&kind!=="agent")return result(res,404,{error:"unknown_route"});
    if(!allowedHostMethods[kind].has(req.method))return result(res,405,{error:"method_not_allowed"});
    if(!authenticate(req,settings,kind))return result(res,401,{error:"unauthorized"});
    try{
      const a=actor(kind);
      let operation;
      if(req.method==="GET")operation=kind==="user"?"describe":"poll";
      else {
        const data=await jsonBody(req);
        if(!data||typeof data!=="object"||Array.isArray(data))throw Error("invalid_body");
        operation=data.operation;
        if(kind==="agent") {
          if(operation!=="receipt")throw Error("invalid_operation");
          const value=await coord.recordReceipt(a,data.receipt);
          return result(res,value.ok?200:409,value);
        }
        if(operation==="submit"){
          const value=await coord.admit(a,data.message);
          return result(res,value.ok?202:409,value);
        }
        if(operation==="cancel"){
          const value=await coord.requestCancel(a,data.taskId);
          return result(res,value.ok?200:409,value);
        }
        if(operation==="decide"){
          const value=await coord.decide(a,data.decision);
          return result(res,value.ok?200:409,value);
        }
        throw Error("invalid_operation");
      }
      const value=operation==="poll"?await coord.poll(a):await coord.describe(a);
      return result(res,value.ok?200:409,value);
    }catch(e){
      const known=["invalid_body","invalid_operation","unsupported_content_type"].includes(e?.message);
      return result(res,known?400:503,{error:known?e.message:"remote_backend_unavailable"});
    }
  };
}
