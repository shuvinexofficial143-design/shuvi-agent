import {cleanObservedLabel} from "./native-observation-text.mjs";
// Window-level completion evidence, NOT proof of project/file/editor outcomes.
// Only a fresh, exact-audited ui_windows action can confirm an application.
// A project dialog or launched process cannot complete the user's original goal.
const knownApps=[
 ["premiere",/\bpremi(?:ere|re|er)\b|प्रीमियर|प्रिमियर/iu,/\bpremiere\b/i],
 ["photoshop",/\bphotoshop\b|फोटोशॉप/iu,/\bphotoshop\b/i],
 ["after-effects",/\bafter[\s-]?effects?\b|आफ्टर इफेक्ट/iu,/\bafter[\s-]?effects?\b/i],
 ["blender",/\bblender\b|ब्लेंडर/iu,/\bblender\b/i],
 ["illustrator",/\billustrator\b|इलस्ट्रेटर/iu,/\billustrator\b/i],
 ["audition",/\baudition\b|ऑडिशन/iu,/\baudition\b/i],
 ["media-encoder",/\bmedia[\s-]?encoder\b|मीडिया एनकोडर/iu,/\bmedia[\s-]?encoder\b/i],
 ["animate",/\badobe[\s-]+animate\b|एडोबी एनिमेट/iu,/\badobe[\s-]+animate\b/i],
 ["character-animator",/\bcharacter[\s-]?animator\b|कैरेक्टर एनिमेटर/iu,/\bcharacter[\s-]?animator\b/i],
 ["substance-3d",/\bsubstance[\s-]?3d\b|सब्सटेंस/iu,/\bsubstance[\s-]?3d\b/i],
 ["frameio",/\bframe\.?io\b|फ्रेम डॉट आईओ/iu,/\bframe\.?io\b/i]
];
export function windowGoalEvidence(objective,result,hasExactAudit){
 if(hasExactAudit!==true||result?.success!==true||result.tool!=="ui_windows"||
  typeof result.stdout!=="string"||result.stdout.length>250000||typeof objective!=="string")return null;
 const candidates=knownApps.filter(([,expr])=>expr.test(objective.slice(0,2500)));
 if(candidates.length!==1)return null;
 let rows;
 try{rows=JSON.parse(result.stdout);}catch{return null;}
 if(!Array.isArray(rows)||rows.length===0||rows.length>200)return null;
 const [app,,match]=candidates[0];
 const selected=rows.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)&&
  (typeof row.Name==="string"&&match.test(row.Name)||
   typeof row.ProcessName==="string"&&match.test(row.ProcessName)));
 if(selected.length!==1)return null;
 const row=selected[0];
 // A matching title can be misleading if process identity names another app.
 // A title itself naming a different known app cannot become proof merely
 // because another field claims the requested app process.
 if(knownApps.some(([id,,matcher])=>id!==app&&matcher.test(row.Name)))return null;
 const process=typeof row.ProcessName==="string"?row.ProcessName:"";
 // When the OS supplies a process identity, it must positively match
 // the requested app; a spoofed title on an unrelated process is not proof.
 if(process&&(!match.test(process)||knownApps.some(([id,,matcher])=>id!==app&&matcher.test(process))))return null;
 // A reused native handle with contradictory process/title cannot verify
 // a unique live app, even if exactly one title matches the requested app.
 if(rows.some(other=>other!==row&&other&&
  other.NativeWindowHandle===row.NativeWindowHandle&&
  (other.ProcessId!==row.ProcessId||other.Name!==row.Name)))return null;
 if(typeof row.Name!=="string"||!row.Name.trim()||
  !Number.isSafeInteger(row.ProcessId)||row.ProcessId<=0||
  !Number.isSafeInteger(row.NativeWindowHandle)||row.NativeWindowHandle<=0)
  return null;
 const safeTitle=cleanObservedLabel(row.Name,140);
 if(!safeTitle)return null;
 return {app,title:safeTitle,pid:row.ProcessId,hwnd:row.NativeWindowHandle};
}
export function goalEvidenceLabel(request,verifiedWindow){
 if(!verifiedWindow)return "Original goal checks remain unverified; inspect the actual application.";
 return "Observed live "+verifiedWindow.app+" window: "+verifiedWindow.title+
  " (PID "+verifiedWindow.pid+"). Only WINDOW existence independently verified; "+
  "project, edits, import, export and other requested outcomes remain UNVERIFIED.";
}
