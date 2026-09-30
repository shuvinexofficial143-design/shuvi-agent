// Native component inspection and pure planning; no writes or semantic field inference.
const LIMITS = Object.freeze({components: 128, paramsPerComponent: 128, totalParams: 256, valueChars: 2048, resultChars: 48000, fields: 16});
function capability() {
  return {native_mogrt_identity: false, semantic_field_roles: false, component_inspection: true,
    primitive_static_editing: true, structured_static_editing: true,
    supported_value_types: ["string","number","boolean","point","color"], runtimeVerified: false,
    reason: "Reviewed ComponentParam APIs support native string/number/boolean plus PointF and Color values. MOGRT identity and semantic field roles still require explicit caller mappings."};
}
const finite = value => typeof value === "number" && Number.isFinite(value);
const exactKeys = (value, allowed) => {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
};
function primitive(value, allowNativeStructured = false) {
  const type = typeof value;
  if (type === "string" && value.length <= LIMITS.valueChars || type === "boolean" || type === "number" && Number.isFinite(value)) return {supported: true, type, value};
  if (value && type === "object" && !Array.isArray(value)) {
    const taggedPoint = value.type === "point" && exactKeys(value,["type","x","y"]) && finite(value.x) && finite(value.y)
      && Math.abs(value.x) <= 1000000 && Math.abs(value.y) <= 1000000;
    if (taggedPoint) return {supported:true,type:"point",value:{type:"point",x:value.x,y:value.y}};
    const taggedColor = value.type === "color" && exactKeys(value,["type","red","green","blue","alpha"])
      && [value.red,value.green,value.blue,value.alpha].every(v => finite(v) && v >= 0 && v <= 1);
    if (taggedColor) return {supported:true,type:"color",value:{type:"color",red:value.red,green:value.green,blue:value.blue,alpha:value.alpha}};
    if (allowNativeStructured && finite(value.x) && finite(value.y)) {
      return {supported:true,type:"point",value:{type:"point",x:value.x,y:value.y}};
    }
    if (allowNativeStructured && [value.red,value.green,value.blue,value.alpha].every(v => finite(v) && v >= 0 && v <= 1)) {
      return {supported:true,type:"color",value:{type:"color",red:value.red,green:value.green,blue:value.blue,alpha:value.alpha}};
    }
  }
  return {supported: false, type: value === null ? "null" : Array.isArray(value) ? "array" : type,
    value: null, reason: type === "string" ? "String exceeds 2048 characters." : "Only bounded string, finite number, boolean, PointF and Color values are supported."};
}
const nameValue = value => typeof value === "string" && value.length > 0 && value.length <= 240 ? value : null;
async function inspectProperties(item) {
  const report = {schemaVersion: 1, capability: capability(), clipName: null, clipMatchName: null, componentCount: null,
    components: [], inspectedParamCount: 0, truncated: false, errors: [], limits: LIMITS};
  const error = value => { if (report.errors.length < 16) report.errors.push(String(value?.message || value).slice(0, 240)); };
  try { report.clipName = nameValue(await item.getName()); } catch (e) { error(e); }
  try { report.clipMatchName = nameValue(await item.getMatchName()); } catch { /* Native identity may be unavailable. */ }
  const chain = await item.getComponentChain();
  const count = await chain.getComponentCount();
  if (!Number.isInteger(count) || count < 0) throw new Error("Invalid native component count.");
  report.componentCount = count; report.truncated = count > LIMITS.components;
  for (let index = 0; index < Math.min(count, LIMITS.components); index++) {
    if (report.inspectedParamCount >= LIMITS.totalParams) { report.truncated = true; break; }
    try {
      const component = await chain.getComponentAtIndex(index);
      const matchName = nameValue(await component.getMatchName()), displayName = nameValue(await component.getDisplayName());
      const paramCount = await component.getParamCount();
      if (!Number.isInteger(paramCount) || paramCount < 0) throw new Error("Invalid native parameter count.");
      const entry = {componentIndex: index, matchName, displayName, paramCount, params: []};
      if (!matchName || !displayName) { report.truncated = true; error("Component selector unavailable or oversized."); }
      if (paramCount > LIMITS.paramsPerComponent) report.truncated = true;
      for (let paramIndex = 0; paramIndex < Math.min(paramCount, LIMITS.paramsPerComponent); paramIndex++) {
        if (report.inspectedParamCount >= LIMITS.totalParams) { report.truncated = true; break; }
        report.inspectedParamCount++;
        try {
          const param = await component.getParam(paramIndex);
          const displayName = nameValue(param.displayName);
          let inspected = {supported: false, type: "unavailable", value: null, reason: "Start value unavailable."};
          let keyframesSupported = null, timeVarying = null;
          try { const start = await param.getStartValue(); inspected = primitive(start?.value, true); } catch {}
          try { const v = await param.areKeyframesSupported(); if (typeof v === "boolean") keyframesSupported = v; } catch {}
          try { const v = await param.isTimeVarying(); if (typeof v === "boolean") timeVarying = v; } catch {}
          const staticSetCapability = typeof param.createKeyframe === "function" && typeof param.createSetValueAction === "function";
          entry.params.push({paramIndex, displayName, ...inspected, keyframesSupported, timeVarying, staticSetCapability,
            editable: Boolean(displayName && inspected.supported && timeVarying === false && staticSetCapability)});
        } catch (e) { report.truncated = true; error(e); }
      }
      report.components.push(entry);
      if (JSON.stringify(report).length > LIMITS.resultChars) { report.components.pop(); report.truncated = true; error("Inspection output budget reached."); break; }
    } catch (e) { report.truncated = true; error(e); }
  }
  return report;
}
function planRecipe(request, inspected) {
  if (!["title", "lower_third"].includes(request?.preset)) throw new Error("Graphics preset must be title or lower_third.");
  if (!Array.isArray(request.fields) || !request.fields.length || request.fields.length > LIMITS.fields) throw new Error("Graphics recipe requires 1–16 fields.");
  const settings = [], skipped = [], selectors = new Set(), resolvedSelectors = new Set();
  for (const [index, field] of request.fields.entries()) {
    if (!field || !["text", "title", "subtitle", "property"].includes(field.role)) throw new Error("Field role must be text, title, subtitle or property; roles are supplied, not inferred.");
    const match = field.component_match_name, display = field.component_display_name;
    if (!(match || display) || match != null && !nameValue(match) || display != null && !nameValue(display) || !nameValue(field.param_display_name)) throw new Error("Exact bounded component and parameter selectors are required.");
    const requested = primitive(field.value);
    if (!requested.supported) throw new Error("Requested value must be a bounded native value.");
    const selector = JSON.stringify([match || null, display || null, field.param_display_name]);
    if (selectors.has(selector)) throw new Error("Duplicate field selector."); selectors.add(selector);
    const skip = reason => skipped.push({index, role: field.role, reason});
    if (inspected.truncated) { skip("Incomplete inspection cannot establish an unambiguous selector."); continue; }
    const components = inspected.components.filter(c => (!match || c.matchName === match) && (!display || c.displayName === display));
    if (components.length !== 1) { skip("Component selector resolved " + components.length + " matches."); continue; }
    const component = components[0], params = component.params.filter(p => p.displayName === field.param_display_name);
    if (params.length !== 1) { skip("Parameter selector resolved " + params.length + " matches."); continue; }
    const param = params[0], resolvedKey = component.componentIndex + ":" + param.paramIndex;
    if (resolvedSelectors.has(resolvedKey)) throw new Error("Duplicate field selectors resolve to the same parameter."); resolvedSelectors.add(resolvedKey);
    if (!param.editable) { skip(param.reason || "Field is complex, time-varying, unreadable or has no static setter."); continue; }
    if (field.role !== "property" && param.type !== "string") { skip("Text/title/subtitle roles require an inspected string parameter."); continue; }
    if (param.type !== requested.type) { skip("Requested type does not match inspected native type; no coercion is allowed."); continue; }
    settings.push({component_match_name: component.matchName, component_display_name: component.displayName,
      param_display_name: param.displayName, value: requested.value});
  }
  const result = {schemaVersion: 2, preset: request.preset, applied: false, settings, skipped,
    warnings: ["Roles were supplied by the caller. This does not prove the clip is a MOGRT or a parameter is an Essential Graphics text field.", "Review the plan, apply through the checkpointed video recipe tool, then inspect and visually verify; unchanged clip identity does not lock parameter values."],
    executionTool: "premiere_apply_video_recipe",
    deterministicTargeting: true,
    semanticFieldInference: false,
    callerSuppliedSemanticRoles: true,
    semanticRolesVerified: false,
    templateSourceIdentityVerified: false,
    thirdPartyTemplateSafetyVerified: false,
    safeAutomaticApply: false,
    requiresVisualReview: true};
  if (JSON.stringify(result).length > LIMITS.resultChars) throw new Error("Graphics plan exceeds the output budget.");
  return result;
}
module.exports = {LIMITS, capability, primitive, inspectProperties, planRecipe};
