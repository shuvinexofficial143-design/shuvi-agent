// Native user-goal checkpoints are advisory. Never claim app results from tool audits.
const OPEN=/\b(?:open|launch|start|khol(?:o|na|do)?|kholo)\b|खोलो|खोलना|खोल\s*दो/iu;
const PROJECT=/\b(?:project|projeckt|projct)\b|प्रोजेक्ट/iu;
const NEW=/\b(?:new|create|make|banao|banado|bnado)\b|नया|नई|बनाओ|बनाना|बना\s*दो/iu;
const IMPORT=/\b(?:import|add media|load media)\b|इम्पोर्ट|इंपोर्ट|मीडिया\s*जोड़/iu;
const EDIT=/\b(?:edit|trim|cut|timeline|caption|subtitle|colour|color|b-roll)\b|एडिट|टाइमलाइन|कटिंग|कैप्शन|सबटाइटल|कलर/iu;
const EXPORT=/\b(?:export|render|output video)\b|एक्सपोर्ट|रेंडर/iu;
const criteria={
 window:"Confirm the correct live application/window by fresh native observation",
 project:"Verify a NEW project with the requested name and approved save location; protect old projects",
 media:"Verify intended media appears in the target project",
 edit:"Verify requested edits appear in observed timeline/application state",
 export:"Verify the completed export artifact exists at the approved destination"
};
export function taskGoalChecks(request){
 const input=typeof request==="string"?request.slice(0,2500):"";
 if(!input.trim())return [];
 const ids=[];
 if(OPEN.test(input)||PROJECT.test(input)||IMPORT.test(input)||EDIT.test(input)||EXPORT.test(input))ids.push("window");
 if(PROJECT.test(input)&&NEW.test(input))ids.push("project");
 if(IMPORT.test(input))ids.push("media");
 if(EDIT.test(input))ids.push("edit");
 if(EXPORT.test(input))ids.push("export");
 return ids.map(id=>({id,criterion:criteria[id]}));
}
export function taskGoalContext(request){
 const steps=taskGoalChecks(request);
 if(!steps.length)return "Goal evidence: follow the full original request; no goal outcome verified.";
 return "Goal evidence checklist (NOT completed by tool audits): "+
  steps.map((s,i)=>(i+1)+". "+s.criterion+" [UNVERIFIED]").join("; ")+
  ". A model claim, tool count, launch or click does not prove a goal. Report missing evidence.";
}
export function taskGoalLabel(request){
 const ids=taskGoalChecks(request).map(x=>x.id);
 return ids.length?"Original goal checks still unverified: "+ids.join(", ")+".":"Task outcome not independently verified.";
}
