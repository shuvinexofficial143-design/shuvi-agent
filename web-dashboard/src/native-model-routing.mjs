// Strict, deterministic routing for the packaged Windows Shuvi dashboard.
// Ordinary explanation/questions use chat; explicit @role always takes priority.
// All model IDs must be exact user choices; never silently pick or bill another.
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
 ["after-effects",/\bafter[\s-]?effects?\b|आफ्टर इफेक्ट/iu],
 ["premiere",/\bpremiere\b|प्रीमियर/iu],
 ["blender",/\bblender\b|\b3d\b|ब्लेंडर|3डी/iu],
 ["photoshop",/\bphotoshop\b|फोटोशॉप/iu],
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
const executionVerb=/\b(?:open|launch|start|create|make|build|edit|render|export|write|save|modify|design|generate|run|search|find|inspect|control|send|reply|read|download|upload|close|click|type|commit|push|install|delete|remove|update)\b|खोलो|खोलना|बनाओ|बनाना|करो|करना|लिखो|लिखना|भेजो|भेजना|सेव|एडिट|चलाओ|रेंडर|डिलीट|हटाओ|डाउनलोड|इंस्टॉल|खोजो|देखो|बदल/iu;
export function classifyNativeIntent(text) {
 if(typeof text!=="string")return "chat";
 const input=text.trim();
 const explicit=input.match(/^@([a-z0-9-]+)(?:\s|$)/i);
 if(explicit&&names.has(explicit[1].toLowerCase()))return explicit[1].toLowerCase();
 if(/^(?:explain|what is|how (?:do|does|to)|teach me|tell me about|why |can you explain|समझाओ|क्या है|कैसे |क्यों )/iu.test(input))return "chat";
 if(!executionVerb.test(input))return "chat";
 const match=intents.filter(([,rule])=>rule.test(input));
 if(match.length===1)return match[0][0];
 if(match.length>1)return "master";
 // Writing scripts, ordinary questions and brainstorming stay with Chat AI.
 return /\b(?:notepad|desktop|computer|file|folder|terminal|powershell|cmd|window|keyboard|mouse|settings|app)\b|लैपटॉप|कंप्यूटर|फाइल|फ़ाइल|फोल्डर/iu.test(input)?"master":"chat";
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
 const model=config.roles[role];
 if(!validModelId(model))
  return {ok:false,role,error:"No model assigned for "+role+". Choose it under Settings → AI Model Team. No other model was used."};
 const base_url=(config.provider==="custom"||config.provider==="ollama")?safeNativeEndpoint(config.provider,config.base_url):"";
 if(config.provider==="custom"&&!base_url)
  return {ok:false,role,error:"Custom provider URL is invalid. Fix it in Settings."};
 if(config.provider==="ollama"&&!base_url)
  return {ok:false,role,error:"Local Ollama endpoint is invalid."};
 return {ok:true,role,provider:config.provider,model,base_url};
}
