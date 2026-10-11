// A permission grant represents one exact, typed read request; it never grants a path
// prefix, PID-wide privilege, window-wide privilege or generic session access.
// Matching is intentionally stricter than OS path equivalence: variants need consent.
const MAX_GRANT_KEY_BYTES = 4096;
const INVALID = Symbol("invalid permission arguments");

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonical(value, depth = 0, visiting = new WeakSet()) {
  if (depth > 12) return INVALID;
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : INVALID;
  if (typeof value !== "object" || visiting.has(value)) return INVALID;
  if (Object.getOwnPropertySymbols(value).length) return INVALID;
  if (!Array.isArray(value) && !plainObject(value)) return INVALID;
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 128) return INVALID;
      const items = value.map(item => canonical(item, depth + 1, visiting));
      return items.includes(INVALID) ? INVALID : "[" + items.join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    if (keys.length > 128) return INVALID;
    const fields = [];
    for (const key of keys) {
      const item = canonical(value[key], depth + 1, visiting);
      if (item === INVALID) return INVALID;
      fields.push(JSON.stringify(key) + ":" + item);
    }
    return "{" + fields.join(",") + "}";
  } finally {
    visiting.delete(value);
  }
}

export function taskReadPermissionKey(proposal) {
  if (!proposal || typeof proposal.tool !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(proposal.tool) ||
      !plainObject(proposal.arguments)) return null;
  const args = canonical(proposal.arguments);
  if (args === INVALID) return null;
  const pid = proposal.arguments.pid;
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) return null;
  // Including PID before the argument fingerprint lets a closed/replaced browser
  // revoke every previous PID-scoped grant, while *all* arguments still match.
  const target = pid === undefined ? "" : "|pid:" + pid;
  const key = proposal.tool + target + "|args:" + args;
  return key.length <= MAX_GRANT_KEY_BYTES ? key : null;
}
