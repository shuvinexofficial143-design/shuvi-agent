/**
 * Shuvi Balanced router — deterministic, offline PLAN PREVIEW ONLY.
 *
 * No provider/model health check, price lookup, AI inference, native tool call,
 * Telegram send, or runtime dispatch happens in this module.
 * Model strings are *family preferences*, never verified API model IDs.
 */
export const BALANCED_MODE = "balanced";
export const TEAM_SCOPE = "browser_preferences_only";
export const MAX_PARALLEL_PLANNING = 2;
export const MAX_DESKTOP_CONTROLLERS = 1;

export const ROUTER_DEFAULTS = Object.freeze({
  master: Object.freeze({provider:"Custom / OpenRouter (verify)",model:"SOL 6.1 family",fallback:"Claude Opus family"}),
  launcher: Object.freeze({provider:"Gemini (verify)",model:"Gemini Flash family",fallback:"DeepSeek Chat family"}),
  project: Object.freeze({provider:"Gemini (verify)",model:"Gemini Flash family",fallback:"Claude Sonnet family"}),
  coding: Object.freeze({provider:"Anthropic / OpenRouter (verify)",model:"Claude Sonnet family",fallback:"SOL 6.1 family"}),
  video: Object.freeze({provider:"Anthropic / OpenRouter (verify)",model:"Claude Opus family",fallback:"Claude Sonnet family"}),
  motion: Object.freeze({provider:"Anthropic / OpenRouter (verify)",model:"Claude Opus family",fallback:"SOL 6.1 family"}),
  blender: Object.freeze({provider:"Custom / OpenRouter (verify)",model:"SOL 6.1 family",fallback:"Claude Opus family"}),
  vision: Object.freeze({provider:"Gemini (verify)",model:"Gemini Pro multimodal family",fallback:"Verified vision model"}),
  image: Object.freeze({provider:"Gemini image endpoint (verify)",model:"Gemini image model",fallback:"Verified image model"}),
  video_gen: Object.freeze({provider:"Veo endpoint (verify)",model:"Veo video model",fallback:"Verified video model"}),
  reviewer: Object.freeze({provider:"Anthropic / OpenRouter (verify)",model:"Claude Sonnet family",fallback:"Claude Opus family"})
});

/** Stable IDs preserve the original 8-role browser preferences during expansion. */
export const ROLE_IDS = Object.freeze([
  "master","launcher","project","coding","video","image","video_gen","blender","motion","vision","reviewer"
]);

/** @typedef {"fast"|"balanced"|"heavy"} Tier */
/** @typedef {"text"|"vision"|"image"|"video"} Modality */

/**
 * Classifies a user request into a logical role. NOT model execution.
 * @param {string} value
 * @returns {{mode:"balanced",scope:"browser_preferences_only",roleId:string,tier:Tier,modality:Modality,reason:string,requiresNativeRuntime:boolean,requiresCostApproval:boolean,estimatedCost:null,activeWorkers:0,verifiedAvailability:false}}
 */
