// Only data crosses this interface. Semantic roles are caller-defined labels.
const { planRecipe, primitive } = require("./mogrt-workflows.js");
const nameOK = s => typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 240 && !s.includes("\0");
function keys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error("Unknown graphics data field.");
}
function validateMapping(mapping) {
  keys(mapping, ["schema_version", "name", "template", "fields"]);
  if (mapping.schema_version !== 1 || !nameOK(mapping.name) || !Array.isArray(mapping.fields) || !mapping.fields.length || mapping.fields.length > 16) throw Error("Mapping v1 requires a name and 1–16 fields.");
  const t = mapping.template;
  if (t?.source === "path") {
    keys(t, ["source", "path"]);
    if (typeof t.path !== "string" || t.path.length > 2048 || t.path.includes("\0") || !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(t.path) || !/\.mogrt$/i.test(t.path)) throw Error("Absolute .mogrt path required.");
  } else if (t?.source === "library") {
    keys(t, ["source", "library_name", "element_name"]);
    if (!nameOK(t.library_name) || !nameOK(t.element_name)) throw Error("Exact library and element required.");
  } else throw Error("Unknown template source.");
  const roles = new Set(), selectors = new Set();
  for (const f of mapping.fields) {
    keys(f, ["role", "component_match_name", "component_display_name", "param_display_name", "primitive_type"]);
    if (!nameOK(f.role) || roles.has(f.role) || !nameOK(f.param_display_name) || !["string", "number", "boolean", "point", "color"].includes(f.primitive_type)
      || !(f.component_match_name || f.component_display_name)
      || [f.component_match_name, f.component_display_name].some(s => s != null && !nameOK(s))) throw Error("Unique explicit roles, supported value types and exact selectors required.");
    roles.add(f.role);
    const selector = JSON.stringify([f.component_match_name ?? null, f.component_display_name ?? null, f.param_display_name]);
    if (selectors.has(selector)) throw Error("Duplicate mapped parameter.");
    selectors.add(selector);
  }
  if (JSON.stringify(mapping).length > 24000) throw Error("Mapping exceeds native command budget.");
}
function validateItem(mapping, item) {
  validateMapping(mapping);
  keys(item, ["seconds", "duration_seconds", "fields"]);
  if (!Number.isFinite(item.seconds) || item.seconds < 0 || item.seconds > 86400
    || item.duration_seconds != null && (!Number.isFinite(item.duration_seconds) || item.duration_seconds <= 0 || item.seconds + item.duration_seconds > 86400)) throw Error("Invalid graphics placement or duration.");
  keys(item.fields, mapping.fields.map(f => f.role));
  if (Object.keys(item.fields).length !== mapping.fields.length) throw Error("Every mapped role needs an explicit value.");
  for (const f of mapping.fields) {
    if (!Object.prototype.hasOwnProperty.call(item.fields, f.role)) throw Error("Missing explicit role.");
    const p = primitive(item.fields[f.role]);
    if (!p.supported || p.type !== f.primitive_type) throw Error("Mapped value type mismatch; no coercion.");
  }
}
function mappedPlan(mapping, item, inspected) {
  validateItem(mapping, item);
  // 'property' means primitive-only to the existing planner. The user's role is never inferred.
  const plan = planRecipe({preset: "title", fields: mapping.fields.map(f => ({
    role: "property", component_match_name: f.component_match_name, component_display_name: f.component_display_name,
    param_display_name: f.param_display_name, value: item.fields[f.role]
  }))}, inspected);
  if (plan.skipped.length || plan.settings.length !== mapping.fields.length) throw Error("Inserted template does not match all saved selectors, types and static capabilities.");
  return plan;
}
module.exports = {validateMapping, validateItem, mappedPlan};
