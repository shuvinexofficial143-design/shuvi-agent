// Native user-goal checkpoints are advisory. Never claim app results from tool audits.
const OPEN=/\b(?:open|launch|start|khol(?:o|na|do)?|kholo)\b|खोलो|खोलना|खोल\s*दो/iu;
const PROJECT=/\b(?:project|projeckt|projct)\b|प्रोजेक्ट/iu;
const NEW=/\b(?:new|create|make|banao|banado|bnado)\b|नया|नई|बनाओ|बनाना|बना\s*दो/iu;
const SAVE=/\b(?:save|saved|saving|save as|save karo)\b|सेव|सहेजो/iu;
const IMPORT=/\b(?:import|imported|add media|load media|import karo|media add)\b|इम्पोर्ट|इंपोर्ट|मीडिया\s*जोड़/iu;
const EDIT=/\b(?:edit|editing|trim|cut|timeline|captions?|subtitles?|colour|color|colour grading|color grading|b-roll|transition|transitions|vfx)\b|एडिट|टाइमलाइन|कटिंग|कैप्शन|सबटाइटल|कलर|ट्रांज़िशन/iu;
const AUDIO=/\b(?:noise reduction|denoise|audio mix(?:ing)?|sound design|voice[\s-]?over|loudness normalization|audio clean(?:up)?)\b|नॉइज़ रिडक्शन|वॉइसओवर|ऑडियो मिक्स/iu;
const EXPORT=/\b(?:export|exported|render|rendered|output video|final video)\b|एक्सपोर्ट|रेंडर/iu;
const criteria={
 window:"Confirm the correct live application/window by fresh native observation",
 project:"Verify a NEW project with the requested name and approved save location; protect old projects",
 save:"Verify the intended document or project is actually saved at the approved destination",
 media:"Verify intended media appears in the target project",
 edit:"Verify requested edits appear in observed timeline/application state",
 audio:"Verify requested audio processing or mixing is audibly present in the intended output",
 export:"Verify the completed export artifact exists at the approved destination"
};
export function taskGoalChecks(request){
 const input=typeof request==="string"?request.slice(0,2500):"";
 if(!input.trim())return [];
 const ids=[];
 if(OPEN.test(input)||PROJECT.test(input)||SAVE.test(input)||IMPORT.test(input)||EDIT.test(input)||AUDIO.test(input)||EXPORT.test(input))ids.push("window");
 if(PROJECT.test(input)&&NEW.test(input))ids.push("project");
 if(SAVE.test(input)&&!NEW.test(input))ids.push("save");
 if(IMPORT.test(input))ids.push("media");
 if(EDIT.test(input))ids.push("edit");
 if(AUDIO.test(input))ids.push("audio");
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
