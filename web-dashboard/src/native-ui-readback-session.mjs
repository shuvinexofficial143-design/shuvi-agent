import {currentObservedWindows} from "./native-window-observation-session.mjs";
import {observedControlIdentity,parseRuntimeId} from "./native-ui-control-session.mjs";
import {normalizedProcessStartTicks} from "./native-window-target-guard.mjs";
import {exactUiSelector} from "./native-observation-text.mjs";

// A native executed action is *not* proof of an intended UI effect.
// After a mutation, require independently audited, read-only UIA inspection
// in the same target window before preparing a second UI mutation.
const MUTATIONS=new Set(["ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse"]);
const READS=new Set(["ui_find","ui_discover"]);
const cleanTitle=t=>exactUiSelector(t)?t:"";
const findUnique=(rows,title)=>rows.filter(w=>w.title.toLocaleLowerCase("en-US")===title.toLocaleLowerCase("en-US"));

export function needsUiReadback(tool){return MUTATIONS.has(tool);}
export function newPendingUiReadback(actionId,proposal,windowSession,nowMs=Date.now(),controlSnapshot=null){
 if(!needsUiReadback(proposal?.tool)||typeof actionId!=="string"||!actionId||
  !Number.isSafeInteger(nowMs)||nowMs<0)return null;
 const title=cleanTitle(proposal?.arguments?.window);
 const rawName=proposal?.arguments?.name,rawId=proposal?.arguments?.automation_id;
 const malformedSelector=(rawName!=null&&rawName!==""&&!exactUiSelector(rawName))||
  (rawId!=null&&rawId!==""&&!exactUiSelector(rawId));
 const controlName=exactUiSelector(rawName)?rawName:"";
 const automationId=exactUiSelector(rawId)?rawId:"";
 // When a prior audited ui_discover established a native RuntimeId,
 // a same-label replacement control must never clear post-action readback.
 const observedIdentity=observedControlIdentity(proposal,controlSnapshot,windowSession,nowMs);
 const controlSourceActionId=controlSnapshot?.sourceActionId??null;
 // Snapshot the owner's intended value only for private, in-memory readback.
 // A native executed receipt does not show that the same value survived.
 const rawExpectedValue=proposal?.tool==="ui_set_value"?proposal?.arguments?.value:null;
 const expectedValue=typeof rawExpectedValue==="string"&&rawExpectedValue.length<=4096
  ?rawExpectedValue:null;
 const controlRuntimeId=observedIdentity?.runtimeId??null;
 const controlType=observedIdentity?.controlType??null;
 // Bind the readback to the exact control originally mutated, not merely
 // any control in a later refreshed window inventory.
 // No truthful HWND/PID means do not invent readback evidence.
 const rows=currentObservedWindows(windowSession,nowMs);
 const matching=title&&!malformedSelector?findUnique(rows,title):[];
 const windowSourceActionId=windowSession?.sourceActionId??null;
 if(matching.length!==1)return Object.freeze({version:1,sourceActionId:actionId,
  windowSourceActionId,controlSourceActionId,
  title:title||"",hwnd:null,pid:null,processStartTicks:null,controlName,automationId,controlRuntimeId,controlType,
  mutationTool:proposal.tool,expectedExpansion:proposal?.arguments?.action??null,expectedValue,
  observedAtMs:nowMs,readbackRequired:true});
 return Object.freeze({version:1,sourceActionId:actionId,windowSourceActionId,controlSourceActionId,title:matching[0].title,
  hwnd:matching[0].hwnd,pid:matching[0].pid,
  processStartTicks:matching[0].processStartTicks??null,
  controlName,automationId,controlRuntimeId,controlType,
  mutationTool:proposal.tool,expectedExpansion:proposal?.arguments?.action??null,expectedValue,
  observedAtMs:nowMs,readbackRequired:true});
}

export function checkPendingUiReadback(proposal,pending){
 if(!pending||pending.readbackRequired!==true||!MUTATIONS.has(proposal?.tool))
  return {allowed:true,reason:"no_queued_second_mutation"};
 return {allowed:false,reason:"Prior UI mutation has no fresh audited UIA readback. Request ui_windows then ui_discover or ui_find, with separate owner approval."};
}

