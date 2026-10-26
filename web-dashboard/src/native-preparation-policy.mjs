// Universally reject native text input used to replace an OPEN operation.
// This check never selects a tool, grants permissions or executes an action.
const OPEN=/\b(?:open|launch|start|kholo|kholdo|khol\s*do)\b|(?:खोलो|खोल\s*दो|ओपन\s*करो)/iu;
const EDIT=/\b(?:type|write|enter|fill|paste|search|edit|rename|create|project|message|compose|replace|likho|bharo|banao)\b|(?:लिखो|भरो|बनाओ|सर्च|खोजो|टाइप|संदेश|प्रोजेक्ट|एडिट)/iu;
export function checkOpeningToolSelection(goal,proposal){
 if(proposal?.tool!=="ui_set_value")return {allowed:true,reason:"not_native_text"};
 if(typeof goal!=="string"||goal.length>2500)return {allowed:true,reason:"unclassified"};
 return OPEN.test(goal)&&!EDIT.test(goal)
  ?{allowed:false,reason:"opening_requires_navigation"}
  :{allowed:true,reason:"explicit_edit_or_nonopening"};
}
export function preparationFailureMessage(saved){
 return saved
  ?"अगले Windows Action की तैयारी में समस्या आई। कोई नया Action नहीं चला। Task सुरक्षित रूप से रोक दिया है।"
  :"Windows Action की तैयारी रुक गई है। Recovery रिकॉर्ड भी सुरक्षित नहीं हो सका। आगे कोई Action नहीं चलेगा।";
}


// Native preparation has NOT dispatched execute_action. Distinguish a
// bounded failed UIA discovery from a possibly executed tool. Only accept a
// strict, machine-authored prefix; never repeat stderr/window labels, paths,
// IDs, credentials or PowerShell in ordinary task chat.
const PREPARE_CODES=Object.freeze({
 SHUVI_UIA_PREPARE_TIMEOUT:"ऐप के Control की शुरुआती जाँच समय पर पूरी नहीं हुई।",
 SHUVI_UIA_PREPARE_OUTPUT_LIMIT:"Control की जाँच का डेटा तय सीमा से अधिक था।",
 SHUVI_UIA_PREPARE_BOUNDED:"सुरक्षित सीमा में सही Control की पहचान नहीं हो सकी।",
 SHUVI_UIA_PREPARE_AMBIGUOUS:"एक से अधिक Control मिले। सही Control चुनना अभी सुरक्षित नहीं है।",
 SHUVI_UIA_PREPARE_REJECTED:"Control की Windows पहचान सुरक्षित रूप से सत्यापित नहीं हुई।",
 SHUVI_UIA_PREPARE_FAILED:"Control की शुरुआती जाँच पूरी नहीं हो सकी।"
});
export function safeNativePreparationReason(error){
 const raw=error instanceof Error?error.message:typeof error==="string"?error:"";
 if(raw.length<1||raw.length>16_384)return null;
 // Do not classify random provider or UI text containing familiar codes.
 const match=/^(SHUVI_UIA_PREPARE_(?:TIMEOUT|OUTPUT_LIMIT|BOUNDED|AMBIGUOUS|REJECTED|FAILED))(?::|$)/.exec(raw);
 return match?PREPARE_CODES[match[1]]??null:null;
}
export function safePreparationChatMessage(saved,error){
 const prefix=safeNativePreparationReason(error);
 if(!prefix)return preparationFailureMessage(saved);
 return saved
  ?prefix+" यह सिर्फ तैयारी की जाँच थी। नया Windows Action नहीं चला। Task रोक दिया है; नई जाँच के लिए अलग अनुमति जरूरी होगी।"
  :prefix+" नया Windows Action नहीं चला, लेकिन Recovery रिकॉर्ड सुरक्षित नहीं हो सका। आगे का काम रोका है; पहले Activity/Audit देखें।";
}
