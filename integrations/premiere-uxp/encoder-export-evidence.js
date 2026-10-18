"use strict";
// Event correlation is observational, never proof that the queued native
// EncoderManager job originated from this Shuvi bridge request. An external
// Adobe producer can race for the same output. Never auto-retry an export.
const MAX_PROBES = 16;
const MAX_BRIDGE_ID = 160;
function cleanOutput(value) {
  if (typeof value !== "string" || value.length < 4 || value.length > 4096 ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value) ||
      !( /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+[\\/]/.test(value))) return null;
  const path = value.replaceAll("/", "\\").replace(/\\+$/, "");
  // Refuse potentially distinct paths that string normalization could conflate.
  if (path.split("\\").some(part => part === "." || part === "..")) return null;
  return path.toLowerCase();
}
function newExportProbe(bridgeRequestId, output, afterSequence, observedAtMs) {
  const target = cleanOutput(output);
  if (!target || typeof bridgeRequestId !== "string" ||
      !bridgeRequestId.length || bridgeRequestId.length > MAX_BRIDGE_ID ||
      !/^[a-zA-Z0-9_-]+$/.test(bridgeRequestId) ||
      !Number.isSafeInteger(afterSequence) || afterSequence < 0 ||
      !Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new Error("Export event probe requires an exact bridge request, safe Windows output and bounded event watermark.");
  }
  return Object.freeze({
    schemaVersion: 1, bridgeRequestId, output, normalizedOutput: target,
    afterSequence, createdAtMs: observedAtMs
  });
}
function boundedEvent(row) {
  return row && Number.isSafeInteger(row.sequence) && row.sequence > 0 &&
    ["queued","progress","complete","error","cancelled"].includes(row.kind) &&
    (row.jobID == null || (typeof row.jobID === "string" && row.jobID.length <= 160)) &&
    Array.isArray(row.outputFiles) && row.outputFiles.length <= 32;
}
function exactOutputs(row) {
  return row.outputFiles.map(cleanOutput).filter(Boolean);
}
function assessExportProbe(probe, retainedEvents) {
  if (!probe || !Array.isArray(retainedEvents) || retainedEvents.length > 128) {
    throw new Error("Export evidence must be a bounded existing probe and event ring.");
  }
  const ordered = retainedEvents.filter(boundedEvent).sort((a,b) => a.sequence - b.sequence);
  const windowComplete = ordered.length === retainedEvents.length &&
    (!ordered.length || ordered[0].sequence <= probe.afterSequence + 1) &&
    ordered.every((row,i) => i === 0 || row.sequence === ordered[i-1].sequence + 1);
  const newer = ordered.filter(row => row.sequence > probe.afterSequence);
  const queue = newer.filter(row => row.kind === "queued" &&
    exactOutputs(row).includes(probe.normalizedOutput));
  const uniqueIds = [...new Set(queue.map(row => row.jobID).filter(v =>
    typeof v === "string" && v.length > 0 && v.length <= 160))];
  // A single queue event can be external, but multiple candidates, missing job
  // IDs, reused IDs, or changed output metadata are more clearly ambiguous.
  const id = windowComplete && queue.length === 1 && uniqueIds.length === 1
    ? uniqueIds[0] : null;
  const idEvents = id ? newer.filter(row => row.jobID === id) : [];
  const competingOutput = idEvents.some(row => row.kind === "queued" &&
    !exactOutputs(row).includes(probe.normalizedOutput));
  const terminal = idEvents.filter(row => ["complete","error","cancelled"].includes(row.kind))
    .at(-1) || null;
  const earlierTerminal = terminal && idEvents.some(row =>
    row.sequence > terminal.sequence && ["complete","error","cancelled"].includes(row.kind));
  const usableId = id && !competingOutput && !earlierTerminal ? id : null;
  const result = {
    schemaVersion: 1,
    bridgeRequestId: probe.bridgeRequestId,
    output: probe.output,
    windowComplete,
    queueCandidateCount: queue.length,
    nativeJobIdCandidate: usableId,
    queueCandidateObserved: Boolean(usableId),
    latestNativeTerminalEvent: usableId ? terminal?.kind || null : null,
    nativeCompleteEventCandidateObserved: Boolean(usableId && terminal?.kind === "complete"),
    nativeErrorOrCancelObserved: Boolean(usableId && ["error","cancelled"].includes(terminal?.kind)),
    nativeCorrelation: usableId ? "exact_output_single_queue_candidate_external_writer_race_unexcluded"
      : "missing_ambiguous_or_truncated_native_queue_evidence",
    // Host event names and a matching output path are insufficient to prove
    // the exact Shuvi action, actual output bytes, codec decode or delivery.
    encoderCompletionVerified: false,
    fileGeneratedByThisShuviRequestVerified: false,
    outputSha256Verified: false,
    decodedMediaVerified: false,
    finalDeliveryReady: false,
    retrySafe: false
  };
  return result;
}
function rememberProbe(history, probe) {
  if (!Array.isArray(history)) throw new Error("Export probe ring is unavailable.");
  // Do not reuse a request identity inside this UXP session.
  if (history.some(p => p.bridgeRequestId === probe.bridgeRequestId)) {
    throw new Error("Duplicate export request identity; existing outcome may be uncertain.");
  }
  history.push(probe);
  if (history.length > MAX_PROBES) history.splice(0, history.length - MAX_PROBES);
}
module.exports = {cleanOutput,newExportProbe,assessExportProbe,rememberProbe};
