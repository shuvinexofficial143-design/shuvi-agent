// CommonJS for Premiere UXP. Pure caption/SRT handling: no Premiere edits or GUI automation.
const LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxSegments: 5000,
  maxSegmentTextChars: 8000,
  maxTotalTextChars: 512 * 1024,
  maxSeconds: 86400
});

const CAPTION_CAPABILITY = Object.freeze({
  schema_version: 1,
  native_caption_creation: false,
  native_caption_text_editing: false,
  caption_track_discovery: true,
  caption_track_rename: "premiere_26_3_plus",
  caption_track_mute: true,
  srt_generation: true,
  transcript_timing_adapter: true,
  import_adapter: {
    supported: true,
    mode: "native_project_item_source_import",
    timeline_caption_creation: false,
    reason: "Shuvi can import a validated .srt/.vtt as a Premiere project item and verify its exact media path. The reviewed API still exposes no caption-track text creation/edit action.",
    fallback: "Use the imported caption source in Premiere manually until a documented native caption-track write adapter exists; do not use blind GUI clicks."
  },
  reviewed: "2026-09-30"
});

function captionCapability() {
  return JSON.parse(JSON.stringify(CAPTION_CAPABILITY));
}

function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

function boundedPositiveInt(value, fallback, hardMax) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > hardMax) {
    throw new Error("Caption limit override must be a positive integer within the hard limit.");
  }
  return value;
}

function parseTimestamp(value) {
  const match = /^(\d{2,3}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(String(value).trim());
  if (!match) throw new Error("Malformed SRT timestamp: " + value);
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > LIMITS.maxSeconds) {
    throw new Error("SRT timestamp is outside Shuvi's supported 24-hour bound.");
  }
  return seconds;
}

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > LIMITS.maxSeconds) {
    throw new Error("Caption timestamp is outside Shuvi's supported 24-hour bound.");
  }
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  const pad = (value, width) => String(value).padStart(width, "0");
  return pad(hour, 2) + ":" + pad(min, 2) + ":" + pad(sec, 2) + "," + pad(ms, 3);
}

function normalizeSegments(input, options = {}) {
  if (!Array.isArray(input)) throw new Error("Caption segments must be an array.");
  const maxSegments = boundedPositiveInt(options.maxSegments, LIMITS.maxSegments, LIMITS.maxSegments);
  const maxText = boundedPositiveInt(options.maxSegmentTextChars, LIMITS.maxSegmentTextChars, LIMITS.maxSegmentTextChars);
  const maxTotalText = boundedPositiveInt(options.maxTotalTextChars, LIMITS.maxTotalTextChars, LIMITS.maxTotalTextChars);
  if (input.length > maxSegments) throw new Error("Caption segment limit exceeded.");

  let totalTextChars = 0;
  const segments = input.map((segment, originalIndex) => {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > LIMITS.maxSeconds) {
      throw new Error("Caption segment requires 0 <= start < end <= 86400.");
    }
    if (Math.round(end * 1000) <= Math.round(start * 1000)) {
      throw new Error("Caption duration is too short for SRT millisecond precision.");
    }
    if (typeof segment?.text !== "string") throw new Error("Caption text must be a string.");
    const text = segment.text.replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("Caption text must not be empty.");
    if (text.length > maxText) throw new Error("Caption segment text limit exceeded.");
    totalTextChars += text.length;
    if (totalTextChars > maxTotalText) throw new Error("Total caption text limit exceeded.");
    return {start, end, text, originalIndex};
  });

  segments.sort((a, b) => a.start - b.start || a.end - b.end || a.originalIndex - b.originalIndex);
  let output = segments.map(({start, end, text}) => ({start, end, text}));

  if (options.mergeAdjacent === true) {
    const maxGap = options.maxMergeGapSeconds == null ? 0.25 : Number(options.maxMergeGapSeconds);
    if (!Number.isFinite(maxGap) || maxGap < 0 || maxGap > 10) {
      throw new Error("maxMergeGapSeconds must be between 0 and 10.");
    }
    const separator = options.mergeSeparator == null ? " " : String(options.mergeSeparator);
    const merged = [];
    for (const segment of output) {
      const previous = merged[merged.length - 1];
      const gap = previous ? segment.start - previous.end : Infinity;
      if (previous && gap >= 0 && gap <= maxGap) {
        const text = previous.text + separator + segment.text;
        if (text.length > maxText) throw new Error("Merged caption text limit exceeded.");
        previous.end = segment.end;
        previous.text = text;
      } else merged.push({...segment});
    }
    output = merged;
  }

  const overlaps = [];
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    if (current.start < previous.end) {
      overlaps.push({
        previous_index: index - 1,
        index,
        previous_end: previous.end,
        current_start: current.start
      });
    }
  }
  return {segments: output, overlaps};
}

