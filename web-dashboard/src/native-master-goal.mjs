// A bounded completion guide, not an action planner or authorization policy.
// The Master still receives the user's ORIGINAL text and all native tools
// require normal Rust prepare/approval/execution/audit handling.
const PREMIERE = /\b(?:premiere|premire|premier|premar)\b|प्रीमियर|प्रिमियर/iu;
const PROJECT = /\b(?:project|projeckt|projct)\b|प्रोजेक्ट|प्रोजेक्ट्/iu;
const CREATE = /\b(?:create|make|new|banao|banana|banado|bana|bnado|bnana)\b|बनाओ|बनाना|बनाकर|बना\s*दो|नया|नई/iu;
const EXPORT = /\b(?:export|render)\b|एक्सपोर्ट|रेंडर/iu;

// This is only additional model context. It must never claim that a tool ran,
// auto-approve an action, select a different paid provider, or confer evidence.
export function masterGoalContext(request) {
 const text=typeof request==="string"?request.slice(0,2500):"";
 const premiere=PREMIERE.test(text);
 const createProject=premiere&&PROJECT.test(text)&&CREATE.test(text);
 const exportRequested=premiere&&EXPORT.test(text);
 let specific="";
 if(createProject){
  specific=" Premiere project creation is an END GOAL, not a launch step: create a NEW project with the exact user-requested name at a user-approved destination; verify the resulting active/saved project identity by native readback or observed application state. Do not invent a name/location or modify an existing project. If critical details are missing, ask.";
 }else if(premiere){
  specific=" For a Premiere opening request, verify the correct live application/window identity after launch before reporting it open.";
 }
 if(exportRequested){
  specific+=" If export was requested, verify the actual completed output artifact; an export command or queued job alone does not prove completion.";
 }
 return "Completion contract: pursue the user's FULL original objective, not just the last tool. An executable path, app launch, dialog click, proposed plan or model claim is not proof the goal was achieved. Require observed native/action evidence for each requested outcome; if it cannot be verified, say what remains unverified and pause. Never bypass Allow once, typed permissions, audit, or paid-request limits."+specific;
}
