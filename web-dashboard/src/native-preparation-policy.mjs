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
