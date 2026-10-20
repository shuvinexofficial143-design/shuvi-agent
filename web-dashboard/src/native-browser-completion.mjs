// Narrow, independent proof for opening the YouTube HOME page in a managed
// browser. A browser launch receipt is never page-load verification. Both the
// launch and this CDP read must have separate exact Rust executed audits.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENGLISH=/^(?:(?:please\s+)?(?:open|launch|start)\s+youtube(?:\s+karo)?|youtube\s+(?:open|launch|start|kholo|khol\s*do|kholdo|open\s*karo))$/iu;
const HINDI=/^(?:यूट्यूब|यू\s*ट्यूब)\s+(?:खोलो|खोल\s*दो|ओपन\s*करो)$/u;
export function simpleYouTubeHomeGoal(goal){
 if(typeof goal!=="string"||goal.length>120)return false;
 const value=goal.trim().replace(/[.!?।]+$/u,"").trim();
 return ENGLISH.test(value)||HINDI.test(value);
}
function homeAddress(value){
 if(typeof value!=="string")return false;
 try{
  const url=new URL(value);
  return url.protocol==="https:"&&!url.username&&!url.password&&
   ["www.youtube.com","youtube.com"].includes(url.hostname)&&
   (url.port===""||url.port==="443")&&url.pathname==="/"&&
   !url.search&&!url.hash;
 }catch{return false;}
}
export function auditedYouTubeLaunch(goal,actionId,proposal,result){
 if(!simpleYouTubeHomeGoal(goal)||!UUID.test(actionId)||
  proposal?.tool!=="browser_start"||!homeAddress(proposal.arguments?.url)||
  !["edge","chrome"].includes(proposal.arguments?.browser)||
  result?.tool!=="browser_start"||result.success!==true||
  (result.exit_code!==null&&result.exit_code!==0)||typeof result.stdout!=="string")return null;
 const match=/^Started Shuvi-managed (edge|chrome) with root PID (\d+), local DevTools port \d+, and one bound page target\./.exec(result.stdout);
 const pid=match?Number(match[2]):0;
 if(!match||match[1]!==proposal.arguments.browser||!Number.isSafeInteger(pid)||pid<1||pid>4294967295)return null;
 return Object.freeze({pid,launchActionId:actionId});
}
export function youtubeReadbackProposal(proof){
 return proof?{tool:"browser_page_state",arguments:{pid:proof.pid}}:null;
}
export function verifiedYouTubeHome(goal,actionId,proposal,result,evidence,launchProof,audited){
 if(audited!==true||!simpleYouTubeHomeGoal(goal)||!launchProof||
   !UUID.test(actionId)||actionId===launchProof.launchActionId||
   proposal?.tool!=="browser_page_state"||
   Object.keys(proposal.arguments??{}).length!==1||
   proposal.arguments.pid!==launchProof.pid||
   result?.tool!=="browser_page_state"||result.success!==true||
   (result.exit_code!==null&&result.exit_code!==0)||
   typeof result.stdout!=="string"||result.stdout.length>4096||
   evidence?.lastTool!=="browser_page_state"||!evidence?.seenIds?.has(actionId)||
   !evidence.seenIds.has(launchProof.launchActionId))return null;
 const observations=evidence.observations??[];
 if(observations.length!==2||observations[0].id!==launchProof.launchActionId||
   observations[0].tool!=="browser_start"||observations[1].id!==actionId||
   observations[1].tool!=="browser_page_state")return null;
 let page;
 try{page=JSON.parse(result.stdout);}catch{return null;}
 if(!page||Array.isArray(page)||typeof page!=="object"||
   !["https://www.youtube.com","https://youtube.com"].includes(page.origin)||
   page.pathname!=="/"||page.readyState!=="complete"||
   typeof page.title!=="string"||page.title.length>160||
   !/youtube/i.test(page.title))return null;
 return Object.freeze({scope:"youtube_homepage",pid:launchProof.pid,
  origin:page.origin,launchActionId:launchProof.launchActionId,pageActionId:actionId});
}