export function classifyBalancedTask(value) {
  const task = String(value ?? "").trim().slice(0,6000);
  const complex = /complex|advanced|cinematic|professional|high.quality|difficult|vfx|motion.graphics|मुश्किल|जटिल|प्रोफेशनल|एडवांस|भारी/i.test(task);
  const generation = /generate|create|make|render|बना|जनरेट|तैयार|जेनरेट|उत्पन्न/i.test(task);
  let roleId = "master";
  let modality = "text";
  let tier = "balanced";
  let reason = "General planning: master routes to an eligible specialist after provider verification.";

  if (!task) {
    reason = "Enter a task to preview the suggested specialist.";
  } else if (generation && /video.clip|b[\s-]?roll|footage|video\s+generat|वीडियो.*(क्लिप|बना)|क्लिप.*(बना|जनरेट)/i.test(task)) {
    roleId="video_gen"; modality="video"; tier="heavy";
    reason="Requested generated footage: requires a verified video endpoint and explicit cost approval.";
  } else if (generation && /image|thumbnail|picture|poster|photo|इमेज|फोटो|तस्वीर|पोस्टर|थंबनेल/i.test(task)) {
    roleId="image"; modality="image"; tier="balanced";
    reason="Requested generated image: requires an image-capable endpoint and explicit cost approval.";
  } else if (/^(?:open|launch|start)\s+(?:premiere|blender|photoshop|after effects|chrome|app)|(?:premiere|blender|photoshop|chrome)\s+(?:खोलो|ओपन)|(?:खोलो|ओपन)\s+(?:premiere|blender|photoshop|chrome)|ऐप\s+खोलो/i.test(task)) {
    roleId="launcher"; tier="fast";
    reason="Simple application launch: prefer a fast/low-cost controller.";
  } else if (/after.effects|after effect|motion.graphics|motion design|vfx|मोशन\s*ग्राफिक्स|आफ्टर\s*इफेक्ट/i.test(task)) {
    roleId="motion"; tier="heavy";
    reason="Motion/VFX work benefits from advanced creative reasoning.";
  } else if (/blender|sculpt|3d.model|3d.scene|3d.animation|ब्लेंडर|स्कल्प्ट|थ्रीडी/i.test(task)) {
    roleId="blender"; tier=complex?"heavy":"balanced";
    reason="Blender specialist plans 3D work; one native UI owner is required.";
  } else if (/screenshot|screen.?shot|inspect.*screen|analy[sz]e.*(?:image|frame|photo|video)|reference.*(?:image|frame|photo)|स्क्रीनशॉट|फोटो\s*देख|तस्वीर.*जाँच/i.test(task)) {
    roleId="vision"; modality="vision"; tier="balanced";
    reason="Visual input requires a verified vision-capable model and approved media access.";
  } else if (/review|quality.check|verify.result|qa\s|test.result|जाँच|रिव्यू|गुणवत्ता/i.test(task)) {
    roleId="reviewer"; tier="balanced";
    reason="Independent quality/evidence review; only observed results count.";
  } else if (/code|coding|debug|github|repository|repo\b|pull.request|unit.test|test.*build|bug.fix|website.*fix|कोड|कोडिंग|बग|डिबग|रिपॉजिटरी/i.test(task)) {
    roleId="coding"; tier=complex?"heavy":"balanced";
    reason="Coding work should inspect source, validate changes and use native approvals.";
  } else if (/premiere|timeline|subtitle|caption|video.edit|footage.edit|video.*cut|प्रिमियर|कैप्शन|सबटाइटल|एडिट/i.test(task)) {
    roleId="video"; tier=complex?"heavy":"balanced";
    reason="Editorial planning belongs to the Premiere specialist; native timeline actions remain locked.";
  } else if (/project|folder|organize|asset.library|प्रोजेक्ट|फोल्डर|फाइल.*(सेट|व्यवस्थित)/i.test(task)) {
    roleId="project"; tier="fast";
    reason="Routine project organization prefers fast, inexpensive reasoning.";
  } else if (/open|launch|list.files|find.file|खोल|ढूँढ|खोज/i.test(task)) {
    roleId="launcher"; tier="fast";
    reason="Small tool/inspection task: fast-tier plan; native permission still applies.";
  } else if (complex || /multi.task|parallel|simultaneous|एक\s*साथ|साथ\s*में/i.test(task)) {
    roleId="master"; tier="heavy";
    reason="Complex multi-step request needs dependency-aware master planning.";
  }

  const requiresCostApproval = modality === "image" || modality === "video";
  return {
    mode:BALANCED_MODE,
    scope:TEAM_SCOPE,
    roleId, tier, modality, reason,
    requiresNativeRuntime: true,
    requiresCostApproval,
    estimatedCost:null,
    activeWorkers:0,
    verifiedAvailability:false
  };
}
