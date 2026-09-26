// AA: pure range planning plus a bounded, one-shot native workflow.
const EPS = 0.001;
const time = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 86400;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = text => encodeURIComponent(text).replace(/%[A-F\d]{2}/gi, "x").length;
function closed(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unknown or malformed rebuild fields.");
}
function validate(request) {
  closed(request, ["schema_version", "item_id", "source", "transcript_source_offset", "removals", "destination", "take_video", "take_audio", "gap_seconds"]);
  closed(request.source, ["track", "clip_index"]);
  closed(request.destination, ["mode", "sequence_guid", "video_track", "audio_track"]);
  const d = request.destination;
  if (request.schema_version !== 1 || typeof request.item_id !== "string" || !request.item_id.trim() || request.item_id.length > 240 ||
      d.mode !== "explicit_empty_target_sequence" || typeof d.sequence_guid !== "string" || !d.sequence_guid || d.sequence_guid.length > 240 ||
      ![request.source.track, d.video_track, d.audio_track].every(n => Number.isInteger(n) && n >= 0 && n < 64) ||
      !Number.isInteger(request.source.clip_index) || request.source.clip_index < 0 || request.source.clip_index > 10000 ||
      !Number.isFinite(request.transcript_source_offset) || Math.abs(request.transcript_source_offset) > 86400 ||
      request.take_video !== true || typeof request.take_audio !== "boolean" ||
      !time(request.gap_seconds) || request.gap_seconds > 60 ||
      !Array.isArray(request.removals) || !request.removals.length || request.removals.length > 128) throw new Error("Invalid bounded rebuild request.");
  for (const r of request.removals) {
    closed(r, ["segment_id", "start", "end"]);
    const byId = typeof r.segment_id === "string" && /^seg-\d{4}$/.test(r.segment_id);
    if (byId ? r.start != null || r.end != null : r.segment_id != null || !time(r.start) || !time(r.end) || r.end <= r.start) throw new Error("Removal requires a segment ID OR a complete explicit transcript range.");
  }
}
function catalog(captions) {
  if (captions?.supported !== true || captions.segmentsTruncated !== false || !Array.isArray(captions.segments) || !captions.segments.length || captions.segments.length > 256) throw new Error("Complete native transcript timing is required.");
  let end = 0;
  return captions.segments.map((s, i) => {
    if (!time(s.start) || !time(s.end) || s.end <= s.start || s.start < end || typeof s.text !== "string" || !s.text.trim() || s.text.length > 8000) throw new Error("Malformed or overlapping transcript segments.");
    end = s.end;
    return {id: `seg-${String(i + 1).padStart(4, "0")}`, start: s.start, end: s.end, text: s.text};
  });
}
function buildPlan(request, observed) {
  validate(request);
  const transcript = catalog(observed.captions), s = observed.source, d = observed.destination;
  const reasons = [];
  if (s.item_id !== request.item_id || !s.signature || !s.sequence_guid || s.sequence_guid === d.sequence_guid || d.sequence_guid !== request.destination.sequence_guid) reasons.push("Exact source identity and a different destination sequence are required.");
  if (![s.start, s.end, s.input, s.output].every(time) || s.end <= s.start || s.output <= s.input || s.speed !== 1 || s.reverse !== false || Math.abs((s.end - s.start) - (s.output - s.input)) > EPS) reasons.push("Source mapping requires inspected forward 1x playback with equal source/timeline duration.");
  if (observed.source_supported !== true) reasons.push("Source must be online, ordinary media with stable subclip support (Premiere 26.3+); sequences/merged/multicam media are unsupported.");
  if (!Array.isArray(d.rows) || d.rows.length || d.caption_tracks !== 0 || request.destination.video_track >= d.video_tracks || request.destination.audio_track >= d.audio_tracks) reasons.push("Destination must have no clips/caption tracks and both explicit existing tracks.");
  if (reasons.length) return {supported: false, unsupported_reasons: reasons, strategy: "rebuild", minimum_host_version: "26.3"};
  const ranges = request.removals.map(r => {
    const segment = r.segment_id ? transcript.find(s => s.id === r.segment_id) : r;
    if (!segment) throw new Error("Unknown transcript segment ID.");
    const start = segment.start + request.transcript_source_offset, end = segment.end + request.transcript_source_offset;
    if (start < s.input || end > s.output || end <= start) throw new Error("Selected removal lies outside the inspected source range.");
    return [start, end];
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  const keep = [];
  let cursor = s.input, destination = 0;
  const add = end => {
    if (end <= cursor) return;
    keep.push({source_range: [cursor, end], sequence_range: [s.start + cursor - s.input, s.start + end - s.input], destination_range: [destination, destination + end - cursor]});
    destination += end - cursor + request.gap_seconds;
  };
  for (const r of merged) { add(r[0]); cursor = r[1]; }
  add(s.output);
  if (keep.length > 128) throw new Error("Result exceeds 128 keep ranges; reduce fragmentation.");
  // Exact snapshot, not a collision-prone short hash. Nothing persisted or executable.
  const snapshot = JSON.stringify({request, transcript, source: s, destination: d});
  if (bytes(snapshot) > 48000) throw new Error("Rebuild snapshot exceeds bound; narrow transcript/source scope.");
  return {supported: true, strategy: "rebuild", minimum_host_version: "26.3", transcript_snapshot: JSON.stringify(transcript), plan_snapshot: snapshot,
    catalog: transcript, selected_removals: request.removals, remove_ranges: merged, keep_ranges: keep,
    mapping: {formula: "source = sequence - sequence_start + source_in; source = transcript + transcript_source_offset", project_item_id: s.item_id, sequence_start: s.start, source_in: s.input, source_out: s.output, transcript_source_offset: request.transcript_source_offset},
    destination: d, expected: observed.expected, duration_before: s.end - s.start, duration_after: keep.length ? destination - request.gap_seconds : 0,
    linked_media_inferred: false, original_sequence_mutated: false, effects_copied: false};
}
function createWorkflow(api) {
  let session = null, serial = 0;
  async function plan(request) { return buildPlan(request, await api.inspect(request)); }
  async function begin(request, snapshot) {
    if (session) throw new Error("A rebuild is already prepared; release it before beginning another.");
    const p = await plan(request);
    if (!p.supported || p.plan_snapshot !== snapshot) throw new Error("Rebuild plan changed; inspect and approve a fresh plan.");
    const id = `rebuild-${Date.now()}-${++serial}`;
    session = {id, request: JSON.parse(JSON.stringify(request)), plan: p, cursor: 0, rows: p.destination.rows, created: null, halted: false, busy: false};
    return {id, operation_count: p.keep_ranges.length * 2, plan: p};
  }
  async function step(id, index) {
    const s = session;
    if (!s || s.id !== id || s.halted || s.busy || index !== s.cursor || index >= s.plan.keep_ranges.length * 2) throw new Error("Rebuild step is stale, already attempted, or unavailable.");
    s.busy = true;
    let dispatched = false, receipt = null;
    try {
      const now = await api.inspect(s.request);
      const original = JSON.parse(s.plan.plan_snapshot);
      if (!same(now.source, original.source) || !same(catalog(now.captions), original.transcript) || now.source_supported !== true ||
          !same({...now.destination, rows: []}, {...original.destination, rows: []}) || !same(now.destination.rows, s.rows)) throw new Error("Source/transcript/destination changed during rebuild.");
      const piece = s.plan.keep_ranges[Math.floor(index / 2)];
      if (index % 2 === 0) {
        dispatched = true;
        receipt = await api.subclip({itemId: s.request.item_id, name: `${id}-${Math.floor(index / 2) + 1}`, startSeconds: piece.source_range[0], endSeconds: piece.source_range[1], hardBoundaries: true, takeVideo: true, takeAudio: s.request.take_audio});
        if (receipt.correlationVerified !== true || typeof receipt.createdItemId !== "string" || !receipt.createdItemId) throw new Error("Created subclip correlation is uncertain.");
        s.created = receipt.createdItemId;
      } else {
        dispatched = true;
        receipt = await api.insert({itemId: s.created, seconds: piece.destination_range[0], videoTrack: s.request.destination.video_track, audioTrack: s.request.destination.audio_track, mode: "overwrite"}, s.request.destination.sequence_guid);
        if (receipt.edited !== true) throw new Error("Insertion not accepted.");
        const after = await api.inspect(s.request);
        if (!same(after.source, now.source) || !same(catalog(after.captions), original.transcript)) throw new Error("Original source changed during insertion.");
        if (!same({...after.destination, rows: []}, {...now.destination, rows: []})) throw new Error("Destination topology changed during insertion.");
        const rows = after.destination.rows;
        const added = rows.filter(r => !s.rows.some(old => same(r, old)));
        if (!s.rows.every(old => rows.some(r => same(r, old))) || rows.length !== s.rows.length + (s.request.take_audio ? 2 : 1) ||
            added.length !== (s.request.take_audio ? 2 : 1) || !["video", ...(s.request.take_audio ? ["audio"] : [])].every(kind => added.filter(r => r.kind === kind && r.track === s.request.destination[`${kind}_track`] && r.item_id === s.created && Math.abs(r.start - piece.destination_range[0]) <= EPS && Math.abs(r.end - piece.destination_range[1]) <= EPS).length === 1)) throw new Error("Inserted piece cannot be correlated exactly; inspect destination before continuing.");
        s.rows = rows;
        receipt = {...receipt, inserted: added, original_sequence_unchanged: true};
      }
      s.cursor++;
      return {status: "applied", index, operation: index % 2 ? "insert" : "subclip", piece, receipt, uncertain: false};
    } catch (error) {
      s.halted = true;
      return {status: "failed", index, error: String(error.message || error), receipt, uncertain: dispatched};
    } finally { s.busy = false; }
  }
  function release(id) { if (session?.id === id && !session.busy) { session = null; return {released: true}; } return {released: false}; }
  return {plan, begin, step, release};
}
module.exports = {validate, catalog, buildPlan, createWorkflow};
