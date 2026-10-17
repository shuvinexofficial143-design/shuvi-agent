import {observedWindowInventory,normalizedProcessStartTicks} from "./native-window-target-guard.mjs";

// WindowObservation v1: read-only evidence correlated with one Rust-audited
// ui_windows action. This is NOT an approval, capability or executable selector.
// Future consumers (Master, native scheduler) must still enforce the exact
// owner-authorized native action and exclusive GUI mutation lease.
// Native action IDs are opaque. Production emits UUIDs, but the existing
// permitted test bridge uses short stable IDs (e.g. action-1). Provenance is
// established by verifiedExecutionReceipt at the caller, never by ID syntax.
const ACTION_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_WINDOW_OBSERVATION_AGE_MS=120_000;

/** @typedef {{title:string,process:string,pid:number,hwnd:number,app:string}} WindowIdentity */
/** @typedef {{version:1,sourceTool:"ui_windows",sourceActionId:string,observedAtMs:number,
 *   expiresAtMs:number,windows:ReadonlyArray<Readonly<WindowIdentity>>}} WindowObservation */

const APPLICATIONS=[
 ["premiere",/\bpremi(?:ere|re|er)\b/i],["blender",/\bblender\b/i],
 ["after-effects",/\bafter[\s-]?effects?\b/i],["photoshop",/\bphotoshop\b/i],
 ["illustrator",/\billustrator\b/i],["audition",/\baudition\b/i],
 ["animate",/\badobe[\s-]+animate\b/i]
];
function observedApp(process,title){
 // A process label takes precedence; a guessed app label NEVER grants authority.
 const matches=APPLICATIONS.filter(([,re])=>re.test(process)).map(([key])=>key);
 if(matches.length===1)return matches[0];
 const hints=APPLICATIONS.filter(([,re])=>re.test(title)).map(([key])=>key);
 return hints.length===1?"unverified:"+hints[0]:"unknown";
}
function goodTimestamp(n){return Number.isSafeInteger(n)&&n>=0;}

/**
 * Construct only after the *same native action ID* has a successful,
 * independently checked Rust execution receipt. No data is saved to disk,
 * forwarded to another task, or used as native consent.
 * @param {unknown} result
 * @param {string} actionId
 * @param {number} observedAtMs
 * @returns {WindowObservation|null}
 */
export function newAuditedWindowObservation(result,actionId,observedAtMs=Date.now()){
 if(typeof actionId!=="string"||!ACTION_ID.test(actionId)||!goodTimestamp(observedAtMs))return null;
 if(observedAtMs>Number.MAX_SAFE_INTEGER-MAX_WINDOW_OBSERVATION_AGE_MS)return null;
 const windows=observedWindowInventory(result,true);
 if(!Array.isArray(windows)||windows.length===0)return null;
 const seen=new Set();
 const identities=[];
 for(const window of windows){
  const {title,process,pid,hwnd,processStartTicks}=window;
  if(typeof title!=="string"||!title||typeof process!=="string"||
     !Number.isSafeInteger(pid)||pid<=0||
     !Number.isSafeInteger(hwnd)||hwnd<=0)return null;
  const key=String(hwnd);
  if(seen.has(key))return null; // inconsistent/duplicate HWND cannot ground any target
  seen.add(key);
  if(processStartTicks!==undefined&&normalizedProcessStartTicks(processStartTicks)===null)return null;
  identities.push(Object.freeze({title,process,pid,hwnd,
   ...(processStartTicks===undefined?{}:{processStartTicks}),
   app:observedApp(process,title)}));
 }
 return Object.freeze({
  version:1,sourceTool:"ui_windows",sourceActionId:actionId,
  observedAtMs,expiresAtMs:observedAtMs+MAX_WINDOW_OBSERVATION_AGE_MS,
  windows:Object.freeze(identities)
 });
}

/**
 * Empty rows mean no safe observed identity — invalid, stale or explicitly
 * invalidated. Callers distinguish "not yet observed" with Map.has(), never
 * by turning an invalid snapshot into the old null/native-matching fallback.
 * @param {WindowObservation|null|undefined} session
 * @param {number} nowMs
 * @returns {ReadonlyArray<Readonly<WindowIdentity>>}
 */
export function currentObservedWindows(session,nowMs=Date.now()){
 if(!session||session.version!==1||session.sourceTool!=="ui_windows"||
  typeof session.sourceActionId!=="string"||!ACTION_ID.test(session.sourceActionId)||
  !goodTimestamp(session.observedAtMs)||!goodTimestamp(session.expiresAtMs)||
  session.expiresAtMs-session.observedAtMs!==MAX_WINDOW_OBSERVATION_AGE_MS||
  !goodTimestamp(nowMs)||nowMs<session.observedAtMs||nowMs>=session.expiresAtMs||
  !Array.isArray(session.windows)||session.windows.length<1||session.windows.length>200)return [];
 // Keep the validated immutable identity in place; do not rehydrate names
 // from the model or from an older chat/thread.
 if(!session.windows.every(x=>x&&typeof x.title==="string"&&x.title.length>0&&
    Number.isSafeInteger(x.pid)&&x.pid>0&&Number.isSafeInteger(x.hwnd)&&x.hwnd>0&&
    (x.processStartTicks===undefined||normalizedProcessStartTicks(x.processStartTicks)!==null)))return [];
 return session.windows;
}
