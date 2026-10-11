import {createRemoteApi} from "../server/remote-api-core.mjs";
let handler;
export default async function remoteCommand(req,res) {
  // Never return secrets or model keys in a response.
  try{handler??=createRemoteApi();return await handler("user",req,res);}
  catch{res.statusCode=503;res.setHeader("Cache-Control","no-store");res.end(JSON.stringify({error:"remote_backend_unavailable"}));}
}
