// A system open_url receipt is ONLY a launcher success, not a CDP-owned session.
import {observedWindowInventory} from "./native-window-target-guard.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN=/\b(?:open|launch|start|kholo|kholdo|khol\s*do|open\s*karo)\b|(?:खोलो|खोल\s*दो|ओपन\s*करो)/iu;
const MULTI=/\b(?:and|then|phir|aur|search|play|pause|download|type|write|click|edit|new\s+window)\b|(?:सर्च|चलाओ|रोक|लिखो|क्लिक)/iu;
export function simpleSystemWebOpening(goal,url){
 if(typeof goal!=="string"||goal.length>160||!OPEN.test(goal)||MULTI.test(goal))return false;
 try{
  const parsed=new URL(url);
  if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)return false;
  const key=parsed.hostname.toLowerCase().replace(/^www\./u,"").split(".")[0];
  return key.length>=3&&/^[a-z0-9-]+$/u.test(key)&&
   (new RegExp("(^|[^a-z0-9])"+key+"([^a-z0-9]|$)","iu").test(goal)||
    goal.includes(parsed.hostname)||goal.includes(url));
 }catch{return false;}
}
export function auditedSystemOpening(goal,actionId,proposal,result){
 if(!UUID.test(actionId)||proposal?.tool!=="open_url"||result?.tool!=="open_url"||
    result.success!==true||(result.exit_code!==null&&result.exit_code!==0)||
    !simpleSystemWebOpening(goal,proposal.arguments?.url))return null;
 const url=new URL(proposal.arguments.url);
 return Object.freeze({launchActionId:actionId,origin:url.origin,hostname:url.hostname,
  site:url.hostname.toLowerCase().replace(/^www\./u,"").split(".")[0]});
}
export const systemOpeningReadback=proof=>proof?{tool:"ui_windows",arguments:{}}:null;
// Only an independently audited OS identity candidate; URL/page result is UNVERIFIED.
export function observeSystemOpening(proof,actionId,result,evidence){
 if(!proof||!UUID.test(actionId)||actionId===proof.launchActionId||
    result?.tool!=="ui_windows"||result.success!==true||
    (result.exit_code!==null&&result.exit_code!==0)||
    !evidence?.seenIds?.has(proof.launchActionId)||!evidence.seenIds.has(actionId))return null;
 const rows=observedWindowInventory(result,true);
 if(!Array.isArray(rows))return null;
 const matches=rows.filter(x=>typeof x.title==="string"&&
  new RegExp("(^|[^a-z0-9])"+proof.site+"([^a-z0-9]|$)","iu").test(x.title)&&
  typeof x.processStartTicks==="string"&&
  /^(?:msedge|chrome|firefox|msedgewebview2)(?:\.exe)?$/iu.test(x.process));
 return Object.freeze({kind:matches.length===1?"candidate":matches.length>1?"ambiguous":"not_observed",
  count:matches.length,hostname:proof.hostname,launchActionId:proof.launchActionId,
  inspectionActionId:actionId,goalVerified:false});
}
