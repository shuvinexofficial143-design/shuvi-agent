import {cleanObservedLabel} from "./native-observation-text.mjs";
// A verified native window read restricts subsequent desktop mutations.
// Without prior read, trusted Rust window matching still applies.
const MUTATIONS=new Set(["ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse"]);
export function observedWindowInventory(result,audited){
 if(audited!==true||result?.success!==true||result.tool!=="ui_windows")return null;
 // Contradictory nonzero or malformed native exit status cannot ground targets.
 if(result.exit_code!=null&&(!Number.isSafeInteger(result.exit_code)||result.exit_code!==0))return [];
 // Oversized native output cannot authorize a later UI target choice.
 if(typeof result.stdout!=="string"||result.stdout.length>250000)return [];
 try{
  const rows=JSON.parse(result.stdout);
  if(!Array.isArray(rows)||!rows.length||rows.length>200)return [];
  return rows.filter(x=>x&&typeof x.Name==="string"&&x.Name.trim()&&
   Number.isSafeInteger(x.ProcessId)&&x.ProcessId>0&&
   Number.isSafeInteger(x.NativeWindowHandle)&&x.NativeWindowHandle>0)
   .map(x=>({title:cleanObservedLabel(x.Name,180),pid:x.ProcessId,hwnd:x.NativeWindowHandle}))
   .filter(x=>x.title.length>0);
 }catch{return [];}
}
export function checkObservedMutationTarget(proposal,observed){
 if(!MUTATIONS.has(proposal?.tool))return {allowed:true,reason:"not_ui_mutation"};
 if(observed===null||observed===undefined)return {allowed:true,reason:"native_matching_only"};
 if(!Array.isArray(observed)||!observed.length)
  return {allowed:false,reason:"Window observation missing or invalid; request ui_windows."};
 const title=proposal?.arguments?.window;
 if(typeof title==="string"&&cleanObservedLabel(title,180)!==title.trim())
  return {allowed:false,reason:"Proposed window title contains hidden or control formatting."};
 if(typeof title!=="string"||!title.trim()||title.length>180)
  return {allowed:false,reason:"Explicit verified target window required."};
 const exact=observed.filter(x=>x.title.toLocaleLowerCase("en-US")===title.trim().toLocaleLowerCase("en-US"));
 // Conflicting rows assigning the same handle to different names/processes
 // cannot establish a trustworthy unique application identity.
 if(exact.length===1&&observed.some(x=>x.hwnd===exact[0].hwnd&&
  (x.title!==exact[0].title||x.pid!==exact[0].pid)))
  return {allowed:false,reason:"Conflicting observed title/process for one window handle."};
 // Duplicate records for an apparently identical title are still ambiguous.
 const count=exact.length;
 return count===1?{allowed:true,reason:"unique_window"}:{allowed:false,
  reason:count===0?"Proposed window differs from audited observed application.":
  "Ambiguous observed window title; multiple handles share it."};
}


// Repeated read-only UI lookup on two windows sharing a verified exact title
// cannot identify a unique target. Avoid paid loops: ask for specificity.
export function checkAmbiguousReadWindow(proposal,observed){
 if(!["ui_find","ui_discover"].includes(proposal?.tool)||!Array.isArray(observed))
  return {allowed:true,reason:"native_lookup_required"};
 const target=proposal?.arguments?.window;
 if(typeof target!=="string"||!target.trim())return {allowed:true,reason:"native_lookup_required"};
 if(cleanObservedLabel(target,180)!==target.trim())
  return {allowed:false,reason:"Read-only window name contains hidden or control formatting."};
 const matches=observed.filter(x=>typeof x.title==="string"&&
  x.title.toLocaleLowerCase("en-US")===target.trim().toLocaleLowerCase("en-US"));
 if(matches.length===1&&observed.some(x=>x.hwnd===matches[0].hwnd&&
  (x.pid!==matches[0].pid||x.title!==matches[0].title)))
  return {allowed:false,reason:"Conflicting observed window-handle identity; inspect again."};
 // Repeated exact-title rows cannot uniquely identify one target.
 return matches.length>1?
  {allowed:false,reason:"Multiple audited windows have the same title. Ask which window or use a unique identity."}:
  {allowed:true,reason:"no_verified_title_ambiguity"};
}
