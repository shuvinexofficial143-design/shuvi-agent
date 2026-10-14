// Task-level provider/model routing. One provider request at a time; this is
// NOT a claim of independent parallel AI workers or a successful tool action.
export const MODEL_ROLES = Object.freeze([
  ["master", "Master / general chat"],
  ["coding", "Coding / websites"],
  ["premiere", "Premiere / video editing"],
  ["blender", "Blender / 3D"],
  ["research", "Research / browser"],
  ["vision", "Screen / vision"]
]);

const VALID_ROLE = new Set(MODEL_ROLES.map(([id]) => id));
const VALID_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const roleHints = [
  ["premiere", /\b(?:premiere|timeline|sequence|video editing)\b|प्रीमियर|वीडियो एडिट/i],
  ["blender", /\b(?:blender|3d model|sculpt|geometry)\b|ब्लेंडर|3डी मॉडल/i],
  ["coding", /\b(?:code|coding|repository|typescript|python|javascript|github|website)\b|कोड|वेबसाइट/i],
  ["research", /\b(?:research|browse|search web|internet search)\b|रिसर्च|खोजो|इंटरनेट/i],
  ["vision", /\b(?:screenshot|inspect screen|read screen|screen vision)\b|स्क्रीनशॉट/i]
];

export function taskRole(text) {
  if (typeof text !== "string") return "master";
  const explicit = text.trim().match(/^@(master|coding|premiere|blender|research|vision)(?:\s|$)/i);
  if (explicit) return explicit[1].toLowerCase();
  const matches = roleHints.filter(([, pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][0] : "master";
}

export function validateModelRoute(role, config, providers) {
  if (!VALID_ROLE.has(role) || !config || typeof config !== "object") return null;
  if (typeof config.provider !== "string" || !providers.includes(config.provider)) return null;
  if (typeof config.model !== "string" || !VALID_MODEL.test(config.model)) return null;
  const base_url = config.provider === "custom" || config.provider === "ollama"
    ? typeof config.base_url === "string" ? config.base_url.trim() : ""
    : "";
  if (base_url.length > 1024 || /[\r\n]/.test(base_url)) return null;
  if (config.provider === "custom" && !/^https:\/\//i.test(base_url)) return null;
  if (config.provider === "ollama" && base_url && !/^https?:\/\//i.test(base_url)) return null;
  return { provider: config.provider, model: config.model, base_url };
}

export function loadModelRoutes(raw, providers) {
  if (typeof raw !== "string" || raw.length > 12000) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result = {};
  for (const [role] of MODEL_ROLES) {
    const route = validateModelRoute(role, parsed[role], providers);
    if (route) result[role] = route;
  }
  return result;
}

export function selectTaskRoute(text, routes, fallback) {
  const requested = taskRole(text);
  const chosen = routes[requested] || routes.master || fallback;
  return { ...chosen, role: routes[requested] ? requested : routes.master ? "master" : "default" };
}
