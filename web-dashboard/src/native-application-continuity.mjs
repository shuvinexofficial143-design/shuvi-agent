import {newAuditedWindowObservation,currentObservedWindows} from "./native-window-observation-session.mjs";

// A hint registry, never a capability, approval, task checkpoint or execution
// receipt. Every cross-goal reuse is preceded by a NEW approved Rust readback.
const MAX_AGE=10*60*1000;
const BROWSER_START=/^Started Shuvi-managed (edge|chrome) with root PID (\d+), local DevTools port \d+, and one bound page target\./;
const EXPLICIT_NEW=/\b(?:new|another|separate|fresh)\s+(?:(?:edge|chrome|firefox)\s+)?(?:browser|window|tab|instance|session)\b|\b(?:naya|nayi|alag|dusra|doosra)\s+(?:(?:edge|chrome|firefox)\s+)?(?:browser|window|tab|app|session)\b|(?:नई|नयी|अलग|दूसरी)\s+(?:विंडो|टैब|ऐप)/iu;
const BROWSER_NAMES=/\b(edge|chrome|firefox)\b/iu;
const SAME_CONTEXT=/\b(?:same|previous|current|existing|usi|usme|usmein|wahi|wahin)\b|\b(?:उसी|उसमें|वहीं|पहले वाले|मौजूदा)\b/iu;
const APP_ALIASES=[
 ["notepad",/\bnotepad\b|नोटपैड/iu],
 ["premiere",/\bpremiere(?:\s+pro)?\b/iu],
 ["blender",/\bblender\b/iu],
 ["afterfx",/\bafter[\s-]?effects?\b/iu],
 ["photoshop",/\bphotoshop\b/iu],
 ["illustrator",/\billustrator\b/iu],
 ["audition",/\baudition\b/iu]
];
const COMMAND_WORDS=new Set(["open","launch","write","text","type","search","click","project","window","same","previous","current","browser","please","karo","kholo","kholna","likho","mein","start","file","new","create","edit","karna"]);
const exactPid=x=>Number.isSafeInteger(x)&&x>0&&x<=4294967295;
const processKey=s=>typeof s==="string"?s.toLowerCase().replace(/\.exe$/iu,"").replace(/[^a-z0-9]+/gu,""):"";
const hostKey=origin=>{
 try{return new URL(origin).hostname.toLowerCase().replace(/^www\./u,"").split(".")[0]||"";}catch{return "";}
};
function mentionsWebsite(request,origin){
 const key=hostKey(origin);
 return key.length>=3&&new RegExp(`(^|[^a-z0-9])${key.replace(/[^a-z0-9]/gu,"")}([^a-z0-9]|$)`,"iu").test(request);
}
function validTime(now,at){return Number.isSafeInteger(now)&&Number.isSafeInteger(at)&&now>=at&&now-at<MAX_AGE;}
export function newApplicationContinuity(){return {browsers:new Map(),windows:[],windowObservedAt:0,systemUrls:[]};}