function parseSrt(input, options = {}) {
  if (typeof input !== "string") throw new Error("SRT input must be UTF-8 text.");
  if (utf8ByteLength(input) > LIMITS.maxFileBytes) throw new Error("SRT file exceeds the 1 MiB limit.");

  const hadBom = input.charCodeAt(0) === 0xfeff;
  const withoutBom = hadBom ? input.slice(1) : input;
  const lineEnding = withoutBom.includes("\r\n") ? "crlf" : withoutBom.includes("\r") ? "cr" : "lf";
  const normalized = withoutBom.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return {schemaVersion: 1, segments: [], overlaps: [], hadBom, lineEnding, sorted: true};

  const blocks = normalized.split(/\n{2,}/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let timeLineIndex = 1;
    if (!/^\d+$/.test((lines[0] || "").trim())) {
      if (options.tolerantSequenceNumbers !== true) throw new Error("SRT cue sequence number is missing or malformed.");
      timeLineIndex = 0;
    }
    const timing = lines[timeLineIndex] || "";
    const timingMatch = /^(.+?)\s+-->\s+(.+?)$/.exec(timing.trim());
    if (!timingMatch) throw new Error("Malformed SRT timing line.");
    const start = parseTimestamp(timingMatch[1]);
    const end = parseTimestamp(timingMatch[2]);
    const text = lines.slice(timeLineIndex + 1).join("\n");
    segments.push({start, end, text});
  }

  const normalizedSegments = normalizeSegments(segments, options);
  return {
    schemaVersion: 1,
    ...normalizedSegments,
    hadBom,
    lineEnding,
    sorted: true
  };
}

function serializeSrt(input, options = {}) {
  const normalized = normalizeSegments(input, options);
  const eol = options.lineEnding === "crlf" ? "\r\n" : "\n";
  const blocks = normalized.segments.map((segment, index) =>
    String(index + 1) + eol +
    formatTimestamp(segment.start) + " --> " + formatTimestamp(segment.end) + eol +
    segment.text.replace(/\n/g, eol)
  );
  const output = blocks.join(eol + eol) + (blocks.length ? eol : "");
  if (utf8ByteLength(output) > LIMITS.maxFileBytes) throw new Error("Serialized SRT exceeds the 1 MiB limit.");
  return output;
}

function secondsValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof value.seconds === "number" && Number.isFinite(value.seconds)) {
    return value.seconds;
  }
  return null;
}

function transcriptArray(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.segments)) return {segments: value.segments, source: "segments"};
  if (Array.isArray(value.textSegments)) return {segments: value.textSegments, source: "textSegments"};
  if (value.transcript && typeof value.transcript === "object") {
    if (Array.isArray(value.transcript.segments)) return {segments: value.transcript.segments, source: "transcript.segments"};
    if (Array.isArray(value.transcript.textSegments)) return {segments: value.transcript.textSegments, source: "transcript.textSegments"};
  }
  return null;
}

function adaptTranscriptTiming(input) {
  const capability = captionCapability();
  let value = input;
  try {
    if (typeof input === "string") {
      if (utf8ByteLength(input) > LIMITS.maxFileBytes) {
        return {supported: false, reason: "Transcript JSON exceeds the 1 MiB caption-adapter bound.", capability};
      }
      const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
      value = JSON.parse(text);
    }
  } catch (error) {
    return {supported: false, reason: "Transcript JSON could not be parsed: " + error.message, capability};
  }

  const located = transcriptArray(value);
  if (!located) {
    return {
      supported: false,
      reason: "Transcript JSON does not expose a recognized segment array with explicit timing; Shuvi will not guess an undocumented Premiere schema.",
      capability
    };
  }
  if (located.segments.length > LIMITS.maxSegments) {
    return {supported: false, reason: "Transcript segment limit exceeded.", capability};
  }

  const segments = [];
  for (const segment of located.segments) {
    const start = secondsValue(segment?.start ?? segment?.startTime);
    const end = secondsValue(segment?.end ?? segment?.endTime);
    if (start == null || end == null || typeof segment?.text !== "string") {
      return {
        supported: false,
        reason: "Transcript segment timing/text is not explicit enough for safe caption adaptation.",
        source: located.source,
        capability
      };
    }
    segments.push({start, end, text: segment.text});
  }

  try {
    const normalized = normalizeSegments(segments);
    const srt = serializeSrt(normalized.segments);
    return {
      supported: true,
      schemaVersion: 1,
      source: located.source,
      segments: normalized.segments,
      overlaps: normalized.overlaps,
      srt,
      capability
    };
  } catch (error) {
    return {supported: false, reason: "Transcript timing failed caption validation: " + error.message, source: located.source, capability};
  }
}

module.exports = {
  LIMITS,
  CAPTION_CAPABILITY,
  captionCapability,
  parseSrt,
  serializeSrt,
  normalizeSegments,
  adaptTranscriptTiming
};