// A window listing does not show control state. This function only clears
// the "no independent UIA read" condition; it NEVER certifies intended effect.
export function auditUiReadback(pending,proposal,result,windowSession,nowMs=Date.now(),readActionId=null){
 if(!pending)return null;
 // In production the caller provides a separately Rust-audited readActionId.
 // The previous UIA mutation MUST be followed by a different independently
 // audited ui_windows invocation and then a new ui_find/ui_discover action.
 // This is an extra provenance barrier beyond the dashboard invalidation.
 if(readActionId!==null){
  if(typeof readActionId!=="string"||!readActionId||readActionId===pending.sourceActionId||
     readActionId===pending.controlSourceActionId||
     typeof pending.windowSourceActionId!=="string"||!pending.windowSourceActionId||
     !windowSession||windowSession.sourceTool!=="ui_windows"||
     windowSession.sourceActionId===pending.windowSourceActionId||
     windowSession.sourceActionId===pending.sourceActionId||
     windowSession.sourceActionId===readActionId||
     !Number.isSafeInteger(windowSession.observedAtMs)||
     windowSession.observedAtMs<pending.observedAtMs||
     !Number.isSafeInteger(nowMs)||nowMs<windowSession.observedAtMs)
   return pending;
 }
 if(!READS.has(proposal?.tool)||result?.tool!==proposal.tool||
  result?.success!==true||(result.exit_code!=null&&result.exit_code!==0))return pending;
 const title=cleanTitle(proposal?.arguments?.window);
 if(!title||title.toLocaleLowerCase("en-US")!==pending.title.toLocaleLowerCase("en-US")||
  !Number.isSafeInteger(pending.hwnd)||!Number.isSafeInteger(pending.pid))return pending;
 const matches=findUnique(currentObservedWindows(windowSession,nowMs),title);
 if(matches.length!==1||matches[0].hwnd!==pending.hwnd||matches[0].pid!==pending.pid||
  (pending.processStartTicks!=null&&
   matches[0].processStartTicks!==pending.processStartTicks))return pending;
 // No empty/unparseable read is evidence. Do not count a model assertion.
 if(typeof result.stdout!=="string"||!result.stdout.trim()||
  result.stdout.length>250_000)return pending;
 try{
  const parsed=JSON.parse(result.stdout);
  // Real Windows ui_find pipes one selected object to ConvertTo-Json,
  // whereas ui_discover serializes @($items) as an array. Only ui_find
  // may supply the single-object form; this must not weaken other reads.
  const rows=proposal.tool==="ui_find"&&!Array.isArray(parsed)?[parsed]:parsed;
  if(!Array.isArray(rows)||rows.length<1||rows.length>160)return pending;
  if(!rows.every(x=>x&&typeof x==="object"&&!Array.isArray(x)&&
   ((typeof x.Name==="string"&&x.Name.trim())||
    (typeof x.AutomationId==="string"&&x.AutomationId.trim()))))return pending;
  // A prior window listing alone cannot prove the *fresh* read ran in the
  // original app. Require the native root HWND/PID attached to every row
  // of this separately audited UIA read. A same-title replacement is unsafe.
  if(!rows.every(x=>Number.isSafeInteger(x.ObservedWindowHwnd)&&
   Number.isSafeInteger(x.ObservedWindowPid)&&
   x.ObservedWindowHwnd===pending.hwnd&&
   x.ObservedWindowPid===pending.pid&&
   (pending.processStartTicks==null||
    normalizedProcessStartTicks(x.ObservedWindowProcessStartTicks)===pending.processStartTicks)&&
   (x.ObservedWindowProcessStartTicks==null||
    normalizedProcessStartTicks(x.ObservedWindowProcessStartTicks)!==null)))return pending;
  // The read-only native UIA inventory must be internally coherent as a
  // whole. One unrelated malformed or duplicated native RuntimeId means
  // the provider observation is contradictory; never pick a convenient row
  // and unblock a subsequent mutation from partial evidence.
  const runtimeKeys=new Set();
  for(const row of rows){
   if(row.ControlType!=null&&
      (typeof row.ControlType!=="string"||!row.ControlType||
       row.ControlType.length>100))return pending;
   if(row.IsEnabled!=null&&typeof row.IsEnabled!=="boolean")return pending;
   if(row.IsOffscreen!=null&&typeof row.IsOffscreen!=="boolean")return pending;
   if(row.ControlRuntimeId!=null){
    const rid=parseRuntimeId(row.ControlRuntimeId);
    if(!rid)return pending;
    const key=rid.join(",");
    if(runtimeKeys.has(key))return pending;
    runtimeKeys.add(key);
   }
  }
  // The verified new observation must contain the SAME unique control as
  // the previous mutation. A generic ui_discover showing unrelated buttons
  // cannot silently unlock a second mutation on a different UIA element.
  if(!pending.controlName&&!pending.automationId)return pending;
  const same=rows.filter(x=>
   (!pending.controlName||(typeof x.Name==="string"&&
    x.Name.toLocaleLowerCase("en-US")===pending.controlName.toLocaleLowerCase("en-US"))) &&
   (!pending.automationId||(typeof x.AutomationId==="string"&&
    x.AutomationId===pending.automationId)));
  if(same.length!==1)return pending;
  if(pending.controlRuntimeId){
   const actual=parseRuntimeId(same[0].ControlRuntimeId);
   if(!actual||actual.length!==pending.controlRuntimeId.length||
    actual.some((n,i)=>n!==pending.controlRuntimeId[i]))return pending;
  }
  if(same[0].IsEnabled!=null&&typeof same[0].IsEnabled!=="boolean")return pending;
  if(same[0].IsOffscreen!=null&&typeof same[0].IsOffscreen!=="boolean")return pending;
  if(same[0].ControlType!=null&&
     (typeof same[0].ControlType!=="string"||same[0].ControlType.length>100))return pending;
  // A provider may recycle an element reference under the same RuntimeId
  // and selector with a different semantic role. Exact role equality from
  // the original audited discovery is mandatory before the read can unlock.
  if(pending.controlType!=null&&same[0].ControlType!==pending.controlType)return pending;
  // Identity-only readback is insufficient after SetValue. Require native
  // ValuePattern value from a fresh separately audited exact UIA read.
  // A password/masked/unreadable field must remain unverified.
  if(pending.mutationTool==="ui_set_value"){
   if(typeof pending.expectedValue!=="string"||pending.expectedValue.length>4096||
      proposal.tool!=="ui_find")return pending;
   const row=same[0];
   if(typeof row.Value!=="string"||row.Value.length>4096||
      row.Value!==pending.expectedValue)return pending;
   if(Object.hasOwn(row,"CurrentValue")&&row.CurrentValue!==row.Value)return pending;
  }
  // For stateful actions, an independent read has to contain actual UIA
  // pattern-state evidence; a generic inventory can never prove that state.
  if(["ui_toggle","ui_expand_collapse","ui_focus","ui_scroll"].includes(pending.mutationTool)){
   if(proposal.tool!=="ui_find")return pending;
   const row=same[0];
   if(pending.mutationTool==="ui_toggle" &&
      !["On","Off","Indeterminate"].includes(row.ToggleState))return pending;
   if(pending.mutationTool==="ui_expand_collapse"){
    const expected=pending.expectedExpansion==="expand"?"Expanded":
     pending.expectedExpansion==="collapse"?"Collapsed":null;
    if(!expected||row.ExpandCollapseState!==expected)return pending;
   }
   // An owner approval itself can move focus to Shuvi. Require real native
   // focus-status evidence, not current focus=true as a permanent postcondition.
   if(pending.mutationTool==="ui_focus"&&typeof row.HasKeyboardFocus!=="boolean")return pending;
   if(pending.mutationTool==="ui_scroll"&&
      (typeof row.VerticalScrollPercent!=="number"||
       !Number.isFinite(row.VerticalScrollPercent)||
       row.VerticalScrollPercent<0||row.VerticalScrollPercent>100))return pending;
  }
  if(proposal.tool==="ui_find"){
   // ui_find is an exact selector read and must return exactly one control.
   if(rows.length!==1)return pending;
   const requestedName=proposal.arguments?.name;
   const requestedId=proposal.arguments?.automation_id;
   if((requestedName!=null&&requestedName!==""&&!exactUiSelector(requestedName))||
      (requestedId!=null&&requestedId!==""&&!exactUiSelector(requestedId))||
      (!requestedName&&!requestedId))return pending;
   if(!rows.every(x=>
     (!requestedName||(typeof x.Name==="string"&&
       x.Name.toLocaleLowerCase("en-US")===requestedName.toLocaleLowerCase("en-US"))) &&
     (!requestedId||(typeof x.AutomationId==="string"&&x.AutomationId===requestedId))))return pending;
  }
 }catch{return pending;}
 return null; // readback performed, not effect verified
}
