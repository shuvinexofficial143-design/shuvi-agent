import {createRemoteApi} from "../server/remote-api-core.mjs";
let handler;
export default async function remoteAgent(req,res) {
  try{handler??=createRemoteApi();return await handler("agent",req,res);}
  catch{res.statusCode=503;res.setHeader("Cache-Control","no-store");res.end(JSON.stringify({error:"remote_backend_unavailable"}));}
}
