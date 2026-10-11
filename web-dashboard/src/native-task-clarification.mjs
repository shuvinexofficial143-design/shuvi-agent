// Only an explicit model clarification of a still-active Windows task can
// carry original task context. No tool is planned/authorized here.
const APP=/\b(?:konsa|konsi|kaunsa|kaunsi|kon\s?sa)\b.{0,55}\b(?:app|software|adobe)\b|कौन[\s-]*सा|कौनसी|which\s+(?:adobe\s+)?(?:app|application|software)|what\s+app|specify\s+(?:the\s+)?(?:app|application)/iu;
const LOCATION=/\b(?:kaha|kahan|kidhar)\b.{0,90}\b(?:save|folder|path|directory)\b|\b(?:where|which|what)\b.{0,110}\b(?:folder|directory|save|path|location|destination)\b|कहाँ|कहां|किस\s+फोल्डर|सेव\s*करना/iu;
const NAME=/\b(?:project|file)\b.{0,50}\b(?:ka\s+)?naam\b.{0,35}\b(?:kya|batao|rakhu|rakhein)\b|\b(?:what|which|specify|choose)\b.{0,110}\b(?:project\s+name|file\s+name|filename|name)\b|क्या\s*नाम|नाम\s*(?:क्या|बताओ)/iu;
const CANCEL=/^(?:@|cancel\b|stop\b|never\s*mind\b|forget\s*it\b|रद्द|मत\s*करो|नया\s+काम\b)/iu;
const FRESH=/\b(?:open|launch|delete|create|export|install|send|khol(?:o|na)?|banao)\b.{1,55}\b(?:karo|kar\s*do|now)\b|खोलो|बनाओ|डिलीट|इंस्टॉल/iu;
// A full imperative is a new command, not a short answer to an old question.
// A Roman-Hindi imperative at the end is a new desktop command, not an app name.\nconst ROMAN_IMPERATIVE=/\b(?:kholo|khol\s?do|banao|banado|kar\s?do|karo|bhejo|hatao|chalao|lagao)\s*[.!]?$/iu;\nconst INDEPENDENT=/^(?:delete|remove|reset|close|launch|open|create|export|install|send|wipe|format)\b|^(?:हटाओ|बंद\s+करो|डिलीट|नया\s+काम)/iu;
export function taskClarificationKind(question,answer){
 if(typeof question!=="string"||typeof answer!=="string")return null;
 const q=question.trim().slice(0,650),a=answer.trim();
 if(!q||!a||a.length>300||CANCEL.test(a)||FRESH.test(a)||INDEPENDENT.test(a)||ROMAN_IMPERATIVE.test(a))return null;
 if(!/[?？]|कौन|बताओ|कहाँ|कहां|what\b|which\b|where\b|specify\b|\b(?:konsa|konsi|kaunsa|kaunsi|kaha|kahan|kidhar)\b|\bnaam\b.{0,30}\b(?:kya|rakhu|rakhein)\b/iu.test(q))return null;
 if(APP.test(q)&&/(?:app|application|software|ऐप|सॉफ्टवेयर|adobe|एडोबी)/iu.test(q))return "application";
 if(LOCATION.test(q))return "destination";
 if(NAME.test(q))return "name";
 return null;
}
export function extendTaskClarification(root,answer,kind){
 const value=typeof answer==="string"?answer.trim().slice(0,300):"";
 if(typeof root!=="string"||!["application","destination","name"].includes(kind)||!root.trim()||!value)
  return value;
 const suffix="\nUser "+kind+" clarification: "+value;
 return root.trim().slice(0,2500-suffix.length)+suffix;
}


// Preserve a Windows objective only across explicit Master clarification.
export const isTaskClarificationQuestion=question=>
 taskClarificationKind(question,"Shuvi Answer")!==null;
export function nextClarificationRoot(objective,reply,hasTool,role){
 if(role==="chat"||hasTool===true||!isTaskClarificationQuestion(reply))return null;
 if(typeof objective!=="string"||!objective.trim())return null;
 return objective.trim().slice(0,2500);
}
