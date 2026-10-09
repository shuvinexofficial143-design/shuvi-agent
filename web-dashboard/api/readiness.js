import {evaluateReadiness} from "../server/readiness.mjs";
import {httpJson} from "../server/online-core.mjs";

/** Safe, read-only configuration preflight; never reveals credentials. */
export default function handler(req,res) {
  if(req.method!=="GET")return httpJson(res,405,{error:"Method not allowed"});
  return httpJson(res,200,evaluateReadiness(process.env));
}
