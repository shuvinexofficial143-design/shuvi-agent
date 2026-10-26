import {currentObservedWindows} from "./native-window-observation-session.mjs";
import {exactUiSelector} from "./native-observation-text.mjs";
import {normalizedProcessStartTicks} from "./native-window-target-guard.mjs";

// Model-free P0/P1 recovery: independently inspect the SAME OS window and
// original UIA control after an audited mutation. These are proposals only:
// native preparation, task budget, owner approval and Rust audit still apply.
// Never replay the mutation or infer that the user's goal was completed.
// Preserve the existing audited Click/SendKeys planning and safety
// acceptance path. Start deterministic verification with bounded stateful
// actions whose postconditions Rust already inspects without replay.
const UI_MUTATIONS=new Set([
 "ui_set_value","ui_toggle","ui_expand_collapse","ui_focus","ui_scroll"
]);
const blocked=reason=>({blocked:reason});
const validId=id=>typeof id==="string"&&id.length>0&&id.length<=128;

/**
 * @returns {null|{proposal:{tool:string,arguments:object}}|{blocked:string}}
 * null means no outstanding UIA readback, not verified completion.
 */
export function nextAuditedUiMutationReadback(actionId,tool,pending,windows,nowMs=Date.now()){
 if(!pending||!UI_MUTATIONS.has(pending.mutationTool))return null;
 if(pending.readbackRequired!==true||!validId(actionId)||
    !validId(pending.sourceActionId)||!validId(pending.windowSourceActionId)||
    !UI_MUTATIONS.has(pending.mutationTool)||
    !Number.isSafeInteger(nowMs)||nowMs<0||
    !Number.isSafeInteger(pending.observedAtMs)||nowMs<pending.observedAtMs)
  return blocked("पिछली UI जाँच की पहचान अधूरी है। आगे का काम रोका गया है।");
 // Readback is meaningful only against a pre-mutation, Rust-audited window.
 if(!exactUiSelector(pending.title,180)||
    !Number.isSafeInteger(pending.hwnd)||pending.hwnd<=0||
    !Number.isSafeInteger(pending.pid)||pending.pid<=0||
    normalizedProcessStartTicks(pending.processStartTicks)===null||
    (!exactUiSelector(pending.controlName,180)&&
     !exactUiSelector(pending.automationId,180)))
  return blocked("मूल Window या Control की सुरक्षित पहचान नहीं मिली। नया निरीक्षण आवश्यक है।");
 if(actionId===pending.sourceActionId&&tool===pending.mutationTool){
  // A new native action UUID and explicit owner approval are mandatory.
  return {proposal:{tool:"ui_windows",arguments:{}}};
 }
 if(tool==="ui_windows"){
  if(!windows||windows.sourceTool!=="ui_windows"||
     windows.sourceActionId!==actionId||
     actionId===pending.sourceActionId||
     actionId===pending.windowSourceActionId||
     windows.observedAtMs<pending.observedAtMs)
   return blocked("UI परिवर्तन के बाद की अलग Windows जाँच सत्यापित नहीं हुई।");
  const matching=currentObservedWindows(windows,nowMs).filter(w=>
   w.title===pending.title&&w.hwnd===pending.hwnd&&w.pid===pending.pid&&
   w.processStartTicks===pending.processStartTicks);
  if(matching.length!==1)
   return blocked("App की पुरानी Window बदल गई है या स्पष्ट नहीं है। अनुमान से Control नहीं चुनूँगी।");
  const args={window:pending.title};
  if(exactUiSelector(pending.controlName,180))args.name=pending.controlName;
  if(exactUiSelector(pending.automationId,180))args.automation_id=pending.automationId;
  return {proposal:{tool:"ui_find",arguments:args}};
 }
 // An independently audited ui_find/discover that cannot clear the pending
 // identity gate MUST NOT fall through to paid planning or another edit.
 return blocked("मूल Control की नई Readback अभी सत्यापित नहीं हुई। आगे का बदलाव रोका गया है।");
}
