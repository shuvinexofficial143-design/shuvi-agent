// Native task routing. Regex only separates ordinary Chat from likely actions;
// it never decides WHICH Windows tool to run. The selected Master AI sees the
// user's original text, understands the intended app/action and proposes a
// typed Windows tool. No silent provider/model fallback or auto execution.
// Explicit @role is an intentional user choice to call a specialist directly.
export const NATIVE_MODEL_ROLES=Object.freeze([
 ["chat","Normal Chat"],
 ["master","Master / general computer tasks"],
 ["coding","Coding / websites / GitHub"],
 ["premiere","Adobe Premiere Pro"],
 ["after-effects","Adobe After Effects"],
 ["blender","Blender / 3D"],
 ["photoshop","Adobe Photoshop"],
 ["illustrator","Adobe Illustrator"],
 ["audition","Adobe Audition"],
 ["media-encoder","Adobe Media Encoder"],
 ["animate","Adobe Animate"],
 ["character-animator","Adobe Character Animator"],
 ["substance-3d","Substance 3D"],
 ["frameio","Frame.io"],
 ["research","Research / browser"],
 ["vision","Screen / visual inspection"],
 ["whatsapp","WhatsApp Desktop / Windows UI (approval required)"]
]);
const names=new Set(NATIVE_MODEL_ROLES.map(x=>x[0]));
const modelId=/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
export function validModelId(value){return typeof value==="string"&&modelId.test(value);}
const intents=[
 ["after-effects",/\bafter[\s-]?effects?\b|\baftereffects\b|आफ्टर इफेक्ट/iu],
 ["premiere",/\b(?:premiere|premire|premier)\b|प्रीमियर|प्रिमियर/iu],
 ["blender",/\bblender\b|\b3d\b|ब्लेंडर|3डी/iu],
 ["photoshop",/\bphoto[\s-]?shop\b|फोटोशॉप/iu],
 ["illustrator",/\billustrator\b|इलस्ट्रेटर/iu],
 ["audition",/\baudition\b|ऑडिशन/iu],
 ["media-encoder",/\bmedia[\s-]?encoder\b|मीडिया एनकोडर/iu],
 ["animate",/\badobe animate\b|एडोबी एनिमेट/iu],
 ["character-animator",/\bcharacter[\s-]?animator\b|कैरेक्टर एनिमेटर/iu],
 ["substance-3d",/\bsubstance[\s-]?3d\b|सब्सटेंस/iu],
 ["frameio",/\bframe\.?io\b/iu],
 ["whatsapp",/\bwhats\s?app\b|व्हाट्सएप|व्हाट्सऐप|व्हाट्सअप|व्हाट्सप्प/iu],
 ["coding",/\b(?:code|coding|github|repository|typescript|javascript|python|website|app development)\b|कोड|वेबसाइट/iu],
 ["research",/\b(?:browse|browser|google search|web search|research|search the web)\b|वेब पर खोज|रिसर्च/iu],
 ["vision",/\b(?:screenshot|inspect screen|screen vision)\b|स्क्रीनशॉट|स्क्रीन देख/iu]
];
const executionVerb=/\b(?:open|launch|start|create|make|build|edit|render|export|write|save|modify|design|generate|run|search|find|inspect|control|send|reply|read|download|upload|close|click|type|commit|push|install|delete|remove|update|rename|copy|paste|import|attach|select|drag|drop|move|trim|cut|split|merge|undo|redo|look(?=\s+(?:for|at)\b)|lagao|lagana|jodo|jod\s?do|hatao|badlo|badal\s?do|save\s?krdo|banao|bnado|khojo|dekho|dhundho|dhoondo|khol(?:o|na|de|do)?|khul(?:wa|do)?|chala(?:o|do)?|chal(?:u|ao)|karo|kar\s?do|kr\s?do|bhejo|likho|dikhao)\b|खोलो|खोलना|खोल\s?दो|बनाओ|बनाना|करो|करना|लिखो|लिखना|भेजो|भेजना|सेव|एडिट|चलाओ|रेंडर|डिलीट|हटाओ|डाउनलोड|इंस्टॉल|खोजो|देखो|बदल/iu;
// BUG-004: honor polite/indirect Hindi and Roman-Hindi commands without
// assuming every Hindi question is permission to run a Windows tool.
// Purely informational requests remain on the owner's Chat model. This
// classifier does NOT approve or execute anything; Rust permission is final.
const hindiPoliteImperative=/(?:खोल\s*(?:दीजिए|दिजिए|दो|देना|दें)|खोलकर\s*(?:दिखा(?:इए|एँ|दो|दीजिए)|रख)|खोलिए|बना\s*(?:दीजिए|दो|देना|दें)|बनाकर\s*(?:दिखा(?:इए|दो|दीजिए)|दे(?:ना|दो))|कर\s*(?:दीजिए|दिजिए|दो|देना|दें)|दिखा\s*(?:दीजिए|दो|देना|दें)|दिखाइए|लगा\s*(?:दीजिए|दो|देना)|हटा\s*(?:दीजिए|दो|देना)|चला\s*(?:दीजिए|दो|देना)|चलाइए|लिख\s*(?:दीजिए|दो|देना)|लिखिए|भेज\s*(?:दीजिए|दो|देना)|भेजिए|चुनिए|बदलिए|सहेजिए|निकालिए|पेस्ट\s*(?:दीजिए|दो)|खोजिए|ढूँढिए|ढूंढिए)/iu;
const romanPoliteImperative=/\b(?:khol\s*(?:do|de|dena|dijiye|kar|ke)|bana\s*(?:do|de|dena|dijiye)|kar\s*(?:do|de|dena|dijiye)|kr\s*(?:do|de|dena)|dikha\s*(?:do|dena|dijiye)|laga\s*(?:do|dena)|hata\s*(?:do|dena)|save\s*kar\s*(?:do|dena)|bhej\s*(?:do|dena))\b/iu;
const hindiDirectQuestion=/^क्या\s+(?:आप|तुम|शुवि|shuvi)\b?/iu;
const actionCapabilityRoot=/(?:खोल|बना|चल|लगा|हटा|एडिट|एक्सपोर्ट|इम्पोर्ट|रेंडर|सेव|टाइप|क्लिक|लिख|भेज|डाउनलोड|इंस्टॉल|सेलेक्ट|कॉपी|पेस्ट|create|open|edit|export|render|save|launch|start)/iu;
const secondPersonCapability=/(?:सकते|सकती|सकोगे|पाएँगे|पाओगे|सकेंगे)\s*(?:हो|हैं|क्या|\?)?\s*[?.।]?$/iu;
const howToQuestion=/(?:कैसे\s*(?:कर|करूँ|करें|करते|बनाऊँ|बनाएं|खोलूँ|खोलें|होता)|किस\s+तरह|क्या\s+(?:है|होता\s+है)|\bhow\s+to\b|\bsteps\s+to\b|(?:बनाने|खोलने|करने|एडिट\s+करने)\s+का\s+तरीका|समझाइए|बताइए|सिखाइए)/iu;
export function classifyNativeIntent(text) {
 if(typeof text!=="string")return "chat";
 const input=text.trim();
 const explicit=input.match(/^@([a-z0-9-]+)(?:\s|$)/i);
 if(explicit&&names.has(explicit[1].toLowerCase()))return explicit[1].toLowerCase();
 if(/^(?:explain|what is|how (?:do|does|to)|teach me|tell me about|why |can you explain|समझाओ|क्या है|कैसे |क्यों )/iu.test(input))return "chat";
 // "Premiere में export कैसे करें?" is a question, not a request to
 // execute export. An explicit second-person ability-to-do request is
 // different: "क्या आप Premiere export कर सकते हो?" belongs to Master.
 const politeCapability=hindiDirectQuestion.test(input)&&actionCapabilityRoot.test(input)&&
   secondPersonCapability.test(input);
 if(howToQuestion.test(input)&&!politeCapability)return "chat";
 // A question about what software can do is not a request to operate it.
 // A direct "Can you open..." remains an actionable user command.
 if(/^(?:can|could|does|do|is|are|should|will)\s+(?!you\b|we\b|shuvi\b).{1,100}\?\s*$/iu.test(input))return "chat";
 if(!executionVerb.test(input)&&!hindiPoliteImperative.test(input)&&
    !romanPoliteImperative.test(input)&&!politeCapability)return "chat";
 const match=intents.filter(([,rule])=>rule.test(input));
 if(match.length===1)return match[0][0];
 if(match.length>1)return "master";
 // A command-like utterance with an unrecognized app/name still belongs to
 // Master. It must see the ORIGINAL text and reason about it; a rigid list of
 // English product names must not send imperfect Hindi to cheap Chat instead.
 return "master";
}
export function safeNativeEndpoint(provider,provided) {
 const input=typeof provided==="string"?provided.trim():"";
 if(!input)return provider==="ollama"?"http://127.0.0.1:11434/v1/chat/completions":"";
 if(provider!=="custom"&&provider!=="ollama")return "";
 if(input.length>1024||/[\r\n]/.test(input))return "";
 let url;
 try {url=new URL(input);}catch{return "";}
 if(url.username||url.password||url.search||url.hash)return "";
 if(provider==="custom"&&url.protocol!=="https:")return "";
 if(provider==="ollama"&&(url.protocol!=="http:"&&url.protocol!=="https:"))return "";
 if(provider==="ollama"&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname))return "";
 // Backends expect the FULL Chat Completions URL; accept user-friendly /v1.
 if(url.pathname==="/"||url.pathname.endsWith("/v1")||url.pathname.endsWith("/v1/")){
  url.pathname=url.pathname.replace(/\/+$/,"")+"/chat/completions";
 }
 return url.toString();
}
export function chooseNativeRoute(text, config) {
 const role=classifyNativeIntent(text);
 if(!config||!config.provider||!config.roles||typeof config.roles!=="object")
  return {ok:false,role,error:"First set up Shuvi AI in Settings."};
 // The Master is the one entry point for all ordinary Windows commands.
 // Worker model selection is an explicit @role override, not a brittle regex
 // shortcut that silently bypasses Master reasoning.
 const explicit=typeof text==="string"&&text.trim().match(/^@([a-z0-9-]+)(?:\s|$)/i);
 const intentionalRole=explicit&&names.has(explicit[1].toLowerCase())?explicit[1].toLowerCase():null;
 const modelRole=intentionalRole|| (role==="chat"?"chat":"master");
 const model=config.roles[modelRole];
 if(!validModelId(model))
  return {ok:false,role,error:"No model assigned for "+modelRole+". Set your selected "+
   (modelRole==="master"?"Master AI":"task")+" model in Settings → AI Model Team. No other model was used."};
 const base_url=(config.provider==="custom"||config.provider==="ollama")?safeNativeEndpoint(config.provider,config.base_url):"";
 if(config.provider==="custom"&&!base_url)
  return {ok:false,role,error:"Custom provider URL is invalid. Fix it in Settings."};
 if(config.provider==="ollama"&&!base_url)
  return {ok:false,role,error:"Local Ollama endpoint is invalid."};
 return {ok:true,role,provider:config.provider,model,base_url};
}
