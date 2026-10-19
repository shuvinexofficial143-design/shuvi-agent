// Shuvi 37: model-neutral terminal verification of a STRICTLY simple Premiere
// opening instruction in the packaged Shuvi native dashboard. This neither
// authorizes execution nor claims a project/edit/export/foreground outcome.
// A task with any additional operation is intentionally NOT recognized.
import {deriveMasterGoalContract,isSimpleNotepadLaunch} from "../../src/master-autonomy-contract.mjs";
import {windowGoalEvidence} from "./native-goal-evidence.mjs";

const ENGLISH=/^(?:(?:please\s+)?(?:open|launch|start)\s+(?:adobe\s+)?premi(?:ere|re|er)(?:\s+pro)?(?:\s+20\d{2})?|(?:adobe\s+)?premi(?:ere|re|er)(?:\s+pro)?(?:\s+20\d{2})?\s+(?:kholo|khol\s*do|kholdo|open|launch))$/iu;
const HINDI=/^(?:कृपया\s+)?(?:एडोबी\s+)?(?:प्रीमियर|प्रिमियर)(?:\s+प्रो)?(?:\s+20\d{2})?\s+(?:खोलो|खोल\s+दो)$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function strictlySimplePremiereOpening(objective){
 if(typeof objective!=="string"||!objective.trim()||objective.length>120)return false;
 const normalized=objective.trim().replace(/[.!?।]+\s*$/u,"").trim();
 if(!(ENGLISH.test(normalized)||HINDI.test(normalized)))return false;
 const g=deriveMasterGoalContract(objective);
 return !!g&&g.apps.length===1&&g.apps[0]==="premiere"&&g.opening&&
   !g.project&&!g.editing&&!g.exportFile;
}

export function strictlySimpleNotepadOpening(objective){
 if(!isSimpleNotepadLaunch(objective))return false;
 const g=deriveMasterGoalContract(objective);
 return !!g&&g.apps.length===1&&g.apps[0]==="notepad"&&g.opening&&
   !g.project&&!g.editing&&!g.exportFile;
}

// The evidence state is updated only after a successful exact Rust executed
// receipt. A window title, previous task, generic app detection, or provider
// sentence alone never fulfills these requirements.
export function verifiedSimplePremiereOpening(objective,actionId,result,evidence,audited){
 if(audited!==true||!strictlySimplePremiereOpening(objective)||
    !UUID.test(actionId)||result?.tool!=="ui_windows"||
    !Array.isArray(evidence?.observations)||evidence.observations.length<2)return null;
 const steps=evidence.observations;
 const last=steps.at(-1);
 if(last?.id!==actionId||last.tool!=="ui_windows"||
    evidence.lastTool!=="ui_windows"||!evidence.seenIds?.has(actionId))
    return null;
 // A dedicated launcher must have executed and been independently audited
 // BEFORE this exact distinct window-inspection action in this task.
 const launch=steps.filter(step=>step?.tool==="premiere_launch");
 if(launch.length!==1||!UUID.test(launch[0].id)||
    launch[0].id===actionId||steps.indexOf(launch[0])>=steps.length-1||
    !evidence.seenIds.has(launch[0].id))return null;
 const proof=windowGoalEvidence(objective,result,true);
 if(!proof||proof.app!=="premiere")return null;
 // A positive OS process name is mandatory here, not merely a plausible
 // title on an unrelated window. Never downgrade to title-only evidence.
 let rows;try{rows=JSON.parse(result.stdout);}catch{return null;}
 const matching=rows.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)&&
    row.NativeWindowHandle===proof.hwnd&&row.ProcessId===proof.pid&&
    typeof row.ProcessName==="string"&&/\bpremiere\b/i.test(row.ProcessName));
 if(matching.length!==1||!/\bpremiere\b/i.test(proof.title))return null;
 return Object.freeze({scope:"premiere_window",window:Object.freeze(proof),
    launchActionId:launch[0].id,windowActionId:actionId});
}

// Verified Notepad opening: requires audited launch_app followed by ui_windows
// with matching Notepad process identity and window handle
export function verifiedSimpleNotepadOpening(objective,actionId,result,evidence,audited){
 if(audited!==true||!strictlySimpleNotepadOpening(objective)||
    !UUID.test(actionId)||result?.tool!=="ui_windows"||
    !Array.isArray(evidence?.observations)||evidence.observations.length<2)return null;
 const steps=evidence.observations;
 const last=steps.at(-1);
 if(last?.id!==actionId||last.tool!=="ui_windows"||
    evidence.lastTool!=="ui_windows"||!evidence.seenIds?.has(actionId))
    return null;
 // A launch_app must have executed and been independently audited
 // BEFORE this exact distinct window-inspection action in this task.
 const launch=steps.filter(step=>step?.tool==="launch_app");
 if(launch.length!==1||!UUID.test(launch[0].id)||
    launch[0].id===actionId||steps.indexOf(launch[0])>=steps.length-1||
    !evidence.seenIds.has(launch[0].id))return null;
 const proof=windowGoalEvidence(objective,result,true);
 if(!proof||proof.app!=="notepad")return null;
 // A positive OS process name is mandatory here, not merely a plausible
 // title on an unrelated window. Never downgrade to title-only evidence.
 let rows;try{rows=JSON.parse(result.stdout);}catch{return null;}
 const matching=rows.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)&&
    row.NativeWindowHandle===proof.hwnd&&row.ProcessId===proof.pid&&
    typeof row.ProcessName==="string"&&/\bnotepad\b/i.test(row.ProcessName));
 if(matching.length!==1||!/\bnotepad\b/i.test(proof.title))return null;
 return Object.freeze({scope:"notepad_window",window:Object.freeze(proof),
    launchActionId:launch[0].id,windowActionId:actionId});
}

// Combined verification that handles both Premiere and Notepad
export function verifiedSimpleOpening(objective,actionId,result,evidence,audited){
 // Try Premiere first
 const premiereResult=verifiedSimplePremiereOpening(objective,actionId,result,evidence,audited);
 if(premiereResult)return premiereResult;
 // Try Notepad
 return verifiedSimpleNotepadOpening(objective,actionId,result,evidence,audited);
}