/** Caller MUST first match a successful Rust executed audit to this action. */
export function recordAuditedApplication(registry,proposal,result,actionId,now=Date.now()){
 if(!registry||result?.success!==true||result?.tool!==proposal?.tool||
    (result.exit_code!==null&&result.exit_code!==0)||typeof actionId!=="string"||!actionId||
    !Number.isSafeInteger(now)||now<=0)return false;
 const args=proposal.arguments??{};
 if(result.tool==="open_url"){
  // explorer launcher PID is NEVER stored as browser ownership/CDP target.
  try{
   const url=new URL(args.url);
   if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return false;
   registry.systemUrls=[...(registry.systemUrls??[]).filter(x=>validTime(now,x.observedAt)),
    {origin:url.origin,site:hostKey(url.origin),observedAt:now,actionId}].slice(-12);
   return true;
  }catch{return false;}
 }
 if(result.tool==="browser_start"){
  const match=BROWSER_START.exec(result.stdout??"");
  const pid=Number(match?.[2]);
  if(!match||!exactPid(pid)||match[1]!==args.browser)return false;
  let origin="";
  if(args.url!==undefined){
   try{origin=new URL(args.url).origin;}catch{return false;}
   if(!/^https?:\/\//u.test(origin))return false;
  }
  registry.browsers.set(pid,{kind:"browser",pid,browser:match[1],origin,verified:false,
   actionId,observedAt:now});
  return true;
 }
 if(result.tool==="browser_page_state"){
  const current=registry.browsers.get(args.pid);
  if(!current||!validTime(now,current.observedAt)||typeof result.stdout!=="string"||result.stdout.length>8192)return false;
  let page;
  try{page=JSON.parse(result.stdout);}catch{return false;}
  if(typeof page?.origin!=="string"||!/^https?:\/\//u.test(page.origin)||
    typeof page.pathname!=="string"||typeof page.title!=="string"||
    !["interactive","complete"].includes(page.readyState))return false;
  registry.browsers.set(args.pid,{...current,origin:page.origin,verified:true,
   actionId,observedAt:now});
  return true;
 }
 if(result.tool==="ui_windows"){
  const observation=newAuditedWindowObservation(result,actionId,now);
  if(!observation)return false;
  registry.windows=currentObservedWindows(observation,now).map(x=>({...x}));
  registry.windowObservedAt=now;
  return true;
 }
 return false;
}

/** Ambiguity is intentionally explicit: never guess which PID/HWND to use. */
export function selectApplicationContinuity(registry,request,now=Date.now()){
 if(!registry||typeof request!=="string"||request.length>2500||EXPLICIT_NEW.test(request))return null;
 const browser= BROWSER_NAMES.exec(request)?.[1]?.toLowerCase()??null;
 const knownBrowsers=[...registry.browsers.values()].filter(x=>x.verified&&validTime(now,x.observedAt)&&
  (!browser||browser===x.browser));
 const browserCandidates=knownBrowsers.filter(x=>
  mentionsWebsite(request,x.origin));
 const apps=APP_ALIASES.filter(([,pattern])=>pattern.test(request)).map(([name])=>name);
 const knownWindows=validTime(now,registry.windowObservedAt)
  ?registry.windows.filter(x=>typeof x.processStartTicks==="string") : [];
 let desktop=apps.length===1
  ?knownWindows.filter(x=>processKey(x.process).includes(apps[0])||
    (apps[0]==="afterfx"&&/after.effects/iu.test(x.title))) : [];
 if(apps.length===0&&browserCandidates.length===0&&!SAME_CONTEXT.test(request)){
  const terms=request.toLowerCase().match(/[a-z0-9]{4,}/gu)?.filter(x=>!COMMAND_WORDS.has(x))??[];
  desktop=knownWindows.filter(x=>terms.some(term=>processKey(x.process).includes(term)));
 }
 // System URL hints never authorize CDP: a fresh Rust-audited OS inventory
 // is required and yields ONLY an OS/PWA window candidate.
 const systemSites=(registry.systemUrls??[]).filter(x=>validTime(now,x.observedAt)&&
  mentionsWebsite(request,x.origin));
 const systemWindows=knownWindows.filter(w=>
  systemSites.some(site=>site.site.length>=3&&
   new RegExp("(^|[^a-z0-9])"+site.site+"([^a-z0-9]|$)","iu").test(w.title))&&
  /^(?:msedge|chrome|firefox|msedgewebview2)(?:\.exe)?$/iu.test(w.process)&&
  typeof w.processStartTicks==="string");
 let candidates=[...browserCandidates,...desktop.map(x=>({kind:"window",...x,
  observedAt:registry.windowObservedAt})),...systemWindows.map(x=>({kind:"window",
  source:"system_browser_or_pwa",...x,observedAt:registry.windowObservedAt}))];
 candidates=candidates.filter((x,i)=>candidates.findIndex(y=>x.kind===y.kind&&
  x.pid===y.pid&&(x.kind==="browser"||x.hwnd===y.hwnd))===i);
 if(candidates.length===0&&SAME_CONTEXT.test(request)&&apps.length===0){
  const windows=knownWindows;
  candidates=[...knownBrowsers,...windows.map(x=>({kind:"window",...x,
   observedAt:registry.windowObservedAt}))];
 }
 if(candidates.length>1)return {kind:"ambiguous",count:candidates.length};
 return candidates[0]??null;
}

export function continuityReadback(candidate,proposal){
 if(!candidate||candidate.kind==="ambiguous"||!proposal||
    typeof proposal.tool!=="string")return null;
 if(candidate.kind==="browser"&&[
  "browser_start","browser_navigate","browser_dom_read","browser_dom_click","browser_dom_set_value"
 ].includes(proposal.tool)){
  // A readback is proposed instead of any unverified action. It is NOT run
  // until a new action ID and separate Allow once have been obtained.
  return {tool:"browser_page_state",arguments:{pid:candidate.pid}};
 }
 if(candidate.kind==="window"&&[
  "open_url","launch_app","premiere_launch","blender_session_start","photoshop_launch","after_effects_launch",
  "ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse",
  "ui_find","ui_discover","inspect_screen"
 ].includes(proposal.tool))return {tool:"ui_windows",arguments:{}};
 return null;
}

export function continuityHint(candidate){
 if(!candidate||candidate.kind==="ambiguous")return "";
 if(candidate.kind==="browser")return "Previously audited managed browser candidate: "+candidate.browser+
  " PID "+candidate.pid+" at "+candidate.origin+
  ". Its prior target belongs to Rust's managed session registry. Before ANY use, propose browser_page_state with that PID; only new Allow once plus fresh Rust audit and CDP readback can establish reuse. Do not browser_start for this site unless the user explicitly asks for a different session. No prior task or permission carries over.";
 return "Previously audited desktop window candidate: "+candidate.process+" PID "+candidate.pid+
  " HWND "+candidate.hwnd+" process-start "+(candidate.processStartTicks??"unavailable")+
  ". Before interacting propose ui_windows, require new Allow once and exact Rust audit, and match current PID/start/HWND to the observed identity. Do not relaunch a live matching window. If the identity is stale or ambiguous, ask the owner.";
}

export function checkConfirmedContinuity(candidate,proposal){
 if(!candidate||candidate.kind==="ambiguous"||!proposal)return {allowed:true,reason:"no_confirmed_session"};
 if(candidate.kind==="browser"){
  if(proposal.tool==="browser_start")return {allowed:false,reason:"A live browser session was freshly verified; opening another browser would break continuity."};
  if(["browser_navigate","browser_dom_read","browser_dom_click","browser_dom_set_value","browser_page_state"].includes(proposal.tool)&&
   proposal.arguments?.pid!==candidate.pid)return {allowed:false,reason:"Browser action PID differs from the freshly verified managed session."};
 }
 if(candidate.kind==="window"&&candidate.source==="system_browser_or_pwa"&&
  ["browser_start","browser_navigate","browser_dom_read","browser_dom_click",
   "browser_dom_set_value","browser_page_state"].includes(proposal.tool))
  return {allowed:false,reason:"Unmanaged OS browser/PWA is not Rust-owned CDP. No DevTools attach or browser PID adoption."};
 if(candidate.kind==="window"&&["open_url","launch_app","premiere_launch","blender_session_start","photoshop_launch","after_effects_launch"].includes(proposal.tool))
  return {allowed:false,reason:"A matching live desktop window was just verified; relaunch requires a new explicit owner request."};
 return {allowed:true,reason:"same_verified_session"};
}

export function confirmedContinuityHint(candidate){
 if(!candidate||candidate.kind==="ambiguous")return "";
 if(candidate.kind==="browser")return "This task already obtained an owner-approved, Rust-audited fresh CDP readback of managed "+
  candidate.browser+" PID "+candidate.pid+". Use that same PID for the next browser action. Do not launch a new browser or repeat the prior readback without a changed reason.";
 return (candidate.source==="system_browser_or_pwa"?
  "This is an OS-observed system browser/PWA, NOT a managed CDP target. Never use browser DOM tools or assert URL load. ":"")+
  "This task already obtained an owner-approved, Rust-audited fresh ui_windows observation confirming "+
  candidate.process+" PID "+candidate.pid+" HWND "+candidate.hwnd+". Continue with the exact observed window, and separately inspect controls and obtain Allow once for every mutation. Do not relaunch.";
}
