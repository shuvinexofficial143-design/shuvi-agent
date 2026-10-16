import {currentObservedWindows} from "./native-window-observation-session.mjs";

// A native executed action is *not* proof of an intended UI effect.
// After a mutation, require independently audited, read-only UIA inspection
// in the same target window before preparing a second UI mutation.
const MUTATIONS=new Set(["ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse"]);
const READS=new Set(["ui_find","ui_discover"]);
const cleanTitle=t=>typeof t==="string"&&t.length>0&&t.length<=180?t.trim():"";
const findUnique=(rows,title)=>rows.filter(w=>w.title.toLocaleLowerCase("en-US")===title.toLocaleLowerCase("en-US"));

export function needsUiReadback(tool){return MUTATIONS.has(tool);}
export function newPendingUiReadback(actionId,proposal,windowSession,nowMs=Date.now()){
 if(!needsUiReadback(proposal?.tool)||typeof actionId!=="string"||!actionId||
  !Number.isSafeInteger(nowMs)||nowMs<0)return null;
 const title=cleanTitle(proposal?.arguments?.window);
 const controlName=typeof proposal?.arguments?.name==="string"?
  proposal.arguments.name.trim():"";
 const automationId=typeof proposal?.arguments?.automation_id==="string"?
  proposal.arguments.automation_id.trim():"";
 // Bind the readback to the exact control originally mutated, not merely
 // any control in a later refreshed window inventory.
 // No truthful HWND/PID means do not invent readback evidence.
 const rows=currentObservedWindows(windowSession,nowMs);
 const matching=title?findUnique(rows,title):[];
 if(matching.length!==1)return Object.freeze({version:1,sourceActionId:actionId,
  title:title||"",hwnd:null,pid:null,controlName,automationId,
  mutationTool:proposal.tool,expectedExpansion:proposal?.arguments?.action??null,
  observedAtMs:nowMs,readbackRequired:true});
 return Object.freeze({version:1,sourceActionId:actionId,title:matching[0].title,
  hwnd:matching[0].hwnd,pid:matching[0].pid,controlName,automationId,
  mutationTool:proposal.tool,expectedExpansion:proposal?.arguments?.action??null,
  observedAtMs:nowMs,readbackRequired:true});
}

export function checkPendingUiReadback(proposal,pending){
 if(!pending||pending.readbackRequired!==true||!MUTATIONS.has(proposal?.tool))
  return {allowed:true,reason:"no_queued_second_mutation"};
 return {allowed:false,reason:"Prior UI mutation has no fresh audited UIA readback. Request ui_windows then ui_discover or ui_find, with separate owner approval."};
}

// A window listing does not show control state. This function only clears
// the "no independent UIA read" condition; it NEVER certifies intended effect.
export function auditUiReadback(pending,proposal,result,windowSession,nowMs=Date.now()){
 if(!pending)return null;
 if(!READS.has(proposal?.tool)||result?.tool!==proposal.tool||
  result?.success!==true||(result.exit_code!=null&&result.exit_code!==0))return pending;
 const title=cleanTitle(proposal?.arguments?.window);
 if(!title||title.toLocaleLowerCase("en-US")!==pending.title.toLocaleLowerCase("en-US")||
  !Number.isSafeInteger(pending.hwnd)||!Number.isSafeInteger(pending.pid))return pending;
 const matches=findUnique(currentObservedWindows(windowSession,nowMs),title);
 if(matches.length!==1||matches[0].hwnd!==pending.hwnd||matches[0].pid!==pending.pid)return pending;
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
   x.ObservedWindowPid===pending.pid))return pending;
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
  if(same[0].IsEnabled!=null&&typeof same[0].IsEnabled!=="boolean")return pending;
  if(same[0].IsOffscreen!=null&&typeof same[0].IsOffscreen!=="boolean")return pending;
  if(same[0].ControlType!=null&&
     (typeof same[0].ControlType!=="string"||same[0].ControlType.length>100))return pending;
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
   if((typeof requestedName!=="string"||!requestedName.trim())&&
      (typeof requestedId!=="string"||!requestedId.trim()))return pending;
   if(!rows.every(x=>
     (!requestedName||(typeof x.Name==="string"&&
       x.Name.toLocaleLowerCase("en-US")===requestedName.toLocaleLowerCase("en-US"))) &&
     (!requestedId||(typeof x.AutomationId==="string"&&x.AutomationId===requestedId))))return pending;
  }
 }catch{return pending;}
 return null; // readback performed, not effect verified
}
