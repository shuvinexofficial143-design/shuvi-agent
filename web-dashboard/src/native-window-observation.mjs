import {observedWindowInventory} from "./native-window-target-guard.mjs";
// Only report windows accepted by the SAME strict parser used before staging.
// Malformed or mutually contradictory source data must not appear as a plausible
// window identity in the Master prompt while its execution gate rejects it.
export function summarizeWindowObservation(result,audited=false){
 if(!audited||result?.success!==true||result.tool!=="ui_windows")return "";
 if(result.exit_code!=null&&(!Number.isSafeInteger(result.exit_code)||result.exit_code!==0))
  return "Window observation exit status invalid; no target identity verified.";
 if(typeof result.stdout!=="string"||result.stdout.length>250000)
  return "Window observation too large or unavailable (input bounded); no target identity verified.";
 let source;
 try{source=JSON.parse(result.stdout);}catch{
  return "Window observation unavailable or unparseable; no target identity verified.";
 }
 if(Array.isArray(source)&&source.length===0)
  return "Verified ui_windows returned no window identities; no target identity verified.";
 if(Array.isArray(source)&&source.length>200)
  return "Window observation input bounded (>200 native rows); no target identity verified.";
 const rows=observedWindowInventory(result,true);
 if(!Array.isArray(rows)||rows.length===0)
  return "Verified ui_windows provided no usable window identity: contradictory or malformed inventory. Inspect again; no target identity verified.";
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
