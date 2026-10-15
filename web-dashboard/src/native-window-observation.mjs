import {observedWindowInventory} from "./native-window-target-guard.mjs";
// Only report windows accepted by the SAME strict parser used before staging.
// Malformed or mutually contradictory source data must not appear as a plausible
// window identity in the Master prompt while its execution gate rejects it.
export function summarizeWindowObservation(result,audited=false){
 if(!audited||result?.success!==true||result.tool!=="ui_windows")return "";
 const rows=observedWindowInventory(result,true);
 if(!Array.isArray(rows)||rows.length===0)
  return "Verified ui_windows provided no trustworthy unique window inventory. Inspect again; no target identity verified.";
 const found=rows.map(({title,process,pid,hwnd})=>({
  title:title.slice(0,120),process:process.slice(0,90),pid,hwnd
 }));
 const sample=found.slice(0,6).map(x=>JSON.stringify(x)).join("; ");
 return "Verified read-only window inventory: "+found.length+" usable window identity/identities"+
  (found.length>6?" (preview bounded)":"")+
  ". Observed sample: "+sample.slice(0,1250)+
  ". Window inventory is observation, NOT a selected target. "+
  "If multiple windows could match, request separate unique identity inspection or user clarification; "+
  "never pick the first matching window or invent a title. Every mutation needs separate Allow once.";
}
