// The native Rust permission record and owner-facing approval must agree.
const ALLOWED_RISKS = new Set(["low", "medium", "high"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
export function approvalRiskClass(risk) {
  return ALLOWED_RISKS.has(risk) ? "risk " + risk : "risk unknown";
}
export function validPendingDisplayMetadata(pending, exactTool = null) {
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) return false;
  if (typeof pending.id !== "string" || !UUID.test(pending.id)) return false;
  if (typeof pending.kind !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(pending.kind)) return false;
  if (exactTool !== null && pending.kind !== exactTool) return false;
  if (!ALLOWED_RISKS.has(pending.risk)) return false;
  for (const [key, limit] of [["summary",700],["detail",2400]]) {
    const text = pending[key];
    if (typeof text !== "string" || !text.trim() || text.length > limit || UNSAFE.test(text)) return false;
  }
  return true;
}
