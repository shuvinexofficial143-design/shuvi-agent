"use strict";

// This contract is deliberately host-independent. Premiere supplies observed
// project-item identities/times; this module never fabricates an edit receipt.
function normalizeMediaPath(value) {
  return String(value || "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function validatedMediaPaths(raw, maxCount) {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxCount) {
    throw new Error("Media request must contain a bounded non-empty array of paths.");
  }
  const seen = new Set();
  return raw.map((path) => {
    if (typeof path !== "string" || !path.trim() || path !== path.trim()
        || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)
        || !(/^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path) || path.startsWith("/"))) {
      throw new Error("Every media entry must be a clean, bounded absolute path; no entry may be silently discarded.");
    }
    const normalized = normalizeMediaPath(path);
    if (seen.has(normalized)) throw new Error("Duplicate or case-aliased media path in one request.");
    seen.add(normalized);
    return path;
  });
}

// For a new sequence, a GUID and active selection alone do not prove the
// requested media was placed on the actual timeline. Audio/video twins may
// share a project-item ID and start time; each requested source must have at
// least one positive-duration track item, in the requested temporal order.
function assessSequenceMediaEvidence(expectedMediaIds, observed, scanComplete) {
  const unavailable = (reason) => ({
    verified: false, reason, mediaObserved: 0, requestedMediaCount:
      Array.isArray(expectedMediaIds) ? expectedMediaIds.length : 0,
    missingIds: [], unexpectedIds: [], temporalOrderVerified: false
  });
  if (!Array.isArray(expectedMediaIds) || !expectedMediaIds.length
      || expectedMediaIds.length > 50 || !Array.isArray(observed)
      || observed.length > 240 || scanComplete !== true) {
    return unavailable("Unbounded, empty, or incomplete Premiere timeline inspection.");
  }
  const ids = expectedMediaIds.map(id => id == null ? "" : String(id));
  if (ids.some(id => !id || id.length > 240) || new Set(ids).size !== ids.length) {
    return unavailable("Sequence source identities are unavailable or ambiguous.");
  }
  const starts = new Map();
  const requested = new Set(ids);
  const unexpected = new Set();
  for (const item of observed) {
    const id = item?.mediaId == null ? "" : String(item.mediaId);
    const start = item?.startSeconds, end = item?.endSeconds;
    if (!id || !Number.isFinite(start) || !Number.isFinite(end)
        || start < 0 || end <= start) {
      return unavailable("Timeline contains a clip with missing identity or invalid duration.");
    }
    if (!requested.has(id)) {
      unexpected.add(id);
    } else {
      starts.set(id, Math.min(starts.get(id) ?? Number.POSITIVE_INFINITY, start));
    }
  }
  const missingIds = ids.filter(id => !starts.has(id));
  const times = ids.map(id => starts.get(id));
  const temporalOrderVerified = missingIds.length === 0
    && times.every((time, index) => index === 0 || time > times[index - 1] + 0.000001);
  const verified = temporalOrderVerified && unexpected.size === 0;
  return {
    verified, reason: verified ? null : "Timeline source coverage, temporal order, or exclusivity was not proven.",
    mediaObserved: starts.size, requestedMediaCount: ids.length,
    missingIds, unexpectedIds: [...unexpected], temporalOrderVerified
  };
}

module.exports = {normalizeMediaPath, validatedMediaPaths, assessSequenceMediaEvidence};
