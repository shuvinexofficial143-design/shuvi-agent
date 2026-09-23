// Pure recipe construction. Native parameter selectors and value units come from inspection/bindings.
const COLOR = {
  natural_correction: {contrast: 0.05, saturation: 0.03},
  cinematic_contrast: {contrast: 0.18, highlights: -0.12, shadows: -0.04},
  warm_cinematic: {temperature: 0.08, contrast: 0.12, saturation: -0.03},
  cool_cinematic: {temperature: -0.08, contrast: 0.12, saturation: -0.03},
  soft_wedding: {contrast: -0.08, highlights: -0.12, shadows: 0.1, temperature: 0.04},
  high_contrast_reel: {contrast: 0.24, saturation: 0.1, shadows: -0.1},
  neutral_product: {contrast: 0.03, saturation: -0.02, temperature: 0},
  social_media_punch: {contrast: 0.15, saturation: 0.12, highlights: -0.06}
};
const MOTION = {
  zoom_in: ["scale"], zoom_out: ["scale"], push_in: ["scale"], pull_out: ["scale"],
  slide_left: ["position"], slide_right: ["position"], ken_burns: ["position", "scale"],
  fade_in: ["opacity"], fade_out: ["opacity"], static_transform: ["position", "scale", "rotation", "anchor", "opacity", "crop"],
  handheld: ["position", "rotation"]
};
const validValue = v => Number.isFinite(v) || Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const interpolate = (a, b, t) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t;
function buildRecipePlan(request, inspectedBindings) {
  const {preset, start_seconds: start, end_seconds: end} = request;
  const color = COLOR[preset], roles = color ? Object.keys(color) : MOTION[preset];
  if (!roles) throw new Error("Unknown curated recipe preset.");
  const strength = request.strength ?? 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("Recipe strength must be 0–1.");
  const animated = !color && preset !== "static_transform";
  if (animated && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 86400)) throw new Error("Animated recipes require bounded native-parameter start/end seconds.");
  if (!Array.isArray(inspectedBindings) || inspectedBindings.length > 16) throw new Error("Recipes support at most 16 bindings.");
  const seen = new Set(), settings = [], skipped = [], warnings = [];
  for (const role of roles) {
    const matches = inspectedBindings.filter(binding => binding.role === role);
    if (matches.length > 1) throw new Error("Duplicate recipe role: " + role);
    const binding = matches[0];
    if (!binding || binding.unsupported) { skipped.push({role, reason: binding?.unsupported || "No inspected binding supplied."}); continue; }
    const key = JSON.stringify([binding.component_match_name, binding.component_display_name, binding.param_display_name]);
    if (seen.has(key)) throw new Error("Multiple roles cannot target the same parameter."); seen.add(key);
    const selector = {component_match_name: binding.component_match_name, component_display_name: binding.component_display_name, param_display_name: binding.param_display_name};
    if (color) {
      if (binding.timeVarying) { skipped.push({role, reason: "Static color recipe cannot overwrite animated parameter."}); continue; }
      if (![binding.current, binding.unit, binding.min, binding.max].every(Number.isFinite) || binding.unit <= 0 || binding.min >= binding.max || binding.current < binding.min || binding.current > binding.max) throw new Error("Color bindings require inspected numeric current value and explicit native unit/min/max.");
      const value = Math.max(binding.min, Math.min(binding.max, binding.current + color[role] * binding.unit * strength));
      settings.push({...selector, value});
    } else {
      const a = binding.start_value, b = binding.end_value;
      if (!validValue(a) || animated && (!validValue(b) || Array.isArray(a) !== Array.isArray(b))) throw new Error("Motion bindings require finite native start/end values of matching shape.");
      if (animated && !binding.keyframesSupported) { skipped.push({role, reason: "Native parameter does not support keyframes."}); continue; }
      if (!animated && binding.timeVarying) { skipped.push({role, reason: "Static recipe cannot overwrite animated parameter."}); continue; }
      if (!animated) settings.push({...selector, value: a});
      else {
        if (["zoom_in", "push_in", "fade_in"].includes(preset) && !(typeof a === "number" && b > a)) throw new Error("This preset requires increasing scalar endpoints.");
        if (["zoom_out", "pull_out", "fade_out"].includes(preset) && !(typeof a === "number" && b < a)) throw new Error("This preset requires decreasing scalar endpoints.");
        if (preset.startsWith("slide_") && !(Array.isArray(a) && (preset === "slide_left" ? b[0] < a[0] : b[0] > a[0]))) throw new Error("Slide endpoints must match the requested horizontal direction.");
        const samples = preset === "handheld" ? [0, 0.65, 0.25, 0.8, 0.35, 0.6, 0] : [0, 1];
        samples.forEach((amount, index) => settings.push({...selector, seconds: start + (end - start) * index / (samples.length - 1), value: interpolate(a, b, amount * strength)}));
      }
    }
  }
  if (settings.length > 64) throw new Error("Recipe exceeds 64 settings.");
  warnings.push("Parameter units/endpoints are supplied bindings; Shuvi does not infer coordinate systems or color calibration.");
  if (animated) warnings.push("Times use native parameter seconds; interpolation follows the host's existing/default behavior. Inspect keys afterward.");
  return {schemaVersion: 1, preset, applied: false, settings, skipped, warnings, timeDomain: "native_parameter_seconds", executionTool: "premiere_apply_video_recipe", frameReviewRequired: true};
}
module.exports = {buildRecipePlan, COLOR, MOTION};
