// Only an explicit model clarification of a still-active Windows task can
// carry original task context. No tool is planned/authorized here.
const APP=/कौन[\s-]*सा|कौनसी|which\s+(?:adobe\s+)?(?:app|application|software)|what\s+app|specify\s+(?:the\s+)?(?:app|application)/iu;
const LOCATION=/\b(?:where|which|what)\b.{0,110}\b(?:folder|directory|save|path|location|destination)\b|कहाँ|कहां|किस\s+फोल्डर|सेव\s*करना/iu;
const NAME=/\b(?:what|which|specify|choose)\b.{0,110}\b(?:project\s+name|file\s+name|filename|name)\b|क्या\s*नाम|नाम\s*(?:क्या|बताओ)/iu;
const CANCEL=/^(?:@|cancel\b|stop\b|never\s*mind\b|forget\s*it\b|रद्द|मत\s*करो|नया\s+काम\b)/iu;
const FRESH=/\b(?:open|launch|delete|create|export|install|send|khol(?:o|na)?|banao)\b.{1,55}\b(?:karo|kar\s*do|now)\b|खोलो|बनाओ|डिलीट|इंस्टॉल/iu;
export function taskClarificationKind(question,answer){
 if(typeof question!=="string"||typeof answer!=="string")return null;
 const q=question.trim().slice(0,650),a=answer.trim();
 if(!q||!a||a.length>300||CANCEL.test(a)||FRESH.test(a))return null;
 if(!/[?？]|कौन|बताओ|कहाँ|कहां|what\b|which\b|where\b|specify\b/iu.test(q))return null;
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
